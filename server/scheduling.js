// The "calendaring agent": turns an event type's plain-text guidance into
// concrete scheduling rules, and turns those rules plus the owner's busy time
// into bookable slots.
//
// Claude reads the guidance once (when the event type is saved) and produces
// structured rules; slot generation itself is deterministic, so a booking page
// never depends on a model call and stays fast and predictable.
import { callClaude } from './llm.js';

export const DEFAULT_RULES = {
  // The default length. durationOptions holds every length on offer; when it has
  // more than one entry the booking page lets the visitor choose.
  durationMinutes: 30,
  durationOptions: [30],
  horizonWeeks: 2,
  timezone: 'America/Los_Angeles',
  // 0 = Sunday … 6 = Saturday
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 4,
  maxPerDay: 0, // 0 = unlimited
};

const RULES_SCHEMA = {
  type: 'object',
  properties: {
    durationMinutes: { type: 'integer', description: 'Default meeting length in minutes' },
    durationOptions: {
      type: 'array',
      description: 'Every meeting length offered, in minutes. Use a single entry unless the guidance offers a choice (e.g. "15, 30 or 60 minutes").',
      items: { type: 'integer' },
    },
    horizonWeeks: { type: 'integer', description: 'How many weeks ahead to offer, 1-12' },
    timezone: { type: 'string', description: 'IANA timezone for the working hours, e.g. America/New_York' },
    weekdays: {
      type: 'array',
      description: 'Days offered: 0=Sunday through 6=Saturday',
      items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] },
    },
    startMinute: { type: 'integer', description: 'Earliest start, minutes from local midnight (9am = 540)' },
    endMinute: { type: 'integer', description: 'Latest end, minutes from local midnight (5pm = 1020)' },
    slotIntervalMinutes: { type: 'integer', description: 'Spacing between slot start times' },
    bufferMinutes: { type: 'integer', description: 'Gap to leave around existing calendar events' },
    minNoticeHours: { type: 'integer', description: 'Minimum notice before the first bookable slot' },
    maxPerDay: { type: 'integer', description: 'Maximum bookings offered per day, 0 for unlimited' },
    summary: { type: 'string', description: 'One short sentence describing the availability, shown on the booking page' },
  },
  required: [
    'durationMinutes', 'durationOptions', 'horizonWeeks', 'timezone', 'weekdays', 'startMinute', 'endMinute',
    'slotIntervalMinutes', 'bufferMinutes', 'minNoticeHours', 'maxPerDay', 'summary',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You configure a scheduling page from a person's plain-language availability guidance.
Translate the guidance into concrete rules by calling set_rules exactly once.
Anything the guidance does not mention: use sensible professional defaults —
30 minute meetings, Monday to Friday, 9am to 5pm local time, two weeks ahead,
four hours notice. Interpret phrases like "afternoons", "no Fridays",
"half hour", "next month", "with 15 minutes between calls" faithfully.
When the guidance offers a choice of lengths ("15, 30 or 60 minutes",
"quick chat or a full hour"), list them all in durationOptions and make
durationMinutes the most likely default.`;

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const VALID_TZ = tz => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

// Bring anything the model (or a human) produced into a usable shape.
export function normalizeRules(raw = {}) {
  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : DEFAULT_RULES.weekdays;

  const startMinute = clampInt(raw.startMinute, 0, 24 * 60 - 15, DEFAULT_RULES.startMinute);
  let endMinute = clampInt(raw.endMinute, 15, 24 * 60, DEFAULT_RULES.endMinute);
  if (endMinute <= startMinute) endMinute = Math.min(24 * 60, startMinute + 60);

  const durationMinutes = clampInt(raw.durationMinutes, 5, 8 * 60, DEFAULT_RULES.durationMinutes);

  // Every offered length, de-duplicated and sorted; the default is always one of them.
  const rawOptions = Array.isArray(raw.durationOptions) && raw.durationOptions.length
    ? raw.durationOptions
    : [durationMinutes];
  const durationOptions = [...new Set(
    rawOptions.map(d => clampInt(d, 5, 8 * 60, durationMinutes))
  )].sort((a, b) => a - b);
  if (!durationOptions.includes(durationMinutes)) durationOptions.push(durationMinutes);
  durationOptions.sort((a, b) => a - b);

  return {
    durationMinutes,
    durationOptions,
    horizonWeeks: clampInt(raw.horizonWeeks, 1, 12, DEFAULT_RULES.horizonWeeks),
    timezone: VALID_TZ(raw.timezone) ? raw.timezone : DEFAULT_RULES.timezone,
    weekdays: weekdays.length ? weekdays : DEFAULT_RULES.weekdays,
    startMinute,
    endMinute,
    // Slots line up on a grid shared by every offered length, so switching
    // duration doesn't shift the start times around.
    slotIntervalMinutes: clampInt(
      raw.slotIntervalMinutes, 5, 4 * 60, Math.min(durationOptions[0], 30)
    ),
    bufferMinutes: clampInt(raw.bufferMinutes, 0, 2 * 60, DEFAULT_RULES.bufferMinutes),
    minNoticeHours: clampInt(raw.minNoticeHours, 0, 30 * 24, DEFAULT_RULES.minNoticeHours),
    maxPerDay: clampInt(raw.maxPerDay, 0, 50, DEFAULT_RULES.maxPerDay),
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : '',
  };
}

// Best-effort reading of the guidance without an API key, so the app is usable
// (and testable) with no ANTHROPIC_API_KEY configured.
export function rulesFromText(guidance = '') {
  const text = guidance.toLowerCase();
  const rules = { ...DEFAULT_RULES };

  // "30 minute", "15, 30 or 60 minute", "15/30/60 min"
  const durations = new Set();
  const durationPhrase = text.match(/((?:\d+\s*(?:,|\/|or|and|-)\s*)*\d+)\s*(?:-|\s)?\s*(?:min|minute)/);
  if (durationPhrase) {
    for (const n of durationPhrase[1].match(/\d+/g) || []) durations.add(Number(n));
  }
  if (/\bhalf[- ]hour\b/.test(text)) durations.add(30);
  if (/\b(one|1)\s*hour\b/.test(text)) durations.add(60);
  if (durations.size) {
    rules.durationOptions = [...durations].sort((a, b) => a - b);
    rules.durationMinutes = rules.durationOptions[0];
  }

  const weeks = text.match(/(\d+)\s*week/);
  if (weeks) rules.horizonWeeks = Number(weeks[1]);
  else if (/\bnext month\b/.test(text)) rules.horizonWeeks = 4;

  const hours = text.match(/(\d{1,2})\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})\s*(am|pm)/);
  if (hours) {
    const to24 = (h, mer) => {
      let n = Number(h) % 12;
      if (mer === 'pm') n += 12;
      return n;
    };
    const endMer = hours[4];
    const startMer = hours[2] || (Number(hours[1]) < Number(hours[3]) ? endMer : 'am');
    rules.startMinute = to24(hours[1], startMer) * 60;
    rules.endMinute = to24(hours[3], endMer) * 60;
  } else if (/\bafternoon/.test(text)) {
    rules.startMinute = 12 * 60;
    rules.endMinute = 17 * 60;
  } else if (/\bmorning/.test(text)) {
    rules.startMinute = 9 * 60;
    rules.endMinute = 12 * 60;
  }

  if (/\bno fridays?\b|\bexcept fridays?\b/.test(text)) rules.weekdays = [1, 2, 3, 4];
  if (/\bweekends? (only|included)\b/.test(text)) rules.weekdays = [0, 6];

  const notice = text.match(/(\d+)\s*(hour|hr)s?\s*(?:of\s*)?notice/);
  if (notice) rules.minNoticeHours = Number(notice[1]);
  const buffer = text.match(/(\d+)\s*min\w*\s*(?:gap|buffer|between)/);
  if (buffer) rules.bufferMinutes = Number(buffer[1]);

  rules.slotIntervalMinutes = Math.min(rules.durationMinutes, 30);
  rules.summary = '';
  return normalizeRules(rules);
}

// Ask Claude to read the guidance. Falls back to rulesFromText on any failure so
// saving an event type never breaks because of the model or a missing key.
export async function interpretGuidance(guidance, { timezone, apiKey, email, keySource } = {}) {
  // The caller passes the owner's own timezone; keep it unless the model
  // overrides it from the guidance text.
  const fallback = () => ({
    rules: normalizeRules({ ...rulesFromText(guidance), timezone: timezone || DEFAULT_RULES.timezone }),
    source: 'text',
  });
  if (!apiKey) return fallback();

  try {
    const response = await callClaude({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [{
        name: 'set_rules',
        description: 'Record the scheduling rules implied by the guidance.',
        strict: true,
        input_schema: RULES_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'set_rules' },
      messages: [{
        role: 'user',
        content: `The person's calendar timezone is ${timezone || DEFAULT_RULES.timezone}.\n\nAvailability guidance:\n"""\n${guidance}\n"""`,
      }],
    }, { apiKey, email, keySource, feature: 'guidance' });

    const block = response.content.find(b => b.type === 'tool_use');
    if (!block) return fallback();
    return { rules: normalizeRules(block.input), source: 'claude' };
  } catch (err) {
    console.error('[scheduling] guidance interpretation failed:', err.message);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Timezone-aware slot generation
// ---------------------------------------------------------------------------

// Offset between a timezone and UTC at a given instant, in milliseconds.
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asUtc - date.getTime();
}

