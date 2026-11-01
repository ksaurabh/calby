// To-do reports: action items for one person, drawn from the summary notes
// Avoma and Gong already wrote about their recorded meetings.
import { callClaude } from './llm.js';

const SYSTEM = `You turn meeting notes into a to-do list for one person.

You are given the summary notes of several recorded meetings (written by
Avoma or Gong, not transcripts). Find the action items that belong to the
person named below: things they said they would do, were asked to do, or that
clearly fall to them as the owner of the follow-up.

Rules:
- Only their items. Leave out tasks owned by other people. When the notes say
  "we" or "the team" will do something, include it only if it is clearly their
  side's follow-up and they are the natural owner; mark those confidence "low".
- One item per distinct task. Write it as a short imperative ("Send Acme the
  revised pricing"), specific enough to act on without the notes.
- Give a due date only when the notes state or clearly imply one; otherwise null.
- Priority: high when there is a deadline, a customer waiting, or revenue at
  stake; low for nice-to-haves; medium otherwise.
- Evidence: quote or closely paraphrase the line from the notes the item comes
  from.
- If a meeting has no action items for them, return none for it. Do not invent
  work.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          meeting: { type: 'integer', description: 'The number of the meeting it comes from' },
          task: { type: 'string' },
          due: { type: ['string', 'null'], description: 'As stated, e.g. "Friday" or "2026-11-06"; null if none' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          confidence: { type: 'string', enum: ['high', 'low'], description: 'low when ownership is inferred' },
          evidence: { type: 'string' },
        },
        required: ['meeting', 'task', 'due', 'priority', 'confidence', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const MAX_NOTES_CHARS = 12_000;

/**
 * meetings: [{ title, start, attendees: [{ name, email }], notes: [{ source, text }] }]
 * Returns { items: [{ meetingIndex, task, due, priority, confidence, evidence }], usage, model }.
 */
export async function todoReport({ person, meetings, timezone, apiKey, keySource }) {
  const when = iso => new Date(iso).toLocaleString('en-US', {
    timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const blocks = meetings.map((m, i) => {
    const people = m.attendees.map(a => a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email || a.name);
    const notes = m.notes
      .map(n => `[${n.source === 'avoma' ? 'Avoma notes' : 'Gong highlights'}]\n${n.text.slice(0, MAX_NOTES_CHARS)}`)
      .join('\n\n');
    return [
      `## Meeting ${i + 1}: ${m.title}`,
      `When: ${when(m.start)}`,
      people.length ? `Attendees: ${people.join(', ')}` : null,
      '',
      notes,
    ].filter(v => v !== null).join('\n');
  });

  const response = await callClaude({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: SYSTEM,
    tools: [{ name: 'record_todos', description: 'The action items found.', strict: true, input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'record_todos' },
    messages: [{
      role: 'user',
      content: [
        `The person: ${person.name || person.email} <${person.email}>.`,
        `Today is ${today} (${timezone}).`,
        '',
        ...blocks,
      ].join('\n'),
    }],
  }, { apiKey, email: person.email, keySource, feature: 'todo-report' });

  const block = response.content.find(b => b.type === 'tool_use');
  const items = (block?.input?.items || [])
    .filter(it => Number.isInteger(it.meeting) && it.meeting >= 1 && it.meeting <= meetings.length && it.task)
    .map(it => ({
      meetingIndex: it.meeting - 1,
      task: it.task.trim(),
      due: it.due || null,
      priority: it.priority || 'medium',
      confidence: it.confidence || 'high',
      evidence: it.evidence || '',
    }));
  return { items, usage: response.usage, model: response.model };
}

// ---------------------------------------------------------------------------
// Summarising a meeting from its transcript — for meetings only Zoom recorded,
// where there are no Avoma notes or Gong highlights to read instead.
// ---------------------------------------------------------------------------
const SUMMARY_SYSTEM = `You summarise a recorded meeting from its transcript
for one of the people in it.

Write plain text with these sections, each short:
Overview: two or three sentences — who met, why, and the outcome.
Key points: the substance, as "-" bullets.
Decisions: what was agreed, as bullets (or "None").
Next steps: who does what by when, as bullets, naming the owner; mark the
reader's own items with "(you)".

Only state what the transcript supports. Transcripts are machine-made and
mis-hear names and numbers; when something is unclear, say so rather than
guess.`;

const MAX_TRANSCRIPT_CHARS = 150_000;

export async function summarizeTranscript({ person, title, start, transcript, timezone, apiKey, keySource }) {
  const when = new Date(start).toLocaleString('en-US', {
    timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const text = transcript.length > MAX_TRANSCRIPT_CHARS
    ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[…transcript truncated]`
    : transcript;
  const response = await callClaude({
    model: 'claude-opus-5',
    max_tokens: 3000,
    system: SUMMARY_SYSTEM,
    messages: [{
      role: 'user',
      content: `The reader: ${person.name || person.email} <${person.email}>.\nMeeting: "${title}", ${when}.\n\nTranscript:\n${text}`,
    }],
  }, { apiKey, email: person.email, keySource, feature: 'zoom-summary' });
  return {
    text: response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
    usage: response.usage,
    model: response.model,
  };
}
