// The calendar assistant: answers questions about what is actually on the
// owner's calendar. Events are rendered into a compact transcript and handed to
// Claude with the question — the model never calls Google directly.
import { callClaude } from './llm.js';

const SYSTEM_PROMPT = `You answer questions about one person's calendar.

You are given their calendar entries, each with the title, start and end time,
who organized it, the invited guests and their responses, the location, and the
commitment type it was classified as (when the person has defined any).

Rules:
- Answer only from the entries provided. If the answer isn't there, say so
  plainly rather than guessing.
- Times in the entries are already in the person's own timezone; use the same
  clock times in your answer and don't convert.
- Be concise and concrete: name the meeting, the day and the time. Prefer a short
  list over a paragraph when several entries are involved.
- "Me", "my" and "I" refer to the calendar's owner.
- Counting and totalling questions ("how many hours of customer calls next
  week") are expected — do the arithmetic and show the total.`;

const RESPONSE_STATUS = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
  needsAction: 'no reply',
};

// One line per event: dense enough to fit hundreds, complete enough to answer
// "who set it up", "who is coming", "when does it start and end".
function renderEvent(event, timezone, commitmentName) {
  const fmt = (iso, withDate) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: timezone,
      ...(withDate ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
    });

  const when = event.allDay
    ? `${event.start} (all day)`
    : `${fmt(event.start, true)} – ${fmt(event.end, false)}`;

  const organizer = event.organizer
    ? `${event.organizer.name || event.organizer.email}${event.organizer.self ? ' (me)' : ''}`
    : 'unknown';

  const guests = event.attendees.length
    ? event.attendees
        .map(a => {
          const who = a.name || a.email;
          const flags = [
            a.self ? 'me' : null,
            a.organizer ? 'organizer' : null,
            a.optional ? 'optional' : null,
            RESPONSE_STATUS[a.responseStatus] || a.responseStatus,
          ].filter(Boolean);
          return `${who} [${flags.join(', ')}]`;
        })
        .join('; ')
    : 'none';

  return [
    `- "${event.summary}"`,
    `  when: ${when}`,
    `  organizer: ${organizer}`,
    `  guests: ${guests}`,
    event.location ? `  location: ${event.location}` : null,
    commitmentName ? `  commitment type: ${commitmentName}` : null,
    event.recurring ? '  recurring: yes' : null,
  ].filter(Boolean).join('\n');
}