// The instant at which a given local wall-clock time occurs in a timezone.
// Two passes settle DST transitions, where the offset depends on the answer.
export function zonedTimeToUtc(year, month, day, minutes, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

// Local calendar date + weekday for an instant, in a timezone.
export function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayIndex,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Merge overlapping/adjacent intervals into a tidy, sorted list. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  return merged;
}

/** `base` with every part of `cut` removed. */
function subtractIntervals(base, cut) {
  let pieces = base.map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
  for (const hole of mergeIntervals(cut)) {
    const next = [];
    for (const piece of pieces) {
      if (!overlaps(piece.start, piece.end, hole.start, hole.end)) {
        next.push(piece);
        continue;
      }
      if (piece.start < hole.start) next.push({ start: piece.start, end: new Date(hole.start) });
      if (piece.end > hole.end) next.push({ start: new Date(hole.end), end: piece.end });
    }
    pieces = next;
  }
  return pieces;
}



// Bookable slots grouped by local date.
//
// Every candidate on the grid is put through diagnoseSlot, and a slot is offered
// exactly when that returns no reasons. The diagnoses are returned alongside, so
// "why isn't this open?" is answered by the very same computation that decided
// it — the two can't drift apart.
export function generateSlots({
  rules,
  busy = [],
  now = new Date(),
  takenStarts = [],
  durationMinutes: durationOverride,
  events = [],
  assignments = new Map(),
  commitmentTypes = [],
  bookOver = [],
  drops = [],
} = {}) {
  const { horizonWeeks, timezone, startMinute, endMinute, slotIntervalMinutes } = rules;
  const durationMinutes = durationOverride || rules.durationMinutes;

  const days = [];
  const diagnoses = new Map();

  for (let offset = 0; offset <= horizonWeeks * 7; offset++) {
    const dayAnchor = new Date(now.getTime() + offset * 86400_000);
    const { year, month, day, isoDate } = zonedParts(dayAnchor, timezone);

    const slots = [];
    let offeredThatDay = 0;
    for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += slotIntervalMinutes) {
      const start = zonedTimeToUtc(year, month, day, minute, timezone);
      const startIso = start.toISOString();

      const diagnosis = diagnoseSlot({
        rules,
        start: startIso,
        durationMinutes,
        busy,
        events,
        assignments,
        commitmentTypes,
        bookOver,
        takenStarts,
        drops,
        offeredThatDay,
        now,
      });
      diagnoses.set(startIso, diagnosis);

      if (diagnosis.open) {
        slots.push({ start: startIso, end: new Date(start.getTime() + durationMinutes * 60_000).toISOString() });
        offeredThatDay++;
      }
    }

    if (slots.length) days.push({ date: isoDate, slots });
  }

  return { days, diagnoses };
}

