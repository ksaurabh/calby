// Meeting recordings from Avoma and Gong, and matching them to calendar
// meetings — so we can say which meetings were recorded, and which had people
// in them but no recording anywhere.
//
// Modelled on the gtm-hub clients: both APIs rate-limit and occasionally
// answer with an HTML error page, so every request reads the body as text,
// retries 429/5xx (honouring Retry-After), and reports a snippet of anything
// that isn't JSON instead of a bare JSON.parse error.

const AVOMA_API = 'https://api.avoma.com/v1';
const AVOMA_PAGE_SIZE = 100;
const AVOMA_MAX_ATTEMPTS = 6;
const AVOMA_MAX_WAIT_MS = 90_000;
const AVOMA_MAX_PAGES = 30;

const GONG_API = 'https://api.gong.io/v2';
const GONG_MAX_ATTEMPTS = 4;
const GONG_MAX_PAGES = 50;

// A recording counts as the same meeting when it starts this close to it.
export const MATCH_SLACK_MS = 10 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const snippet = text => String(text || '').slice(0, 160).replace(/\s+/g, ' ');
const looksHtml = text => /^\s*<(?:!doctype|html)/i.test(text || '');
const isoSeconds = d => d.toISOString().replace(/\.\d+Z$/, 'Z');

// Field names drift across payload versions; take the first that is present.
function pick(o, keys, fallback = '') {
  for (const k of keys) {
    const v = o?.[k];
    if (v != null && v !== '') return v;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Avoma
// ---------------------------------------------------------------------------
function avomaRetryDelayMs(res, body) {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, AVOMA_MAX_WAIT_MS);
  const m = /available in (\d+)\s*second/i.exec(body || '');
  if (m) return Math.min((Number(m[1]) + 1) * 1000, AVOMA_MAX_WAIT_MS);
  return 5000;
}

async function avomaGet(apiKey, pathAndQuery, { onWait } = {}, attempt = 1) {
  const res = await fetch(AVOMA_API + pathAndQuery, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Avoma rejected the API key (HTTP ${res.status}).`);
      err.badKey = true;
      throw err;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < AVOMA_MAX_ATTEMPTS) {
      const wait = avomaRetryDelayMs(res, text);
      onWait?.(wait);
      await sleep(wait);
      return avomaGet(apiKey, pathAndQuery, { onWait }, attempt + 1);
    }
    if (res.status === 429) {
      throw new Error(`Avoma is rate-limiting this key — still throttled after ${attempt} attempts. Try again in a minute.`);
    }
    throw new Error(`Avoma ${res.status}: ${snippet(text)}`);
  }
  if (looksHtml(text)) throw new Error(`Avoma returned an HTML page instead of JSON (HTTP ${res.status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Avoma returned a ${res.status} that was not JSON: ${snippet(text)}`);
  }
}

// Avoma paginates DRF-style ({ count, next, results }); tolerate a bare array.
function avomaRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

// `next` is a full URL that drops page_size; turn it back into a path.
function avomaNextPath(next) {
  if (!next) return null;
  const raw = String(next).trim();
  let path;
  if (raw.startsWith('/')) path = raw;
  else if (raw.startsWith('?')) path = `/meetings/${raw}`;
  else {
    try {
      const u = new URL(raw);
      const m = /\/v\d+(\/.*)$/.exec(u.pathname);
      path = (m ? m[1] : u.pathname) + (u.search || '');
    } catch {
      return null;
    }
  }
  return path.includes('page_size=') ? path : `${path}&page_size=${AVOMA_PAGE_SIZE}`;
}

function avomaAttendees(m) {
  const raw = pick(m, ['attendees', 'participants', 'invitees'], []);
  return (Array.isArray(raw) ? raw : [])
    .map(a => typeof a === 'string'
      ? { email: a.toLowerCase(), name: a }
      : {
          email: String(pick(a, ['email', 'email_address'])).toLowerCase(),
          name: pick(a, ['name', 'display_name', 'full_name']) || pick(a, ['email']),
        })
    .filter(a => a.email || a.name);
}

// Avoma lists every meeting it knows about — including ones synced from the
// calendar that its notetaker never joined. Its public docs aren't readable
// here, so whether a meeting was recorded is read defensively from the
// signals a payload may carry, and reported as unknown (null) when there
// are none:
//   - a recording/transcript id or media URL  -> recorded
//   - an "*_ready" / is_recorded style flag     -> recorded when true
//   - a state/status like completed, processed  -> recorded
//   - a state/status like scheduled, cancelled,
//     missed, failed, not recorded              -> not recorded
const AVOMA_RECORDED_IDS = [
  'recording_uuid', 'recording_id', 'recording_url', 'audio_url', 'video_url',
  'transcription_uuid', 'transcript_uuid', 'transcription_id', 'transcript_id',
];
const AVOMA_RECORDED_FLAGS = [
  'is_recorded', 'recorded', 'has_recording', 'audio_ready', 'video_ready',
  'transcript_ready', 'transcription_ready', 'recording_ready',
];
const AVOMA_STATUS_FIELDS = ['state', 'status', 'processing_status', 'recording_status', 'transcription_status'];
const NOT_RECORDED = /not[\s_-]*recorded|no[\s_-]*recording|cancel|missed|skipp|scheduled|upcoming|future|declin|fail|denied|removed|no[\s_-]*show|did[\s_-]*not/i;
const RECORDED = /complet|processed|ready|transcri|recorded|available|done|finished/i;

/**
 * Whether Avoma recorded a meeting, and the signal that decided it:
 * { recorded: true | false | null, reason }.
 */
export function avomaRecordedWhy(m) {
  const flagTrue = AVOMA_RECORDED_FLAGS.find(k => m?.[k] === true);
  if (flagTrue) return { recorded: true, reason: `${flagTrue} = true` };
  const id = AVOMA_RECORDED_IDS.find(k => m?.[k]);
  if (id) return { recorded: true, reason: `${id} is set` };
  const status = AVOMA_STATUS_FIELDS.find(k => typeof m?.[k] === 'string' && m[k]);
  const notRecorded = AVOMA_STATUS_FIELDS.find(k => typeof m?.[k] === 'string' && NOT_RECORDED.test(m[k]));
  if (notRecorded) return { recorded: false, reason: `${notRecorded} = ${m[notRecorded]}` };
  const flagFalse = AVOMA_RECORDED_FLAGS.find(k => m?.[k] === false);
  if (flagFalse) return { recorded: false, reason: `${flagFalse} = false` };
  const recordedStatus = AVOMA_STATUS_FIELDS.find(k => typeof m?.[k] === 'string' && RECORDED.test(m[k]));
  if (recordedStatus) return { recorded: true, reason: `${recordedStatus} = ${m[recordedStatus]}` };
  return { recorded: null, reason: status ? `${status} = ${m[status]} (not recognised)` : 'no recording signal' };
}

export function avomaRecorded(m) {
  return avomaRecordedWhy(m).recorded;
}

// Fields that carry meeting content, never shown in diagnostics.
const AVOMA_CONTENT_FIELDS = /subject|title|name|description|agenda|notes|invite|summary|transcript_text|attendee|participant|invitee|email|url|link|organizer|host/i;

/**
 * The non-content fields of one Avoma meeting — flags, states, ids, counts,
 * timestamps — to see exactly what Avoma says about whether it recorded it.
 */
export function avomaSignals(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (AVOMA_CONTENT_FIELDS.test(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string' && v.length <= 80) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length} item${v.length === 1 ? '' : 's'}]`;
    else if (typeof v === 'object') out[k] = `{${Object.keys(v).slice(0, 8).join(', ')}}`;
  }
  return out;
}

/** One Avoma meeting, read live — its detail can carry more than the list. */
export async function avomaMeetingSignals(apiKey, uuid) {
  const data = await avomaGet(apiKey, `/meetings/${encodeURIComponent(uuid)}/`);
  return { signals: avomaSignals(data), ...avomaRecordedWhy(data) };
}

// What Avoma actually sent, for working out the recorded signal: every field
// name, and the values of short enum-like fields (states, flags) — never
// titles, notes or attendees.
function avomaDiagnostics(rows) {
  const fields = new Set();
  const values = {};
  for (const m of rows) {
    for (const [k, v] of Object.entries(m || {})) {
      fields.add(k);
      const enumLike = AVOMA_STATUS_FIELDS.includes(k) || AVOMA_RECORDED_FLAGS.includes(k) ||
        /ready|record|status|state|is_|has_/.test(k);
      if (!enumLike) continue;
      if (!(typeof v === 'boolean' || (typeof v === 'string' && v.length <= 40) || v === null)) continue;
      const key = v === null ? 'null' : String(v);
      values[k] = values[k] || {};
      values[k][key] = (values[k][key] || 0) + 1;
    }
  }
  return { fields: [...fields].sort(), values };
}

function avomaMeeting(m) {
  const id = String(pick(m, ['uuid', 'id', 'meeting_uuid']));
  return {
    source: 'avoma',
    id,
    title: pick(m, ['subject', 'title', 'name'], '(no subject)'),
    start: pick(m, ['start_at', 'start_time', 'scheduled_start', 'created']) || null,
    end: pick(m, ['end_at', 'end_time']) || null,
    url: pick(m, ['url', 'avoma_url', 'share_url', 'meeting_url']) || (id ? `https://app.avoma.com/meetings/${id}` : ''),
    organizer: String(pick(m, ['organizer_email', 'host_email', 'organizer'])).toLowerCase(),
    attendees: avomaAttendees(m),
    state: pick(m, ['state', 'status', 'processing_status']) || '',
    // true / false / null (Avoma didn't say), and the signal that decided it.
    ...avomaRecordedWhy(m),
    signals: avomaSignals(m),
  };
}

/** Cheapest call that proves a key works. Avoma requires a date window. */
export async function avomaProbe(apiKey) {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400_000);
  return avomaGet(apiKey, `/meetings/?from_date=${encodeURIComponent(isoSeconds(from))}&to_date=${encodeURIComponent(isoSeconds(to))}&page_size=1`);
}

/** Every Avoma meeting between two instants. */
export async function avomaMeetings(apiKey, from, to, { onProgress } = {}) {
  let path = `/meetings/?from_date=${encodeURIComponent(isoSeconds(from))}` +
    `&to_date=${encodeURIComponent(isoSeconds(to))}&page_size=${AVOMA_PAGE_SIZE}&o=-start_at`;
  const meetings = [];
  const raw = [];
  let pages = 0;
  while (path && pages < AVOMA_MAX_PAGES) {
    const data = await avomaGet(apiKey, path, {
      onWait: ms => onProgress?.(`Avoma is rate-limiting — waiting ${Math.round(ms / 1000)}s before continuing`),
    });
    pages += 1;
    for (const row of avomaRows(data)) {
      raw.push(row);
      const m = avomaMeeting(row);
      if (m.id) meetings.push(m);
    }
    onProgress?.(`Reading Avoma meetings — ${meetings.length}${data?.count != null ? ` of ${data.count}` : ''} so far`);
    path = avomaNextPath(data?.next);
  }
  return { meetings, truncated: !!path, diagnostics: avomaDiagnostics(raw) };
}

// ---------------------------------------------------------------------------
// Gong
// ---------------------------------------------------------------------------
export function gongAuthHeader(accessKey, secretKey) {
  return `Basic ${Buffer.from(`${accessKey}:${secretKey}`).toString('base64')}`;
}

async function gongRequest(auth, path, init, attempt = 1) {
  const res = await fetch(GONG_API + path, {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  // Gong answers 404 when a window has no calls.
  if (res.status === 404) return null;
  const text = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Gong rejected the access key and secret (HTTP ${res.status}).`);
    err.badKey = true;
    throw err;
  }
  const html = looksHtml(text);
  if (res.ok && !html) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Gong returned a ${res.status} that was not JSON: ${snippet(text)}`);
    }
  }
  if ((res.status === 429 || res.status >= 500 || html) && attempt < GONG_MAX_ATTEMPTS) {
    const hinted = Number(res.headers.get('retry-after')) * 1000;
    const wait = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted, 30_000) : Math.min(1000 * 2 ** (attempt - 1), 8000);
    await sleep(wait);
    return gongRequest(auth, path, init, attempt + 1);
  }
  if (html) throw new Error(`Gong returned an HTML page instead of JSON (HTTP ${res.status}).`);
  throw new Error(`Gong ${res.status}: ${snippet(text)}`);
}

