// The "calendaring agent": turns an event type's plain-text guidance into
// concrete scheduling rules, and turns those rules plus the owner's busy time
// into bookable slots.
//
// Claude reads the guidance once (when the event type is saved) and produces
// structured rules; slot generation itself is deterministic, so a booking page
// never depends on a model call and stays fast and predictable.
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_RULES = {
  durationMinutes: 30,
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
    durationMinutes: { type: 'integer', description: 'Meeting length in minutes' },
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
    'durationMinutes', 'horizonWeeks', 'timezone', 'weekdays', 'startMinute', 'endMinute',
    'slotIntervalMinutes', 'bufferMinutes', 'minNoticeHours', 'maxPerDay', 'summary',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You configure a scheduling page from a person's plain-language availability guidance.
Translate the guidance into concrete rules by calling set_rules exactly once.
Anything the guidance does not mention: use sensible professional defaults —
30 minute meetings, Monday to Friday, 9am to 5pm local time, two weeks ahead,
four hours notice. Interpret phrases like "afternoons", "no Fridays",
"half hour", "next month", "with 15 minutes between calls" faithfully.`;

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

  return {
    durationMinutes,
    horizonWeeks: clampInt(raw.horizonWeeks, 1, 12, DEFAULT_RULES.horizonWeeks),
    timezone: VALID_TZ(raw.timezone) ? raw.timezone : DEFAULT_RULES.timezone,
    weekdays: weekdays.length ? weekdays : DEFAULT_RULES.weekdays,
    startMinute,
    endMinute,
    slotIntervalMinutes: clampInt(raw.slotIntervalMinutes, 5, 4 * 60, Math.min(durationMinutes, 30)),
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

  const duration = text.match(/(\d+)\s*(?:-|\s)?\s*(min|minute)/);
  if (duration) rules.durationMinutes = Number(duration[1]);
  else if (/\bhalf[- ]hour\b/.test(text)) rules.durationMinutes = 30;
  else if (/\b(one|1)\s*hour\b|\b60\s*min/.test(text)) rules.durationMinutes = 60;

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
export async function interpretGuidance(guidance, { timezone } = {}) {
  // The caller passes the owner's own timezone; keep it unless the model
  // overrides it from the guidance text.
  const fallback = () => ({
    rules: normalizeRules({ ...rulesFromText(guidance), timezone: timezone || DEFAULT_RULES.timezone }),
    source: 'text',
  });
  if (!process.env.ANTHROPIC_API_KEY) return fallback();

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
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
    });

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

// Bookable slots grouped by local date.
export function generateSlots({ rules, busy = [], now = new Date(), takenStarts = [] }) {
  const {
    durationMinutes, horizonWeeks, timezone, weekdays, startMinute, endMinute,
    slotIntervalMinutes, bufferMinutes, minNoticeHours, maxPerDay,
  } = rules;

  const earliest = new Date(now.getTime() + minNoticeHours * 3600_000);
  const horizonEnd = new Date(now.getTime() + horizonWeeks * 7 * 86400_000);
  const taken = new Set(takenStarts.map(t => new Date(t).getTime()));
  const days = [];

  // Walk local calendar days from today until the horizon.
  for (let offset = 0; offset <= horizonWeeks * 7; offset++) {
    const dayAnchor = new Date(now.getTime() + offset * 86400_000);
    const { year, month, day, weekday, isoDate } = zonedParts(dayAnchor, timezone);
    if (!weekdays.includes(weekday)) continue;

    const slots = [];
    for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += slotIntervalMinutes) {
      const start = zonedTimeToUtc(year, month, day, minute, timezone);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (start < earliest || end > horizonEnd) continue;
      if (taken.has(start.getTime())) continue;

      const guardStart = new Date(start.getTime() - bufferMinutes * 60_000);
      const guardEnd = new Date(end.getTime() + bufferMinutes * 60_000);
      if (busy.some(b => overlaps(guardStart, guardEnd, b.start, b.end))) continue;

      slots.push({ start: start.toISOString(), end: end.toISOString() });
      if (maxPerDay && slots.length >= maxPerDay) break;
    }

    if (slots.length) days.push({ date: isoDate, slots });
  }

  return days;
}

// Is this exact start still offered? Used to re-check at booking time.
export function slotIsAvailable(startIso, days) {
  return days.some(d => d.slots.some(s => s.start === startIso));
}
