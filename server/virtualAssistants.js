// Virtual assistants: a Google account with a name that colleagues can email.
// The server polls each connected assistant's inbox, and answers each request
// from a colleague with a reply written by Claude, in the same thread.
//
// What an assistant will and won't do:
// - It only answers people registered in Calby on the assistant's own org
//   domain, and only mail that passed SPF, DKIM or DMARC — so a forged From
//   address can't get it to read out someone's calendar.
// - It only ever replies to the sender. It never mails anyone else, even when
//   asked to; it says so instead.
// - It skips auto-replies and mailing-list traffic, so two robots can't loop.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { accessTokenFor, forgetAccessToken } from './calendar.js';
import { getMessage, listUnread, markRead, sendReply } from './gmail.js';
import { callClaude } from './llm.js';
import { decryptSecret } from './secrets.js';

const VA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'virtual-assistants.json');
const POLL_MS = Math.max(15, Number(process.env.VA_POLL_SECONDS) || 60) * 1000;
const MAX_REPLIES_PER_HOUR = 30;
const ACTIVITY_LIMIT = 25;
const HANDLED_LIMIT = 500;
const MAX_BODY_CHARS = 20_000;

if (!existsSync(VA_FILE)) {
  writeFileSync(VA_FILE, JSON.stringify({ assistants: [] }, null, 2));
}

export function getAssistants() {
  try {
    return JSON.parse(readFileSync(VA_FILE, 'utf-8')).assistants || [];
  } catch {
    return [];
  }
}

export function saveAssistants(assistants) {
  writeFileSync(VA_FILE, JSON.stringify({ assistants }, null, 2));
}

// Read-modify-write one assistant, so a poll and an admin edit don't clobber
// each other's fields.
function updateAssistant(id, patch) {
  const all = getAssistants();
  const index = all.findIndex(a => a.id === id);
  if (index < 0) return null;
  all[index] = typeof patch === 'function' ? patch(all[index]) : { ...all[index], ...patch };
  saveAssistants(all);
  return all[index];
}

export function tokenKey(assistant) {
  return `va:${assistant.id}`;
}

/** What the admin page sees — never the sealed token. */
export function publicAssistant(assistant) {
  return {
    id: assistant.id,
    firstName: assistant.firstName,
    lastName: assistant.lastName,
    email: assistant.email,
    ownerDomain: assistant.ownerDomain,
    createdBy: assistant.createdBy,
    createdAt: assistant.createdAt,
    connected: !!assistant.gmail?.refreshToken,
    connectedAt: assistant.gmail?.connectedAt || null,
    lastCheckedAt: assistant.lastCheckedAt || null,
    lastError: assistant.lastError || null,
    activity: assistant.activity || [],
  };
}

function logActivity(id, entry) {
  updateAssistant(id, a => ({
    ...a,
    activity: [{ at: new Date().toISOString(), ...entry }, ...(a.activity || [])].slice(0, ACTIVITY_LIMIT),
  }));
}

function markHandled(id, messageId) {
  updateAssistant(id, a => ({
    ...a,
    handledIds: [messageId, ...(a.handledIds || [])].slice(0, HANDLED_LIMIT),
  }));
}

// ---------------------------------------------------------------------------
// Deciding whether to answer
// ---------------------------------------------------------------------------
function isAutomated(headers) {
  const auto = headers['auto-submitted'];
  if (auto && auto.toLowerCase() !== 'no') return true;
  if (/^(bulk|list|junk)$/i.test(headers.precedence || '')) return true;
  if (headers['list-id'] || headers['list-unsubscribe']) return true;
  if (headers['x-autoreply'] || headers['x-autorespond']) return true;
  return false;
}

// Gmail stamps every inbound message with what SPF/DKIM/DMARC concluded. Any
// pass is good enough; with none, the From address can't be trusted.
function isAuthenticated(headers) {
  const results = headers['authentication-results'] || '';
  return /\b(dmarc|dkim|spf)=pass\b/i.test(results);
}

function recentReplyCount(assistant) {
  const cutoff = Date.now() - 3600_000;
  return (assistant.activity || []).filter(
    e => e.status === 'replied' && Date.parse(e.at) >= cutoff
  ).length;
}