/** Cheapest call that proves a key pair works (a one-minute window). */
export async function gongProbe(accessKey, secretKey) {
  return gongRequest(
    gongAuthHeader(accessKey, secretKey),
    '/calls?fromDateTime=2025-01-01T00:00:00Z&toDateTime=2025-01-01T00:01:00Z',
    { method: 'GET' }
  );
}

function gongCall(c) {
  const md = c.metaData || {};
  return {
    source: 'gong',
    id: String(md.id || c.id || ''),
    title: md.title || '(no title)',
    start: md.started || md.scheduled || null,
    end: md.started && md.duration
      ? new Date(Date.parse(md.started) + Number(md.duration) * 1000).toISOString()
      : null,
    url: md.url || '',
    organizer: '',
    attendees: (c.parties || [])
      .map(p => ({
        email: String(p.emailAddress || '').toLowerCase(),
        name: p.name || p.emailAddress || '',
        affiliation: p.affiliation || '',
      }))
      .filter(p => p.email || p.name),
    state: md.scope || '',
  };
}

/** Every Gong call between two instants, with its participants. */
export async function gongCalls(accessKey, secretKey, from, to, { onProgress } = {}) {
  const auth = gongAuthHeader(accessKey, secretKey);
  const calls = [];
  let cursor;
  let pages = 0;
  do {
    const body = {
      filter: { fromDateTime: isoSeconds(from), toDateTime: isoSeconds(to) },
      contentSelector: { exposedFields: { parties: true } },
      ...(cursor ? { cursor } : {}),
    };
    const data = await gongRequest(auth, '/calls/extensive', { method: 'POST', body: JSON.stringify(body) });
    if (data === null) break;
    pages += 1;
    for (const raw of data.calls || []) {
      const call = gongCall(raw);
      if (call.id) calls.push(call);
    }
    onProgress?.(`Reading Gong calls — ${calls.length}${data.records?.totalRecords != null ? ` of ${data.records.totalRecords}` : ''} so far`);
    cursor = data.records?.cursor;
  } while (cursor && pages < GONG_MAX_PAGES);
  return { calls, truncated: !!cursor };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

// Two names match when every token of the shorter one appears in the longer —
// "Ann Lee" and "Ann B. Lee" match; "Ann" alone never matches anything.
function namesMatch(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every(t => long.includes(t));
}

/**
 * Find the recording of a calendar meeting: one that starts within
 * MATCH_SLACK_MS and shares at least one attendee other than `ownerEmail` (by
 * email, or by full name when the recording has no email for them). The owner
 * is in every one of their own meetings, so they can't be the evidence.
 */
export function findRecordings(meeting, recordings, ownerEmail) {
  const start = Date.parse(meeting.start);
  const owner = ownerEmail.toLowerCase();
  const others = meeting.attendees.filter(a => a.email !== owner);
  const emails = new Set(others.map(a => a.email).filter(Boolean));
  return recordings.filter(r => {
    const t = Date.parse(r.start || '');
    if (!Number.isFinite(t) || Math.abs(t - start) > MATCH_SLACK_MS) return false;
    return r.attendees.some(p => {
      if (p.email && p.email === owner) return false;
      if (p.email && emails.has(p.email)) return true;
      return others.some(a => namesMatch(a.name, p.name));
    });
  });
}

// ---------------------------------------------------------------------------
// Zoom (Server-to-Server OAuth app)
// ---------------------------------------------------------------------------
// The app's account ID, client ID and secret buy an hour-long access token.
// Recordings are listed per Zoom user, by email; Zoom returns no participants
// with them, so recordings are matched to meetings by time (and by Zoom
// meeting number when the invite carries the join link).
const ZOOM_API = 'https://api.zoom.us/v2';
const ZOOM_MAX_ATTEMPTS = 4;
const zoomTokens = new Map();

async function zoomToken({ accountId, clientId, clientSecret }) {
  const cached = zoomTokens.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    }
  );
  const text = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok || !data.access_token) {
    const err = new Error(
      res.status === 400 || res.status === 401
        ? `Zoom rejected the account ID, client ID or secret (${data.reason || data.error || `HTTP ${res.status}`}).`
        : `Zoom sign-in failed (HTTP ${res.status}): ${snippet(text)}`
    );
    err.badKey = res.status === 400 || res.status === 401;
    throw err;
  }
  zoomTokens.set(clientId, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function zoomGet(creds, path, attempt = 1) {
  const token = await zoomToken(creds);
  const res = await fetch(ZOOM_API + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (res.ok && data) return data;
  if (res.status === 401 && attempt === 1) {
    zoomTokens.delete(creds.clientId); // expired early; get a fresh one once
    return zoomGet(creds, path, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < ZOOM_MAX_ATTEMPTS) {
    const hinted = Number(res.headers.get('retry-after')) * 1000;
    await sleep(Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted, 30_000) : 1000 * 2 ** (attempt - 1));
    return zoomGet(creds, path, attempt + 1);
  }
  const message = data?.message || snippet(text) || `HTTP ${res.status}`;
  if (res.status === 404) throw new Error(`Zoom has no user ${creds.userEmail} in that account (${message}).`);
  if (res.status === 400 && /scope/i.test(message)) {
    throw new Error(`The Zoom app is missing a scope — add "View all user recordings" (cloud_recording:read:list_user_recordings:admin). Zoom said: ${message}`);
  }
  const err = new Error(`Zoom ${res.status}: ${message}`);
  err.badKey = res.status === 401;
  throw err;
}

const zoomDate = d => d.toISOString().slice(0, 10);

function zoomRecording(m) {
  const durationMin = Number(m.duration) || null;
  return {
    source: 'zoom',
    id: String(m.uuid || m.id),
    meetingNumber: m.id != null ? String(m.id) : null,
    title: m.topic || '(no topic)',
    start: m.start_time || null,
    end: m.start_time && durationMin ? new Date(Date.parse(m.start_time) + durationMin * 60_000).toISOString() : null,
    durationMin,
    url: m.share_url || '',
    organizer: String(m.host_email || '').toLowerCase(),
    attendees: [],
    files: (m.recording_files || []).length,
  };
}

/** Proves the credentials, the user and the recordings scope in one call. */
export async function zoomProbe(creds) {
  const today = zoomDate(new Date());
  return zoomGet(creds, `/users/${encodeURIComponent(creds.userEmail)}/recordings?from=${today}&to=${today}&page_size=1`);
}

/** Every cloud recording of the user's between two instants (≤ 30 days). */
export async function zoomRecordings(creds, from, to, { onProgress } = {}) {
  const recordings = [];
  let token = '';
  let pages = 0;
  do {
    const params = new URLSearchParams({
      from: zoomDate(from),
      to: zoomDate(to),
      page_size: '300',
      ...(token ? { next_page_token: token } : {}),
    });
    const data = await zoomGet(creds, `/users/${encodeURIComponent(creds.userEmail)}/recordings?${params}`);
    pages += 1;
    for (const m of data.meetings || []) recordings.push(zoomRecording(m));
    onProgress?.(`Reading Zoom recordings — ${recordings.length}${data.total_records != null ? ` of ${data.total_records}` : ''} so far`);
    token = data.next_page_token || '';
  } while (token && pages < 20);
  // Zoom's window is whole days; trim to the exact one.
  const inWindow = recordings.filter(r => {
    const t = Date.parse(r.start || '');
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });
  return { recordings: inWindow, truncated: !!token };
}

// A recurring Zoom meeting keeps one number across instances, so a number
// match still needs the times to be close — just not as close as a bare time
// match, since people join late and recordings start when someone hits record.
const ZOOM_ID_SLACK_MS = 2 * 60 * 60 * 1000;

/**
 * Tie each Zoom recording to at most one calendar meeting: the nearest one
 * whose invite has the same Zoom meeting number (within 2 hours), else the
 * nearest one starting within MATCH_SLACK_MS. Returns
 * Map(recordingId -> { meetingId, how: 'meeting number' | 'time', deltaMinutes }).
 */
export function matchZoomRecordings(recordings, meetings) {
  const result = new Map();
  for (const r of recordings) {
    const t = Date.parse(r.start || '');
    if (!Number.isFinite(t)) continue;
    let best = null;
    for (const m of meetings) {
      const delta = Math.abs(Date.parse(m.start) - t);
      const byNumber = r.meetingNumber && (m.zoomMeetingIds || []).includes(r.meetingNumber) && delta <= ZOOM_ID_SLACK_MS;
      const byTime = delta <= MATCH_SLACK_MS;
      if (!byNumber && !byTime) continue;
      const rank = byNumber ? 0 : 1;
      if (!best || rank < best.rank || (rank === best.rank && delta < best.delta)) {
        best = { meetingId: m.id, how: byNumber ? 'meeting number' : 'time', delta, rank };
      }
    }
    if (best) result.set(r.id, { meetingId: best.meetingId, how: best.how, deltaMinutes: Math.round(best.delta / 60_000) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Summary notes — what the services already wrote about a meeting. Used
// instead of transcripts: far shorter, and already distilled.
// ---------------------------------------------------------------------------
/** Avoma's notes for one meeting, as plain text ('' when it has none). */
export async function avomaNotes(apiKey, uuid) {
  const data = await avomaGet(apiKey, `/notes?meeting_uuid=${encodeURIComponent(uuid)}`);
  const parts = [];
  for (const r of avomaRows(data)) {
    const category = pick(r, ['category', 'smart_category', 'title']);
    const items = pick(r, ['notes', 'items', 'data'], null);
    if (Array.isArray(items) && items.length) {
      const lines = items
        .map(it => `- ${String(typeof it === 'string' ? it : pick(it, ['text', 'note', 'content'])).trim()}`)
        .filter(line => line !== '- ');
      if (lines.length) parts.push(`${category ? `${category}:\n` : ''}${lines.join('\n')}`);
      continue;
    }
    const text = String(pick(r, ['text', 'note', 'content', 'summary']) || '').trim();
    if (text) parts.push(`${category ? `${category}:\n` : ''}${text}`);
  }
  return parts.join('\n\n').trim();
}

// Gong's AI highlights: the brief, key points and highlight sections (such as
// "Next steps").
function formatGongHighlights(content = {}) {
  const parts = [];
  if (content.brief) parts.push(`Summary:\n${String(content.brief).trim()}`);
  if (Array.isArray(content.keyPoints) && content.keyPoints.length) {
    parts.push(`Key points:\n${content.keyPoints.map(k => `- ${(k.text || '').trim()}`).filter(l => l !== '- ').join('\n')}`);
  }
  for (const h of content.highlights || []) {
    const items = (h.items || []).map(it => `- ${(it.text || '').trim()}`).filter(l => l !== '- ');
    if (items.length) parts.push(`${h.title || 'Highlights'}:\n${items.join('\n')}`);
  }
  return parts.join('\n\n').trim();
}

/** Gong highlights for several calls: Map(callId -> text). */
export async function gongHighlights(accessKey, secretKey, callIds) {
  const out = new Map();
  if (!callIds.length) return out;
  const auth = gongAuthHeader(accessKey, secretKey);
  let cursor;
  let pages = 0;
  do {
    const data = await gongRequest(auth, '/calls/extensive', {
      method: 'POST',
      body: JSON.stringify({
        filter: { callIds: callIds.map(String) },
        contentSelector: { exposedFields: { content: { brief: true, keyPoints: true, highlights: true } } },
        ...(cursor ? { cursor } : {}),
      }),
    });
    if (data === null) break;
    for (const c of data.calls || []) {
      const id = String(c.metaData?.id || '');
      if (id) out.set(id, formatGongHighlights(c.content));
    }
    cursor = data.records?.cursor;
    pages += 1;
  } while (cursor && pages < 10);
  return out;
}
