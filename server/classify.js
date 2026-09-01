// Classifying calendar entries against the owner's commitment types.
//
// A commitment type is a plain-text condition ("customer calls", "anything with
// my manager", "focus time") plus a colour. Claude reads the conditions and the
// entries and says which type, if any, each one satisfies; without an API key it
// degrades to keyword overlap so the feature still works locally.
//
// Verdicts are cached on disk under a fingerprint of the event *and* the set of
// conditions, so an unchanged calendar costs nothing to re-colour: the model is
// asked only about entries it has not already judged. Editing an event (title,
// time, guests, location) or any commitment type changes the fingerprint and
// earns a fresh answer.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'classification-cache.json');
// Plenty for years of one person's calendar; bounded so the file cannot grow
// without limit as events and conditions change.
const MAX_ENTRIES = 20000;
// Small enough that progress moves visibly, large enough that the model sees a
// batch's worth of context per call.
const BATCH_SIZE = 15;

const SYSTEM_PROMPT = `You label calendar entries against a person's commitment types.
Each commitment type has a name and a plain-language condition describing which
calendar entries satisfy it. For every event, choose the single commitment type
whose condition it best satisfies, or null when none clearly applies.
Use every signal given — the title, who organized it, the guests and their email
domains, the time of day and the duration. Prefer null over a weak match.`;

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

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
// { [key]: { value, at } } — `at` drives eviction, and is refreshed on read so
// the entries in active use are the ones that survive.
let cache = loadCache();
let saveTimer = null;

function loadCache() {
  try {
    if (!existsSync(CACHE_FILE)) return new Map();
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(data.entries || {}));
  } catch {
    return new Map();
  }
}

function writeCache() {
  try {
    evict();
    writeFileSync(CACHE_FILE, JSON.stringify({ entries: Object.fromEntries(cache) }, null, 2));
  } catch (err) {
    console.error('[classify] could not persist the cache:', err.message);
  }
}

// Batched: a preview can resolve dozens of entries, and they should cost one write.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeCache();
  }, 500);
  saveTimer.unref?.();
}

// A restart inside the debounce window would otherwise throw away verdicts we
// have already paid for, so pending writes are flushed on the way out.
function flushCache() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeCache();
}

process.on('exit', flushCache);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    flushCache();
    process.exit(0);
  });
}

function evict() {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestFirst = [...cache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [key] of oldestFirst.slice(0, cache.size - MAX_ENTRIES)) cache.delete(key);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  hit.at = Date.now(); // keep in-use entries fresh for eviction
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
  scheduleSave();
}

const sha = value => createHash('sha1').update(value).digest('hex').slice(0, 16);

// Changes to any condition invalidate every verdict made under the old set.
function typesFingerprint(commitmentTypes) {
  return sha(
    commitmentTypes.map(t => `${t.id}:${t.name}:${t.condition}`).sort().join('|')
  );
}

// Everything about an event that could change a verdict. Two entries with the
// same title but different guests are judged separately.
export function eventFingerprint(event) {
  return sha(JSON.stringify({
    summary: event.summary || '',
    allDay: !!event.allDay,
    start: event.start,
    end: event.end,
    location: event.location || '',
    organizer: event.organizer?.email || '',
    attendees: (event.attendees || [])
      .map(a => `${a.email}:${a.optional ? 'opt' : 'req'}`)
      .sort(),
    recurring: !!event.recurring,
  }));
}

const cacheKey = (kind, version, event) => `${kind}:${version}:${eventFingerprint(event)}`;

// ---------------------------------------------------------------------------
// Keyword fallback
// ---------------------------------------------------------------------------
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

/** Keyword overlap, used with no API key and as the safety net on failure. */
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

// One line per event, matching what the model is asked to judge on.
function describe(event, index) {
  const guests = (event.attendees || [])
    .map(a => a.email)
    .filter(Boolean)
    .join(', ');
  return [
    `${index}. "${event.summary}"`,
    event.allDay ? '   all day' : `   ${event.start} to ${event.end}`,
    event.organizer?.email ? `   organizer: ${event.organizer.email}${event.organizer.self ? ' (the calendar owner)' : ''}` : null,
    guests ? `   guests: ${guests}` : null,
    event.location ? `   location: ${event.location}` : null,
    event.recurring ? '   recurring' : null,
  ].filter(Boolean).join('\n');
}

/**
 * Split events into those already judged and those still needing a verdict.
 * Lets a caller paint the calendar from cache before any model call is made.
 */
export function splitCached(events, commitmentTypes) {
  const assignments = new Map();
  if (!commitmentTypes.length) return { assignments, pending: [] };

  const version = typesFingerprint(commitmentTypes);
  const pending = [];
  for (const event of events) {
    const cached = cacheGet(cacheKey('type', version, event));
    if (cached !== undefined) {
      if (cached) assignments.set(event.id, cached);
    } else {
      pending.push(event);
    }
  }
  return { assignments, pending };
}

/**
 * Map of event id -> commitment type id. Events with no match are absent.
 * Reports how many verdicts came from cache, and calls
 * `onProgress(done, total, assignments)` after each batch so a caller can report
 * progress — and paint the colours already decided — while the rest runs.
 */
export async function classifyEvents(events, commitmentTypes, { apiKey, onProgress } = {}) {
  const stats = { cached: 0, fresh: 0 };
  if (!events.length || !commitmentTypes.length) return { assignments: new Map(), stats };

  const { assignments, pending } = splitCached(events, commitmentTypes);
  stats.cached = events.length - pending.length;
  stats.fresh = pending.length;
  if (!pending.length) return { assignments, stats };

  // Work in batches so progress is visible and one failure costs one batch.
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await classifyBatch(batch, commitmentTypes, apiKey, assignments);
    done += batch.length;
    onProgress?.(done, pending.length, assignments);
  }
  return { assignments, stats };
}

async function classifyBatch(unresolved, commitmentTypes, apiKey, assignments) {
  const version = typesFingerprint(commitmentTypes);
  const validIds = new Set(commitmentTypes.map(t => t.id));

  const applyFallback = () => {
    const keyword = classifyByKeyword(unresolved, commitmentTypes);
    for (const event of unresolved) {
      const typeId = keyword.get(event.id) || '';
      cacheSet(cacheKey('type', version, event), typeId);
      if (typeId) assignments.set(event.id, typeId);
    }
    return assignments;
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
          ...unresolved.map(describe),
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
      cacheSet(cacheKey('type', version, event), typeId);
      seen.add(assignment.eventIndex);
      if (typeId) assignments.set(event.id, typeId);
    }
    // Anything the model skipped counts as "no match" so it isn't re-asked.
    unresolved.forEach((event, i) => {
      if (!seen.has(i)) cacheSet(cacheKey('type', version, event), '');
    });
    return assignments;
  } catch (err) {
    console.error('[classify] falling back to keywords:', err.message);
    return applyFallback();
  }
}

// ---------------------------------------------------------------------------
// Report cache, shared with the per-event explanation
// ---------------------------------------------------------------------------
export function cachedReport(event, commitmentTypes) {
  return cacheGet(cacheKey('report', typesFingerprint(commitmentTypes), event));
}

export function cacheReport(event, commitmentTypes, report) {
  cacheSet(cacheKey('report', typesFingerprint(commitmentTypes), event), report);
}

/** Test/maintenance hook: forget everything. */
export function clearClassificationCache() {
  cache = new Map();
  scheduleSave();
}