// ---------------------------------------------------------------------------
// Writing the reply
// ---------------------------------------------------------------------------
function systemPrompt(assistant, sender, today) {
  const fullName = `${assistant.firstName} ${assistant.lastName}`.trim();
  return `You are ${fullName}, a virtual assistant with the email address ${assistant.email}.
You work for the people at ${assistant.ownerDomain}. Today is ${today}.

A colleague, ${sender.name || sender.email} <${sender.email}>, has emailed you.
Read their email and do what they ask, then write your reply.

What you can do:
- Answer questions, draft text, summarise, plan, calculate — anything you can do
  by writing a reply.
- Look at their calendar and their open booking times with your tools, when the
  request needs it. Fetch only the dates you need. Answer only from what the
  tools return — never invent meetings or availability. Don't fetch the calendar
  for requests that have nothing to do with it.
- Use the notes they have written for you (when there are any). Treat them as
  their own facts, preferences and standing instructions, and follow them unless
  the email itself says otherwise.

What you cannot do, and must say plainly when asked:
- You cannot send email to anyone other than the person who wrote to you, create
  or change calendar events, or browse the web. If they ask for one of these,
  do the part you can (for example, draft the email for them to send) and say
  what they'll need to do themselves.

How to write:
- Write only the body of the reply — no subject line, no "From:" headers.
- Plain text, no Markdown formatting. Short paragraphs; simple "-" lists are fine.
- Be concise and direct. Sign off with "${assistant.firstName}".
- The email may quote earlier messages; the newest text at the top is the request.`;
}