/**
 * The date keys of a run of business days (Monday to Friday), counted in the
 * given timezone. Today counts as business day 1 when it is a weekday,
 * otherwise the next weekday does — so "within the next 5 business days"
 * includes what is left of today.
 */
export function businessDayKeys({ from, to, timezone, now = new Date() }) {
  const first = Math.max(1, Math.floor(from));
  const last = Math.max(first, Math.floor(to));
  const keys = [];

  let index = 0;
  // 60 calendar days is far more than 30 business days, the cap on `to`.
  for (let offset = 0; offset <= 60 && index < last; offset++) {
    const at = new Date(now.getTime() + offset * 86400_000);
    const { weekday, isoDate } = zonedParts(at, timezone);
    if (weekday === 0 || weekday === 6) continue; // Sunday, Saturday
    index++;
    if (index >= first) keys.push(isoDate);
  }
  return keys;
}

/**
 * The first `count` open slots that fall inside a business-day window.
 * `days` is what generateSlots produced, so this only ever narrows what is
 * genuinely bookable.
 */
export function slotsInBusinessDays({ days, count, from, to, timezone, now = new Date() }) {
  const keys = new Set(businessDayKeys({ from, to, timezone, now }));
  const slots = days
    .filter(day => keys.has(day.date))
    .flatMap(day => day.slots)
    .sort((a, b) => a.start.localeCompare(b.start));
  return { slots: slots.slice(0, count), consideredDays: [...keys].sort(), totalAvailable: slots.length };
}