export function buildCalendarContext({ events, timezone, commitmentTypes = [], assignments = new Map() }) {
  const typeName = id => commitmentTypes.find(t => t.id === id)?.name || null;
  const now = new Date().toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const lines = events.map(e => renderEvent(e, timezone, typeName(assignments.get(e.id))));

  return [
    `Right now it is ${now} (${timezone}).`,
    commitmentTypes.length
      ? `Commitment types defined: ${commitmentTypes.map(t => `${t.name} — ${t.condition}`).join('; ')}`
      : 'No commitment types are defined.',
    '',
    events.length ? `Calendar entries (${events.length}):` : 'There are no calendar entries in this window.',
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Per-event commitment report
// ---------------------------------------------------------------------------
const EXPLAIN_SYSTEM = `You judge whether one calendar entry satisfies each of a
person's commitment types.

For every commitment type you are given, decide whether the entry satisfies its
condition, and say why in one or two sentences quoting the specific evidence you
used — the title, the organizer, the guests and their domains, the time of day,
the duration, the location. Judge each type independently: an entry may satisfy
several, or none.

Be honest about weak evidence. When the only signal is a vague title, say so and
use lower confidence. Do not invent attendees or details that are not present.`;

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      description: 'One entry per commitment type, in the order given.',
      items: {
        type: 'object',
        properties: {
          commitmentTypeId: { type: 'string' },
          matches: { type: 'boolean', description: 'Whether the entry satisfies this condition' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string', description: 'One or two sentences citing the evidence used' },
        },
        required: ['commitmentTypeId', 'matches', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'string',
      description: 'One sentence: which type best describes this entry, or that none does.',
    },
  },
  required: ['verdicts', 'summary'],
  additionalProperties: false,
};

/**
 * A report explaining, for every commitment type, whether the event satisfies
 * it and why. Returns { summary, verdicts: [...] }.
 */
export async function explainEventMatch({ event, commitmentTypes, timezone, apiKey, email, keySource }) {
  if (!commitmentTypes.length) {
    return { summary: 'No commitment types are defined yet.', verdicts: [] };
  }
  if (!apiKey) {
    const err = new Error(
      'No Anthropic API key is configured. An admin of your organization can add one on the Organizations page.'
    );
    err.status = 501;
    throw err;
  }

  const response = await callClaude({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: EXPLAIN_SYSTEM,
    tools: [{
      name: 'report_matches',
      description: 'Record the verdict for each commitment type.',
      strict: true,
      input_schema: EXPLAIN_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'report_matches' },
    messages: [{
      role: 'user',
      content: [
        'Commitment types:',
        ...commitmentTypes.map(t => `- id ${t.id} · ${t.name}: ${t.condition}`),
        '',
        'Calendar entry:',
        renderEvent(event, timezone, null),
      ].join('\n'),
    }],
  }, { apiKey, email, keySource, feature: 'commitment-report' });

  const block = response.content.find(b => b.type === 'tool_use');
  if (!block) throw new Error('The model did not return a report.');

  const validIds = new Set(commitmentTypes.map(t => t.id));
  return {
    summary: block.input.summary || '',
    // Keep one verdict per defined type, in the owner's own order.
    verdicts: commitmentTypes.map(type => {
      const verdict = (block.input.verdicts || []).find(
        v => v.commitmentTypeId === type.id && validIds.has(v.commitmentTypeId)
      );
      return {
        commitmentTypeId: type.id,
        name: type.name,
        color: type.color,
        condition: type.condition,
        matches: verdict?.matches ?? false,
        confidence: verdict?.confidence || 'low',
        reason: verdict?.reason || 'The model did not return a verdict for this type.',
      };
    }),
  };
}

const SLOT_SYSTEM = `You explain to someone why a particular time on their own
booking page is, or is not, offered to visitors.

You are given the true reasons, already worked out from their rules and calendar.
Your job is only to say them back clearly — never to re-derive them, add reasons
that aren't listed, or speculate.

Write two or three sentences, in plain language, addressed to the person whose
calendar it is ("you"). Lead with the main reason. When a calendar entry is
involved, name it. If the reasons list is empty, say plainly that the time is
open and bookable. Where it is useful, mention what they could change — a wider
window, a shorter notice period, allowing this commitment type to be booked over
— but only when the listed reasons support it.`;

/**
 * Turn a slot diagnosis into a sentence or two. The reasons are authoritative;
 * this only phrases them. Falls back to the plain reason list without a key.
 */
export async function explainSlot({ diagnosis, eventType, start, timezone, apiKey, email, keySource }) {
  const when = new Date(start).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  if (!apiKey) {
    return diagnosis.open
      ? `${when} is open — visitors can book it.`
      : `${when} is not offered. ${diagnosis.reasons.map(r => r.detail).join(' ')}`;
  }

  const response = await callClaude({
    model: 'claude-opus-5',
    max_tokens: 1000,
    system: SLOT_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        `Event type: "${eventType.name}" — ${diagnosis.context.durationMinutes} minute meetings.`,
        `Their availability guidance, verbatim: ${JSON.stringify(eventType.guidance)}`,
        `The time in question: ${when} (${timezone}).`,
        '',
        diagnosis.open
          ? 'This time IS offered to visitors. Nothing is blocking it.'
          : `This time is NOT offered. The reasons, which are authoritative:\n${
              diagnosis.reasons.map(r => `- [${r.code}] ${r.detail}`).join('\n')
            }`,
      ].join('\n'),
    }],
  }, { apiKey, email, keySource, feature: 'slot-explanation' });

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

/**
 * Answer a question about the calendar. `history` is prior turns as
 * [{ role: 'user' | 'assistant', content }]. Returns the answer text.
 */
export async function askCalendar({ question, context, history = [], apiKey, email, keySource }) {
  if (!apiKey) {
    const err = new Error(
      'No Anthropic API key is configured. An admin of your organization can add one on the Organizations page.'
    );
    err.status = 501;
    throw err;
  }

  const response = await callClaude({
    model: 'claude-opus-5',
    max_tokens: 4000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      // The calendar is the bulk of the prompt and is identical across the turns
      // of a conversation, so it is worth caching.
      { type: 'text', text: `Calendar data:\n\n${context}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      ...history
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ],
  }, { apiKey, email, keySource, feature: 'assistant' });

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}