function emailText({ sender, subject, date, body }) {
  const trimmed = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[…truncated]` : body;
  return [
    `From: ${sender.name ? `${sender.name} <${sender.email}>` : sender.email}`,
    `Subject: ${subject || '(no subject)'}`,
    date ? `Date: ${date}` : null,
    '',
    trimmed || '(empty message)',
  ].filter(v => v !== null).join('\n');
}

const MAX_MODEL_CALLS = 6;
const MAX_TOOL_RESULT_CHARS = 60_000;

function responseSummary(response) {
  return {
    id: response.id,
    model: response.model,
    stop_reason: response.stop_reason,
    usage: response.usage,
    content: response.content,
  };
}

/**
 * The assistant's answer to one request. Used for real email and for the
 * in-app chat alike — same prompt, same tools — so chatting shows exactly how
 * the assistant would reply by email.
 *
 * `history` is earlier turns of the same conversation:
 *   [{ role: 'user' | 'assistant', content }]
 * `toolkit` is { context, tools: [{ definition, run(input) }] }: facts that go
 * in the prompt, and tools the model may call to fetch more (the calendar).
 *
 * Returns { text, trace }, where the trace holds every model call made — the
 * exact request sent and the response — in order.
 */
export async function writeReply({
  assistant, sender, subject, date, body, history = [], toolkit = { context: null, tools: [] },
  keyInfo, feature = 'virtual-assistant',
}) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const system = [{ type: 'text', text: systemPrompt(assistant, sender, today) }];
  if (toolkit.context) {
    system.push({ type: 'text', text: `About ${sender.email}:\n\n${toolkit.context}` });
  }
  const tools = toolkit.tools || [];
  const definitions = tools.map(t => t.definition);

  const messages = [
    ...history
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
      .slice(-20)
      .map(m => ({
        role: m.role,
        content: m.role === 'user' ? emailText({ sender, subject, body: m.content }) : m.content,
      })),
    { role: 'user', content: emailText({ sender, subject, date, body }) },
  ];

  const startedAt = Date.now();
  const calls = [];
  let response;
  for (let step = 0; step < MAX_MODEL_CALLS; step++) {
    const last = step === MAX_MODEL_CALLS - 1;
    // Each request is kept exactly as sent: a snapshot of the conversation so
    // far, including earlier tool calls and their results.
    const request = {
      model: 'claude-opus-5',
      max_tokens: 4000,
      system,
      messages: [...messages],
      ...(definitions.length ? { tools: definitions } : {}),
      // On the last allowed call, make it answer with what it has.
      ...(definitions.length && last ? { tool_choice: { type: 'none' } } : {}),
    };
    const callStarted = Date.now();
    response = await callClaude(request, {
      apiKey: keyInfo.key, email: sender.email, keySource: keyInfo.source, feature,
    });
    calls.push({
      at: new Date(callStarted).toISOString(),
      durationMs: Date.now() - callStarted,
      request,
      response: responseSummary(response),
    });

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) break;

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const use of toolUses) {
      const tool = tools.find(t => t.definition.name === use.name);
      try {
        if (!tool) throw new Error(`Unknown tool ${use.name}`);
        let output = String(await tool.run(use.input || {}));
        if (output.length > MAX_TOOL_RESULT_CHARS) {
          output = `${output.slice(0, MAX_TOOL_RESULT_CHARS)}\n[…truncated — ask for fewer days]`;
        }
        results.push({ type: 'tool_result', tool_use_id: use.id, content: output });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: err.message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  return {
    text,
    trace: {
      at: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      keySource: keyInfo.source || null,
      calls,
    },
  };
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
const running = new Set();

/**
 * Check one assistant's inbox and answer what's new. `deps` comes from the
 * server so this module needn't know how users and keys are stored:
 *   findUser(email), anthropicKeyFor(email), toolkit(email) -> { context, tools }
 */
export async function checkAssistant(assistantId, deps) {
  if (running.has(assistantId)) return { skipped: 'already running' };
  running.add(assistantId);
  try {
    return await checkAssistantInner(assistantId, deps);
  } finally {
    running.delete(assistantId);
  }
}

async function checkAssistantInner(assistantId, deps) {
  let assistant = getAssistants().find(a => a.id === assistantId);
  if (!assistant?.gmail?.refreshToken) return { skipped: 'not connected' };

  const refreshToken = decryptSecret(assistant.gmail.refreshToken);
  if (!refreshToken) {
    updateAssistant(assistantId, {
      lastCheckedAt: new Date().toISOString(),
      lastError: 'The stored Gmail token could not be decrypted (was the server secret changed?). Reconnect Gmail.',
    });
    return { error: 'undecryptable token' };
  }

  let token;
  let ids;
  try {
    token = await accessTokenFor(tokenKey(assistant), refreshToken);
    ids = await listUnread(token);
  } catch (err) {
    forgetAccessToken(tokenKey(assistant));
    const revoked = /invalid_grant|revoked|expired/i.test(err.message);
    updateAssistant(assistantId, {
      lastCheckedAt: new Date().toISOString(),
      lastError: revoked ? 'Gmail access was revoked or expired. Reconnect Gmail.' : err.message,
    });
    return { error: err.message };
  }

  const handled = new Set(assistant.handledIds || []);
  let replied = 0;
  for (const id of ids.reverse()) { // oldest first
    if (handled.has(id)) continue;
    if (recentReplyCount(assistant) >= MAX_REPLIES_PER_HOUR) {
      // Left unread and unhandled, so it is answered once the hour has passed.
      updateAssistant(assistantId, { lastError: `Hourly limit of ${MAX_REPLIES_PER_HOUR} replies reached; waiting.` });
      return { checked: ids.length, replied, limited: true };
    }
    // Recorded before answering: a message that fails part-way is not retried
    // on every poll, which could otherwise run up model cost indefinitely.
    markHandled(assistantId, id);
    assistant = getAssistants().find(a => a.id === assistantId) || assistant;

    let message;
    try {
      message = await getMessage(token, id);
    } catch (err) {
      logActivity(assistantId, { status: 'error', detail: `Could not read message: ${err.message}` });
      continue;
    }

    const sender = message.from;
    const base = { from: sender.email, subject: message.subject };
    const ignore = async detail => {
      logActivity(assistantId, { ...base, status: 'ignored', detail });
      await markRead(token, id).catch(() => {});
    };

    if (sender.email === assistant.email) { await markRead(token, id).catch(() => {}); continue; }
    if (isAutomated(message.headers)) { await ignore('Automated or mailing-list message'); continue; }

    const user = deps.findUser(sender.email);
    const senderDomain = sender.email.split('@')[1];
    if (!user || senderDomain !== assistant.ownerDomain) {
      await ignore(`Sender is not a Calby user on ${assistant.ownerDomain}`);
      continue;
    }
    if (!isAuthenticated(message.headers)) {
      await ignore('Sender could not be verified (no SPF, DKIM or DMARC pass)');
      continue;
    }
    const keyInfo = deps.anthropicKeyFor(sender.email);
    if (!keyInfo.key) {
      await ignore('No Anthropic API key is configured for the sender\'s organization');
      continue;
    }

    try {
      const toolkit = deps.toolkit(sender.email);
      const { text: reply } = await writeReply({
        assistant,
        sender: { email: sender.email, name: sender.name || user.name || '' },
        subject: message.subject,
        date: message.date,
        body: message.body,
        toolkit,
        keyInfo,
      });
      if (!reply) throw new Error('The model returned an empty reply');

      await sendReply(token, {
        from: { name: `${assistant.firstName} ${assistant.lastName}`.trim(), email: assistant.email },
        to: { name: sender.name, email: sender.email },
        subject: message.subject,
        body: reply,
        inReplyTo: message.messageId,
        references: message.references,
        threadId: message.threadId,
      });
      await markRead(token, id).catch(() => {});
      logActivity(assistantId, { ...base, status: 'replied' });
      replied += 1;
    } catch (err) {
      console.error(`[va] ${assistant.email} failed to answer ${sender.email}:`, err.message);
      logActivity(assistantId, { ...base, status: 'error', detail: err.message });
    }
  }

  updateAssistant(assistantId, { lastCheckedAt: new Date().toISOString(), lastError: null });
  return { checked: ids.length, replied };
}

let pollTimer = null;

export function startPolling(deps) {
  if (pollTimer) return;
  const tick = async () => {
    for (const assistant of getAssistants()) {
      if (!assistant.gmail?.refreshToken) continue;
      try {
        await checkAssistant(assistant.id, deps);
      } catch (err) {
        console.error(`[va] poll of ${assistant.email} failed:`, err.message);
      }
    }
  };
  pollTimer = setInterval(tick, POLL_MS);
  pollTimer.unref?.();
  setTimeout(tick, 5000).unref?.();
  console.log(`[va] polling virtual assistant inboxes every ${POLL_MS / 1000}s`);
}