// Is this exact start still offered? Used to re-check at booking time.
export function slotIsAvailable(startIso, days) {
  return days.some(d => d.slots.some(s => s.start === startIso));
}

/**
 * Why a particular time is or isn't offered. Every check is deterministic and
 * mirrors generateSlots, so the answer is always the true reason — the model is
 * only ever asked to phrase it, never to work it out.
 */
export function diagnoseSlot({
  rules,
  start,
  durationMinutes,
  busy = [],
  events = [],
  assignments = new Map(),
  commitmentTypes = [],
  bookOver = [],
  takenStarts = [],
  drops = [],
  offeredThatDay = 0,
  now = new Date(),
}) {
  const duration = durationMinutes || rules.durationMinutes;
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + duration * 60_000);
  const tz = rules.timezone;
  const { weekday, isoDate } = zonedParts(startDate, tz);
  const minute = (() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(startDate).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return Number(parts.hour) % 24 * 60 + Number(parts.minute);
  })();

  const reasons = [];
  const typeName = id => commitmentTypes.find(t => t.id === id)?.name || null;

  if (!rules.weekdays.includes(weekday)) {
    reasons.push({
      code: 'outside-days',
      detail: `${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][weekday]} is not one of the days this event type offers.`,
    });
  }
  if (minute < rules.startMinute || minute + duration > rules.endMinute) {
    reasons.push({
      code: 'outside-hours',
      detail: `A ${duration} minute meeting starting then falls outside the bookable window for this event type.`,
    });
  }
  if ((minute - rules.startMinute) % rules.slotIntervalMinutes !== 0) {
    reasons.push({
      code: 'off-grid',
      detail: `Slots start every ${rules.slotIntervalMinutes} minutes from the start of the window, and this time isn't on that grid.`,
    });
  }
  if (startDate < new Date(now.getTime() + rules.minNoticeHours * 3600_000)) {
    reasons.push({
      code: 'too-soon',
      detail: rules.minNoticeHours
        ? `It is inside the ${rules.minNoticeHours} hour notice period.`
        : 'It is in the past.',
    });
  }
  if (startDate > new Date(now.getTime() + rules.horizonWeeks * 7 * 86400_000)) {
    reasons.push({
      code: 'past-horizon',
      detail: `It is beyond the ${rules.horizonWeeks} week booking horizon.`,
    });
  }
  if (takenStarts.some(t => new Date(t).getTime() === startDate.getTime())) {
    reasons.push({ code: 'already-booked', detail: 'Someone has already booked this exact slot.' });
  }
  if (rules.maxPerDay && offeredThatDay >= rules.maxPerDay) {
    reasons.push({
      code: 'max-per-day',
      detail: `This event type offers at most ${rules.maxPerDay} slots a day and that day is full.`,
    });
  }

  // Calendar conflicts, named — including the buffer, and whether the entry
  // would have been overridable.
  const guardStart = new Date(startDate.getTime() - rules.bufferMinutes * 60_000);
  const guardEnd = new Date(endDate.getTime() + rules.bufferMinutes * 60_000);
  const conflicts = events.filter(e =>
    !e.allDay && overlaps(guardStart, guardEnd, new Date(e.start), new Date(e.end))
  );
  for (const event of conflicts) {
    const typeId = assignments.get(event.id);
    const overridable = typeId && bookOver.includes(typeId);
    if (overridable) continue; // this one was already booked over
    const direct = overlaps(startDate, endDate, new Date(event.start), new Date(event.end));
    reasons.push({
      code: direct ? 'conflict' : 'buffer-conflict',
      detail: direct
        ? `"${event.summary}" is on your calendar then${typeName(typeId) ? ` (${typeName(typeId)})` : ''}.`
        : `"${event.summary}" is close enough that the ${rules.bufferMinutes} minute buffer around it covers this time.`,
      event: { summary: event.summary, start: event.start, end: event.end, commitmentType: typeName(typeId) },
    });
  }

  // Busy time that no overridable commitment accounts for — another calendar, or
  // an entry we can't read. Subtracting the overridable intervals means a focus
  // block you allow booking over doesn't leave a phantom "busy" behind, while a
  // genuinely opaque block still blocks.
  const overridableIntervals = events
    .filter(e => !e.allDay && e.start && e.end && bookOver.includes(assignments.get(e.id)))
    .map(e => ({ start: new Date(e.start), end: new Date(e.end) }));
  const overlappingBusy = busy.filter(b => overlaps(guardStart, guardEnd, b.start, b.end));
  const unexplainedBusy = subtractIntervals(overlappingBusy, [
    ...overridableIntervals,
    ...conflicts.map(e => ({ start: new Date(e.start), end: new Date(e.end) })),
  ]);
  if (unexplainedBusy.some(b => overlaps(guardStart, guardEnd, b.start, b.end))) {
    reasons.push({
      code: 'busy',
      detail: 'Your calendar reports you as busy then, though no event title was available.',
    });
  }

  const dropped = drops.find(d => new Date(d.start).getTime() === startDate.getTime());
  if (dropped) {
    reasons.push({
      code: 'dropped-by-review',
      detail: `The commitment-aware review removed it: ${dropped.reason}`,
    });
  }

  return {
    open: reasons.length === 0,
    reasons,
    context: { date: isoDate, durationMinutes: duration, timezone: tz },
  };
}

