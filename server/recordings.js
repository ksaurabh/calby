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
    state: pick(m, ['state', 'status']) || '',
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
  let pages = 0;
  while (path && pages < AVOMA_MAX_PAGES) {
    const data = await avomaGet(apiKey, path, {
      onWait: ms => onProgress?.(`Avoma is rate-limiting — waiting ${Math.round(ms / 1000)}s before continuing`),
    });
    pages += 1;
    for (const raw of avomaRows(data)) {
      const m = avomaMeeting(raw);
      if (m.id) meetings.push(m);
    }
    onProgress?.(`Reading Avoma meetings — ${meetings.length}${data?.count != null ? ` of ${data.count}` : ''} so far`);
    path = avomaNextPath(data?.next);
  }
  return { meetings, truncated: !!path };
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
