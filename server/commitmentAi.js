// The two places a model helps with commitment types:
//
//  1. Translating a plain-English description into structured rules, which
//     then run with no model at all (shared/commitmentRules.js).
//  2. For a type switched to "let AI decide", judging each calendar entry
//     against the description. Verdicts are cached per entry and description,
//     so only new or changed entries cost a call.
import { callClaude } from './llm.js';
import { cachedVerdict, cacheVerdict, fingerprintOf } from './classify.js';
import { FIELDS, DAYS, sanitizeRules } from '../shared/commitmentRules.js';

const MODEL = 'claude-opus-5';
const BATCH_SIZE = 25;
const PARALLEL = 4;

// ---------------------------------------------------------------------------
// Description -> rules
// ---------------------------------------------------------------------------
const ALL_OPS = [...new Set(Object.values(FIELDS).flatMap(f => Object.keys(f.ops)))];

const fieldGuide = Object.entries(FIELDS)
  .map(([field, spec]) => {
    const ops = Object.entries(spec.ops).map(([op, label]) => {
      const kind = typeof spec.value === 'string' ? spec.value : spec.value[op];
      const value = {
        text: 'value: text; commas separate alternatives ("any of")',
        minutes: 'value: minutes as a number',
        number: 'value: a number',
        time: 'value: 24-hour "HH:MM" in the owner\'s timezone',
        days: `value: comma-separated days from ${DAYS.join(', ')}`,
        boolean: 'value: "true" or "false"',
      }[kind] || 'value: empty string';
      return `    - ${op} (${label}) — ${value}`;
    });
    return `  ${field} (${spec.label}):\n${ops.join('\n')}`;
  })
  .join('\n');

const TRANSLATE_SYSTEM = `You turn a plain-English description of a kind of calendar
entry into structured matching rules.

An entry matches when ANY rule matches; a rule matches when ALL its conditions hold.
Fields and operators:
${fieldGuide}

Notes:
- "My domain" means the calendar owner's email domain; "external" means anyone else.
  Meeting rooms and the owner never count as attendees.
- Title matching is case-insensitive substring matching. Prefer a few short, likely
  words over long phrases, and use commas for alternatives.
- Use separate rules for genuinely different cases ("X, or Y").
- Express only what the description says. If part of it can't be expressed with
  these fields, leave it out and say so in "unsupported".`;

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: Object.keys(FIELDS) },
                op: { type: 'string', enum: ALL_OPS },
                value: { type: 'string' },
              },
              required: ['field', 'op', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['conditions'],
        additionalProperties: false,
      },
    },
    unsupported: {
      type: 'string',
      description: 'Anything in the description the rules could not express, or empty',
    },
  },
  required: ['rules', 'unsupported'],
  additionalProperties: false,
};

// The model returns every value as a string; give each its proper type.
function typedValue(field, op, raw) {
  const spec = FIELDS[field];
  const kind = spec && (typeof spec.value === 'string' ? spec.value : spec.value[op]);
  const text = String(raw ?? '').trim();
  switch (kind) {
    case 'minutes':
    case 'number': return Number(text);
    case 'days': return text.toLowerCase().split(/[\s,]+/).map(d => d.slice(0, 3)).filter(Boolean);
    case 'boolean': return text.toLowerCase() !== 'false';
    case 'time': return text.padStart(5, '0');
    case 'text': return text;
    default: return null;
  }
}

export async function translateToRules(description, { apiKey, email, keySource }) {
  if (!apiKey) {
    const err = new Error('No Anthropic API key is configured, so descriptions cannot be translated. Write the rules by hand instead.');
    err.status = 409;
    throw err;
  }
  const response = await callClaude({
    model: MODEL,
    max_tokens: 2000,
    system: TRANSLATE_SYSTEM,
    tools: [{
      name: 'set_rules',
      description: 'Record the structured rules for the description.',
      strict: true,
      input_schema: TRANSLATE_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'set_rules' },
    messages: [{ role: 'user', content: `Owner's email domain: ${email.split('@')[1]}\n\nDescription: ${description}` }],
  }, { apiKey, email, keySource, feature: 'rule-translation' });

  const block = response.content.find(b => b.type === 'tool_use');
  return { rules: rulesFromModel(block?.input?.rules), unsupported: block?.input?.unsupported || '' };
}

/** The model's string-valued rules, typed and validated. */
export function rulesFromModel(raw) {
  return sanitizeRules((raw || []).map(rule => ({
    conditions: (rule.conditions || []).map(c => ({ ...c, value: typedValue(c.field, c.op, c.value) })),
  })));
}

// ---------------------------------------------------------------------------
// AI verdicts
// ---------------------------------------------------------------------------
const JUDGE_SYSTEM = `You decide which calendar entries match a description of a
kind of commitment. Use every signal: the title, organizer, guests and their email
domains, the time and the duration. Only list entries that clearly match.`;

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    matching: {
      type: 'array',
      description: 'Indexes of the entries that match the description',
      items: { type: 'integer' },
    },
  },
  required: ['matching'],
  additionalProperties: false,
};

