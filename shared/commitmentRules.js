// Rule-based classification of calendar entries into commitment types.
//
// Shared by the server (which labels the calendar for slot-finding and the
// assistant) and the browser (which previews rules live while you edit them),
// so both always give the same answer. No model is involved: an entry belongs
// to the first commitment type, in list order, that has a rule all of whose
// conditions hold.
//
// A commitment type:  { id, name, mode, description, rules: [{ id, conditions: [Condition] }] }
//
// mode "rules" (the default) matches by the rules below. mode "ai" lets a model
// decide from the description instead; its verdicts are worked out on the
// server and passed in as context.aiMatches (Map of type id -> Set of event ids).
// A condition:        { field, op, value }
//
//   field         ops                                   value
//   title         contains | notContains | is | startsWith   text; commas mean "any of"
//   duration      atLeast | atMost | is                  minutes
//   start         atOrAfter | before                     "HH:MM", in the owner's timezone
//   day           isOneOf                                ["mon", "tue", ...]
//   allDay        is                                     true | false
//   organizer     isMe | isNotMe | internal | external   —
//   organizer     emailContains                          text; commas mean "any of"
//   attendees     anyEmailContains | noEmailContains     text; commas mean "any of"
//   attendees     anyExternal | allInternal              —
//   attendeeCount atLeast | atMost                       number of other people
//
// "Internal" means on the owner's own email domain. Meeting rooms and the
// owner themselves never count as attendees.

export const FIELDS = {
  title: {
    label: 'Title',
    ops: { contains: 'contains', notContains: 'does not contain', is: 'is exactly', startsWith: 'starts with' },
    value: 'text',
  },
  duration: {
    label: 'Duration',
    ops: { atLeast: 'is at least', atMost: 'is at most', is: 'is exactly' },
    value: 'minutes',
  },
  start: {
    label: 'Start time',
    ops: { atOrAfter: 'is at or after', before: 'is before' },
    value: 'time',
  },
  day: {
    label: 'Day',
    ops: { isOneOf: 'is one of' },
    value: 'days',
  },
  allDay: {
    label: 'All-day',
    ops: { is: 'is' },
    value: 'boolean',
  },
  organizer: {
    label: 'Organizer',
    ops: {
      isMe: 'is me',
      isNotMe: 'is not me',
      internal: 'is on my domain',
      external: 'is outside my domain',
      emailContains: 'email contains',
    },
    value: { emailContains: 'text' },
  },
  attendees: {
    label: 'Attendees',
    ops: {
      anyEmailContains: 'include an email containing',
      noEmailContains: 'include no email containing',
      anyExternal: 'include someone outside my domain',
      allInternal: 'are all on my domain',
    },
    value: { anyEmailContains: 'text', noEmailContains: 'text' },
  },
  attendeeCount: {
    label: 'Number of attendees',
    ops: { atLeast: 'is at least', atMost: 'is at most' },
    value: 'number',
  },
};

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** The kind of value a field/op pair takes, or null when it takes none. */
export function valueKind(field, op) {
  const spec = FIELDS[field];
  if (!spec) return null;
  if (typeof spec.value === 'string') return spec.value;
  return spec.value[op] || null;
}

/** A blank condition for a field, with its first op and a sensible value. */
export function defaultCondition(field = 'title') {
  const op = Object.keys(FIELDS[field].ops)[0];
  return { field, op, value: defaultValue(valueKind(field, op)) };
}

export function defaultValue(kind) {
  switch (kind) {
    case 'minutes': return 30;
    case 'number': return 1;
    case 'time': return '12:00';
    case 'days': return ['mon', 'tue', 'wed', 'thu', 'fri'];
    case 'boolean': return true;
    case 'text': return '';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Validation — the server keeps only well-formed rules.
// ---------------------------------------------------------------------------
export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, 50).map((rule, i) => ({
    id: typeof rule?.id === 'string' && rule.id.length <= 40 ? rule.id : `r${Date.now().toString(36)}${i}`,
    conditions: (Array.isArray(rule?.conditions) ? rule.conditions : [])
      .slice(0, 20)
      .map(sanitizeCondition)
      .filter(Boolean),
  })).filter(rule => rule.conditions.length);
}