// ---------------------------------------------------------------------------
// Commitment-aware slot review
// ---------------------------------------------------------------------------
// Slot generation is deterministic — rules plus free/busy. That handles "when am
// I free", but not intent expressed in the guidance about *what* the surrounding
// commitments are: "not straight after a customer call", "keep a gap around
// interviews", "no more than two customer calls a day".
//
// So the candidates are computed first, then reviewed once with the day's
// commitments and their commitment types in context. The model can only remove
// slots, never invent them, so a bad answer costs availability rather than
// double-booking someone.
const REVIEW_SYSTEM = `You refine a list of already-free meeting slots.

The slots are all genuinely free on the person's calendar. Your job is to drop
the ones their availability guidance implies they would not want, given what
else is on the calendar that day and what kind of commitment each entry is.

Rules:
- Only drop slots. Never add or move one.
- Drop a slot only when the guidance actually implies it. If the guidance says
  nothing that bears on a slot, keep it.
- Typical reasons to drop: too close to a particular kind of commitment, too many
  of one kind of meeting in a day, a day the guidance treats as protected.
- Be conservative: keeping a slot the person did not want is a smaller problem
  than emptying their calendar. If in doubt, keep it.
- Give a short reason for each drop, naming the commitment it relates to.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    drops: {
      type: 'array',
      description: 'Slots to remove. Empty when the guidance implies no removals.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'The slot\'s local date, YYYY-MM-DD' },
          time: { type: 'string', description: 'The slot\'s local start time, HH:MM (24 hour)' },
          reason: { type: 'string', description: 'One short sentence' },
        },
        required: ['date', 'time', 'reason'],
        additionalProperties: false,
      },
    },
    note: {
      type: 'string',
      description: 'One sentence on what was applied, or why nothing was dropped.',
    },
  },
  required: ['drops', 'note'],
  additionalProperties: false,
};

/** "HH:MM" for an instant, in a timezone. */
function localTime(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso)).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.hour}:${parts.minute}`;
}

