// Google Calendar access for booking pages.
//
// Sign-in (passport) only asks for profile/email. Calendar access is a separate,
// explicit consent step so users aren't forced to hand over their calendar just
// to log in. The connect flow lives under /api/ so it needs no extra nginx rule.
import { randomBytes } from 'crypto';

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

// Where Google sends the user back after the calendar consent screen. Must be
// registered as an Authorized redirect URI on the OAuth client.
export function calendarRedirectUri() {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) {
    return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  }
  const base = process.env.CLIENT_URL || 'http://localhost:5178';
  return `${base.replace(/\/+$/, '')}/api/calendar/callback`;
}

export function consentUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
    // offline + consent so we always come back with a refresh token, including
    // for users who granted access once before.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH_URL}?${params}`;
}

export function generateState() {
  return randomBytes(16).toString('hex');
}

async function tokenRequest(body) {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Google token error (${res.status})`);
  }
  return data;
}

// Exchange the one-time code for a refresh token.
export async function exchangeCode(code) {
  const data = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: calendarRedirectUri(),
    grant_type: 'authorization_code',
  });
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Try disconnecting the app at myaccount.google.com/permissions and connecting again.');
  }
  return data;
}

// Access tokens are short-lived; keep them in memory keyed by user email.
const accessTokens = new Map();

export async function accessTokenFor(email, refreshToken) {
  const cached = accessTokens.get(email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  });
  const token = data.access_token;
  accessTokens.set(email, {
    token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return token;
}

export function forgetAccessToken(email) {
  accessTokens.delete(email);
}

async function calendarFetch(token, path, options = {}) {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `Google Calendar error (${res.status})`;
    try { message = JSON.parse(text).error?.message || message; } catch { /* keep default */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

// Busy intervals on the primary calendar between two instants.
export async function fetchBusy(token, timeMin, timeMax) {
  const data = await calendarFetch(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  const busy = data.calendars?.primary?.busy || [];
  return busy.map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
}

// Create the meeting and invite the person who booked. sendUpdates=all makes
// Google email both parties.
export async function createEvent(token, { summary, description, start, end, timeZone, attendee }) {
  return calendarFetch(token, '/calendars/primary/events?sendUpdates=all', {
    method: 'POST',
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: attendee ? [{ email: attendee.email, displayName: attendee.name || undefined }] : [],
      reminders: { useDefault: true },
    }),
  });
}