function sanitizeCondition(c) {
  if (!c || !FIELDS[c.field] || !FIELDS[c.field].ops[c.op]) return null;
  const kind = valueKind(c.field, c.op);
  let value = null;
  switch (kind) {
    case 'text':
      value = String(c.value ?? '').slice(0, 500).trim();
      if (!value) return null;
      break;
    case 'minutes':
    case 'number':
      value = Math.max(0, Math.min(100000, Math.round(Number(c.value))));
      if (!Number.isFinite(value)) return null;
      break;
    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.value))) return null;
      value = String(c.value);
      break;
    case 'days':
      value = DAYS.filter(d => Array.isArray(c.value) && c.value.includes(d));
      if (!value.length) return null;
      break;
    case 'boolean':
      value = c.value === true || c.value === 'true';
      break;
    default:
      value = null;
  }
  return { field: c.field, op: c.op, value };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
const terms = text =>
  String(text || '')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

const domainOf = email => String(email || '').toLowerCase().split('@')[1] || '';
const isRoom = email => /resource\.calendar\.google\.com$/i.test(email || '');

const formatters = new Map();
function localParts(iso, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return {
    day: String(parts.weekday).slice(0, 3).toLowerCase(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const toMinutes = hhmm => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** What the rules can see about one entry. */
export function eventFacts(event, { timezone, ownerEmail }) {
  const owner = String(ownerEmail || '').toLowerCase();
  const myDomain = domainOf(owner);
  const start = event.start;
  const durationMinutes = Math.round((new Date(event.end) - new Date(start)) / 60000);
  const local = event.allDay
    // An all-day entry's date has no time; its day is the date itself.
    ? { day: DAYS[(new Date(`${String(start).slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7], minutes: null }
    : localParts(start, timezone || 'UTC');
  const organizerEmail = String(event.organizer?.email || '').toLowerCase();
  const people = (event.attendees || [])
    .map(a => ({ ...a, email: String(a.email || '').toLowerCase() }))
    .filter(a => a.email && !a.self && a.email !== owner && !isRoom(a.email));
  return {
    title: String(event.summary || ''),
    durationMinutes,
    allDay: !!event.allDay,
    day: local.day,
    startMinutes: local.minutes,
    organizerEmail,
    organizerIsMe: !!event.organizer?.self || (organizerEmail && organizerEmail === owner) || !organizerEmail,
    organizerInternal: !organizerEmail || domainOf(organizerEmail) === myDomain,
    attendeeEmails: people.map(a => a.email),
    myDomain,
  };
}

/** Does one condition hold for an entry's facts? */
export function conditionHolds(c, f) {
  const title = f.title.toLowerCase();
  switch (c.field) {
    case 'title': {
      if (c.op === 'is') return title.trim() === String(c.value).trim().toLowerCase();
      const list = terms(c.value);
      if (c.op === 'contains') return list.some(t => title.includes(t));
      if (c.op === 'notContains') return !list.some(t => title.includes(t));
      if (c.op === 'startsWith') return list.some(t => title.trimStart().startsWith(t));
      return false;
    }
    case 'duration':
      if (c.op === 'atLeast') return f.durationMinutes >= c.value;
      if (c.op === 'atMost') return f.durationMinutes <= c.value;
      if (c.op === 'is') return f.durationMinutes === c.value;
      return false;
    case 'start':
      if (f.startMinutes === null) return false;
      if (c.op === 'atOrAfter') return f.startMinutes >= toMinutes(c.value);
      if (c.op === 'before') return f.startMinutes < toMinutes(c.value);
      return false;
    case 'day':
      return Array.isArray(c.value) && c.value.includes(f.day);
    case 'allDay':
      return f.allDay === !!c.value;
    case 'organizer':
      if (c.op === 'isMe') return f.organizerIsMe;
      if (c.op === 'isNotMe') return !f.organizerIsMe;
      if (c.op === 'internal') return f.organizerInternal;
      if (c.op === 'external') return !f.organizerInternal;
      if (c.op === 'emailContains') return terms(c.value).some(t => f.organizerEmail.includes(t));
      return false;
    case 'attendees': {
      const list = terms(c.value);
      if (c.op === 'anyEmailContains') return f.attendeeEmails.some(e => list.some(t => e.includes(t)));
      if (c.op === 'noEmailContains') return !f.attendeeEmails.some(e => list.some(t => e.includes(t)));
      if (c.op === 'anyExternal') return f.attendeeEmails.some(e => domainOf(e) !== f.myDomain);
      if (c.op === 'allInternal') return f.attendeeEmails.every(e => domainOf(e) === f.myDomain);
      return false;
    }
    case 'attendeeCount':
      if (c.op === 'atLeast') return f.attendeeEmails.length >= c.value;
      if (c.op === 'atMost') return f.attendeeEmails.length <= c.value;
      return false;
    default:
      return false;
  }
}

const ruleHolds = (rule, f) => rule.conditions.length > 0 && rule.conditions.every(c => conditionHolds(c, f));

/**
 * Which rule of a type matches (its index), -1 for an AI-decided match, or
 * null for no match.
 */
export function typeMatch(type, event, facts, context) {
  if (type.mode === 'ai') return context?.aiMatches?.get(type.id)?.has(event.id) ? -1 : null;
  const i = (type.rules || []).findIndex(rule => ruleHolds(rule, facts));
  return i >= 0 ? i : null;
}

/**
 * Label entries: Map of event id -> { typeId, ruleIndex } for the first type
 * (in the order given) that matches. ruleIndex is -1 when AI decided.
 * Unmatched entries are absent.
 */
export function classifyEvents(events, commitmentTypes, context) {
  const out = new Map();
  for (const event of events) {
    const f = eventFacts(event, context);
    for (const type of commitmentTypes) {
      const ruleIndex = typeMatch(type, event, f, context);
      if (ruleIndex !== null) {
        out.set(event.id, { typeId: type.id, ruleIndex });
        break;
      }
    }
  }
  return out;
}

/** Just event id -> commitment type id, the shape slot-finding works with. */
export function assignmentsFor(events, commitmentTypes, context) {
  const out = new Map();
  for (const [id, m] of classifyEvents(events, commitmentTypes, context)) out.set(id, m.typeId);
  return out;
}

/**
 * Every type, rule and condition checked against one entry — the "why" behind
 * its label.
 */
export function explainEvent(event, commitmentTypes, context) {
  const f = eventFacts(event, context);
  let winner = null;
  const types = commitmentTypes.map(type => {
    const rules = (type.rules || []).map(rule => {
      const conditions = rule.conditions.map(c => ({ ...c, holds: conditionHolds(c, f), text: describeCondition(c) }));
      return { id: rule.id, holds: conditions.length > 0 && conditions.every(c => c.holds), conditions };
    });
    const matches = type.mode === 'ai' ? typeMatch(type, event, f, context) !== null : rules.some(r => r.holds);
    if (matches && !winner) winner = type.id;
    return { typeId: type.id, matches, rules };
  });
  return { facts: f, typeId: winner, types };
}

// ---------------------------------------------------------------------------
// Plain-English descriptions — shown in the UI, and handed to the slot review
// and the calendar assistant so they know what each type means.
// ---------------------------------------------------------------------------
const quoteList = value => terms(value).map(t => `“${t}”`).join(' or ');

const clock = hhmm => {
  const m = toMinutes(hhmm);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm}${h < 12 ? 'am' : 'pm'}`;
};

export function describeCondition(c) {
  const spec = FIELDS[c.field];
  if (!spec) return '';
  const op = spec.ops[c.op] || c.op;
  const kind = valueKind(c.field, c.op);
  let value = '';
  if (kind === 'text') value = c.op === 'is' ? `“${c.value}”` : quoteList(c.value);
  else if (kind === 'minutes') value = `${c.value} min`;
  else if (kind === 'number') value = String(c.value);
  else if (kind === 'time') value = clock(c.value);
  else if (kind === 'days') value = (c.value || []).map(d => DAY_LABELS[d]).join(', ');
  else if (kind === 'boolean') value = c.value ? 'yes' : 'no';
  return `${spec.label.toLowerCase()} ${op}${value ? ` ${value}` : ''}`;
}

export function describeRule(rule) {
  return rule.conditions.map(describeCondition).join(' and ');
}

export function describeRules(rules) {
  if (!rules?.length) return 'no rules yet';
  return rules.map(describeRule).join('; or ');
}