// Everything about an entry that could change a verdict.
function eventKey(event) {
  return fingerprintOf({
    summary: event.summary || '',
    allDay: !!event.allDay,
    start: event.start,
    end: event.end,
    location: event.location || '',
    organizer: event.organizer?.email || '',
    attendees: (event.attendees || []).map(a => a.email).sort(),
  });
}

function describeEvent(event, index, timezone) {
  const when = event.allDay
    ? `all day ${String(event.start).slice(0, 10)}`
    : `${new Date(event.start).toLocaleString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, ${Math.round((new Date(event.end) - new Date(event.start)) / 60000)} min`;
  const guests = (event.attendees || []).filter(a => !a.self).map(a => a.email).filter(Boolean);
  return [
    `${index}. "${event.summary}" — ${when}`,
    event.organizer?.email ? `   organizer: ${event.organizer.self ? 'the owner' : event.organizer.email}` : null,
    guests.length ? `   guests: ${guests.join(', ')}` : null,
    event.location ? `   location: ${event.location}` : null,
  ].filter(Boolean).join('\n');
}

async function judgeBatch(description, batch, { timezone, apiKey, email, keySource }) {
  const response = await callClaude({
    model: MODEL,
    max_tokens: 1000,
    system: JUDGE_SYSTEM,
    tools: [{
      name: 'record_matches',
      description: 'Record which entries match the description.',
      strict: true,
      input_schema: JUDGE_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'record_matches' },
    messages: [{
      role: 'user',
      content: [
        `The calendar owner's email domain: ${email.split('@')[1]}`,
        `Description: ${description}`,
        '',
        'Entries:',
        ...batch.map((e, i) => describeEvent(e, i, timezone)),
      ].join('\n'),
    }],
  }, { apiKey, email, keySource, feature: 'ai-commitment-match' });
  const block = response.content.find(b => b.type === 'tool_use');
  return new Set((block?.input?.matching || []).filter(i => Number.isInteger(i)));
}

/**
 * Which of `events` match `description`, by AI: a Set of event ids. Cached
 * verdicts are reused; the rest are asked for in parallel batches.
 */
export async function aiMatches(description, events, { timezone, apiKey, email, keySource }) {
  const descKey = fingerprintOf(description.trim().toLowerCase());
  const matched = new Set();
  const pending = [];
  for (const event of events) {
    const hit = cachedVerdict(`${descKey}:${eventKey(event)}`);
    if (hit === undefined) pending.push(event);
    else if (hit) matched.add(event.id);
  }
  if (!pending.length) return { matched, error: null };
  if (!apiKey) return { matched, error: 'No Anthropic API key is configured, so AI-decided types can’t be evaluated.' };

  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
  let error = null;
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.all(batches.slice(i, i + PARALLEL).map(async batch => {
      try {
        const yes = await judgeBatch(description, batch, { timezone, apiKey, email, keySource });
        batch.forEach((event, index) => {
          cacheVerdict(`${descKey}:${eventKey(event)}`, yes.has(index));
          if (yes.has(index)) matched.add(event.id);
        });
      } catch (err) {
        console.error('[commitment-ai] batch failed:', err.message);
        error = err.message;
      }
    }));
  }
  return { matched, error };
}

/**
 * AI verdicts for every "let AI decide" type: Map of type id -> Set of event ids.
 */
export async function aiMatchesForTypes(commitmentTypes, events, options) {
  const out = new Map();
  const errors = [];
  await Promise.all(
    commitmentTypes
      .filter(t => t.mode === 'ai' && t.description?.trim())
      .map(async t => {
        const { matched, error } = await aiMatches(t.description, events, options);
        out.set(t.id, matched);
        if (error) errors.push(`${t.name}: ${error}`);
      })
  );
  return { matches: out, errors };
}
