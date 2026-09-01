// Classifying calendar entries against the owner's commitment types.
//
// A commitment type is a plain-text condition ("customer calls", "anything with
// my manager", "focus time") plus a colour. Claude reads the conditions and the
// event titles and says which type, if any, each entry satisfies; without an API
// key it degrades to keyword overlap so the feature still works locally.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';

const SYSTEM_PROMPT = `You label calendar entries against a person's commitment types.
Each commitment type has a name and a plain-language condition describing which
calendar entries satisfy it. For every event, choose the single commitment type
whose condition it best satisfies, or null when none clearly applies.
Judge from the event title alone; do not guess wildly. Prefer null over a weak match.`;

const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      description: 'One entry per event, in the order given.',
      items: {
        type: 'object',
        properties: {
          eventIndex: { type: 'integer', description: 'Index of the event in the supplied list' },
          commitmentTypeId: {
            type: 'string',
            description: 'The matching commitment type id, or the empty string for no match',
          },
        },
        required: ['eventIndex', 'commitmentTypeId'],
        additionalProperties: false,
      },
    },
  },
  required: ['assignments'],
  additionalProperties: false,
};

// Results are cached by title + the set of conditions, so repeat previews and
// recurring meetings don't re-ask the model. Cleared whenever the types change.
const cache = new Map();

function fingerprint(commitmentTypes) {
  const basis = commitmentTypes
    .map(t => `${t.id}:${t.name}:${t.condition}`)
    .sort()
    .join('|');
  return createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'anything', 'are', 'as', 'at', 'be', 'by', 'call', 'calls',
  'entry', 'event', 'events', 'for', 'from', 'has', 'in', 'is', 'it', 'its', 'meeting',
  'meetings', 'my', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
]);

const words = text =>
  (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

// Keyword overlap between an event title and each condition. Used when no API
// key is set, and as the safety net if the model call fails.
export function classifyByKeyword(events, commitmentTypes) {
  const prepared = commitmentTypes.map(t => ({
    id: t.id,
    terms: new Set([...words(t.name), ...words(t.condition)]),
  }));

  const result = new Map();
  for (const event of events) {
    const titleWords = words(event.summary);
    let best = null;
    let bestScore = 0;
    for (const type of prepared) {
      const score = titleWords.filter(w => type.terms.has(w)).length;
      if (score > bestScore) {
        best = type.id;
        bestScore = score;
      }
    }
    if (best) result.set(event.id, best);
  }
  return result;
}

/**
 * Map of event id -> commitment type id. Events with no match are absent.
 */
export async function classifyEvents(events, commitmentTypes, { apiKey } = {}) {
  if (!events.length || !commitmentTypes.length) return new Map();

  const version = fingerprint(commitmentTypes);
  const validIds = new Set(commitmentTypes.map(t => t.id));
  const result = new Map();

  // Serve what we can from cache; only ask about titles we haven't seen.
  const unresolved = [];
  for (const event of events) {
    const key = `${version}::${event.summary}`;
    if (cache.has(key)) {
      const typeId = cache.get(key);
      if (typeId) result.set(event.id, typeId);
    } else {
      unresolved.push(event);
    }
  }
  if (!unresolved.length) return result;

  const applyFallback = () => {
    const keyword = classifyByKeyword(unresolved, commitmentTypes);
    for (const event of unresolved) {
      const typeId = keyword.get(event.id) || '';
      cache.set(`${version}::${event.summary}`, typeId);
      if (typeId) result.set(event.id, typeId);
    }
    return result;
  };

  if (!apiKey) return applyFallback();

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [{
        name: 'assign_commitment_types',
        description: 'Record which commitment type each calendar event satisfies.',
        strict: true,
        input_schema: ASSIGNMENT_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'assign_commitment_types' },
      messages: [{
        role: 'user',
        content: [
          'Commitment types:',
          ...commitmentTypes.map(t => `- id ${t.id} · ${t.name}: ${t.condition}`),
          '',
          'Events:',
          ...unresolved.map((e, i) => `${i}. ${e.summary}`),
        ].join('\n'),
      }],
    });

    const block = response.content.find(b => b.type === 'tool_use');
    if (!block) return applyFallback();

    const seen = new Set();
    for (const assignment of block.input.assignments || []) {
      const event = unresolved[assignment.eventIndex];
      if (!event) continue;
      const typeId = validIds.has(assignment.commitmentTypeId) ? assignment.commitmentTypeId : '';
      cache.set(`${version}::${event.summary}`, typeId);
      seen.add(assignment.eventIndex);
      if (typeId) result.set(event.id, typeId);
    }
    // Anything the model skipped counts as "no match" so it isn't re-asked.
    unresolved.forEach((event, i) => {
      if (!seen.has(i)) cache.set(`${version}::${event.summary}`, '');
    });
    return result;
  } catch (err) {
    console.error('[classify] falling back to keywords:', err.message);
    return applyFallback();
  }
}

export function clearClassificationCache() {
  cache.clear();
}
