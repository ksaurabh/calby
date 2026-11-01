// Gmail access for virtual assistants: read the inbox, send replies.
//
// A virtual assistant is a real Google account. An admin connects it once
// through Google's consent screen (signed in as that account), which gives us a
// refresh token for the Gmail API. The consent reuses the calendar redirect URI,
// so no extra URI has to be registered on the OAuth client.
import { calendarRedirectUri } from './calendar.js';

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// gmail.modify covers reading messages, sending, and changing labels (marking a
// handled message read). It does not allow permanently deleting mail.
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export function gmailConsentUrl(state, loginHint) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    // Always ask, so we get a refresh token and the admin can pick the account.
    prompt: 'consent select_account',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${OAUTH_AUTH_URL}?${params}`;
}

async function gmailFetch(token, path, options = {}) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `Gmail error (${res.status})`;
    try { message = JSON.parse(text).error?.message || message; } catch { /* keep default */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/** The address of the account the token belongs to. */
export async function gmailProfile(token) {
  const data = await gmailFetch(token, '/profile');
  return { email: data.emailAddress?.toLowerCase() || null };
}

/** Ids of unread inbox messages, newest first. */
export async function listUnread(token, { maxResults = 10 } = {}) {
  const params = new URLSearchParams({
    q: 'in:inbox is:unread newer_than:3d',
    maxResults: String(maxResults),
  });
  const data = await gmailFetch(token, `/messages?${params}`);
  return (data.messages || []).map(m => m.id);
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function htmlToText(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Walk the MIME tree, preferring text/plain and falling back to stripped HTML.
function bodyText(payload) {
  const plain = [];
  const html = [];
  const walk = part => {
    if (!part) return;
    if (part.body?.data && !part.filename) {
      if (part.mimeType === 'text/plain') plain.push(decodeBase64Url(part.body.data));
      else if (part.mimeType === 'text/html') html.push(decodeBase64Url(part.body.data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join('\n').trim();
  return htmlToText(html.join('\n'));
}

// "Ada Lovelace <ada@example.com>" -> { name, email }
export function parseAddress(value = '') {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  return { name: '', email: value.trim().toLowerCase() };
}

/** One message, flattened to what the assistant needs. */
export async function getMessage(token, id) {
  const data = await gmailFetch(token, `/messages/${encodeURIComponent(id)}?format=full`);
  const headers = {};
  for (const h of data.payload?.headers || []) {
    const key = h.name.toLowerCase();
    // Authentication-Results can repeat; keep them all.
    headers[key] = headers[key] ? `${headers[key]}\n${h.value}` : h.value;
  }
  return {
    id: data.id,
    threadId: data.threadId,
    labelIds: data.labelIds || [],
    headers,
    from: parseAddress(headers.from),
    subject: headers.subject || '',
    messageId: headers['message-id'] || '',
    references: headers.references || '',
    date: headers.date || '',
    body: bodyText(data.payload),
  };
}

export async function markRead(token, id) {
  return gmailFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

// RFC 2047 encoding for header values that aren't plain ASCII.
function encodeHeader(value) {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress({ name, email }) {
  if (!name) return email;
  return `${encodeHeader(name.replace(/["\r\n]/g, ''))} <${email}>`;
}

/**
 * Reply in the same thread. Only ever addressed to one recipient — the
 * assistant does not send mail to anyone the request merely mentions.
 */
export async function sendReply(token, { from, to, subject, body, inReplyTo, references, threadId }) {
  const replySubject = /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || '(no subject)'}`;
  const headers = [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(to)}`,
    `Subject: ${encodeHeader(replySubject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    // Marks this as an automated reply, so other robots don't answer it.
    'Auto-Submitted: auto-replied',
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${[references, inReplyTo].filter(Boolean).join(' ')}`);
  }
  const encodedBody = Buffer.from(body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${encodedBody}`, 'utf8').toString('base64url');

  return gmailFetch(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, threadId }),
  });
}