function localDate(iso, timeZone) {
  return zonedParts(new Date(iso), timeZone).isoDate;
}

/**
 * Filter candidate slots using the guidance plus the day's classified
 * commitments. Returns the surviving days, the drops and a note. Falls back to
 * the candidates untouched when there is no API key or the call fails.
 */
export async function reviewSlots({
  guidance,
  rules,
  days,
  events = [],
  commitmentTypes = [],
  assignments = new Map(),
  apiKey,
  email,
  keySource,
}) {
  const unchanged = { days, drops: [], note: null, reviewed: false };
  if (!apiKey || !days.length || !guidance) return unchanged;

  const tz = rules.timezone;
  const typeName = id => commitmentTypes.find(t => t.id === id)?.name || 'unclassified';

  // Only the days that actually have candidates are worth describing.
  const dayKeys = new Set(days.flatMap(d => d.slots.map(s => localDate(s.start, tz))));
  const eventsByDate = new Map();
  for (const event of events) {
    if (event.allDay) continue;
    const key = localDate(event.start, tz);
    if (!dayKeys.has(key)) continue;
    eventsByDate.set(key, [...(eventsByDate.get(key) || []), event]);
  }

  const lines = [];
  for (const key of [...dayKeys].sort()) {
    lines.push(`${key}:`);
    const dayEvents = eventsByDate.get(key) || [];
    lines.push(dayEvents.length
      ? `  commitments: ${dayEvents
          .map(e => `${localTime(e.start, tz)}-${localTime(e.end, tz)} "${e.summary}" [${typeName(assignments.get(e.id))}]`)
          .join('; ')}`
      : '  commitments: none');
    const times = days
      .flatMap(d => d.slots)
      .filter(s => localDate(s.start, tz) === key)
      .map(s => localTime(s.start, tz));
    lines.push(`  free slots: ${times.join(', ')}`);
  }

  try {
    const response = await callClaude({
      model: 'claude-opus-5',
      max_tokens: 8000,
      system: REVIEW_SYSTEM,
      tools: [{
        name: 'drop_slots',
        description: 'Record which slots to remove and why.',
        strict: true,
        input_schema: REVIEW_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'drop_slots' },
      messages: [{
        role: 'user',
        content: [
          `Availability guidance (verbatim):\n"""\n${guidance}\n"""`,
          '',
          `Meeting length: ${rules.durationMinutes} minutes. Times are local to ${tz}.`,
          commitmentTypes.length
            ? `Commitment types: ${commitmentTypes.map(t => `${t.name} — ${t.condition}`).join('; ')}`
            : 'No commitment types are defined.',
          '',
          'Days:',
          ...lines,
        ].join('\n'),
      }],
    }, { apiKey, email, keySource, feature: 'slot-review' });

    const block = response.content.find(b => b.type === 'tool_use');
    if (!block) return unchanged;

    // Match drops back to real slots; anything unrecognised is ignored rather
    // than guessed at.
    const dropKeys = new Set((block.input.drops || []).map(d => `${d.date} ${d.time}`));
    const drops = [];
    const filtered = days
      .map(day => {
        const kept = day.slots.filter(slot => {
          const key = `${localDate(slot.start, tz)} ${localTime(slot.start, tz)}`;
          if (!dropKeys.has(key)) return true;
          const match = (block.input.drops || []).find(d => `${d.date} ${d.time}` === key);
          drops.push({ start: slot.start, reason: match?.reason || '' });
          return false;
        });
        return { ...day, slots: kept };
      })
      .filter(day => day.slots.length);

    return { days: filtered, drops, note: block.input.note || null, reviewed: true };
  } catch (err) {
    console.error('[scheduling] slot review failed:', err.message);
    return unchanged;
  }
}
