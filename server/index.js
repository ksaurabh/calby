import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import 'dotenv/config';
import {
  CALENDAR_SCOPES,
  accessTokenFor,
  consentUrl,
  createEvent,
  deleteEvent,
  exchangeCode,
  fetchBusy,
  fetchEvents,
  forgetAccessToken,
  generateState,
  updateEventTime,
} from './calendar.js';
import {
  generateSlots,
  interpretGuidance,
  reviewSlots,
  slotIsAvailable,
} from './scheduling.js';
import { usageEntries } from './llm.js';
import {
  cacheReport,
  cacheSlotReview,
  cachedReport,
  cachedSlotReview,
  classifyEvents,
  fingerprintOf,
  splitCached,
} from './classify.js';
import { askCalendar, buildCalendarContext, explainEventMatch } from './assistant.js';
import { canSealSecrets, decryptSecret, encryptSecret, maskSecret } from './secrets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust nginx reverse proxy for secure cookies
const PORT = process.env.PORT || 3002;

const DOMAINS_FILE = join(__dirname, 'allowed-domains.json');
const SUPER_ADMINS_FILE = join(__dirname, 'super-admins.json');
const USERS_FILE = join(__dirname, 'users.json');
const ORGS_FILE = join(__dirname, 'orgs.json');
const EVENT_TYPES_FILE = join(__dirname, 'event-types.json');
const BOOKINGS_FILE = join(__dirname, 'bookings.json');
const COMMITMENT_TYPES_FILE = join(__dirname, 'commitment-types.json');

// Public base URL for links in calendar invites (the frontend origin).
const PUBLIC_URL = (process.env.CLIENT_URL || 'http://localhost:5178').replace(/\/+$/, '');

// Domains that can always sign in (hardcoded)
const ALWAYS_ALLOWED_DOMAINS = ['airmdr.com'];

// Bootstrap super admin (also seed via super-admins.json)
const BOOTSTRAP_SUPER_ADMINS = ['kumar@airmdr.com'];

// ---------------------------------------------------------------------------
// File initialization
// ---------------------------------------------------------------------------
if (!existsSync(DOMAINS_FILE)) {
  writeFileSync(DOMAINS_FILE, JSON.stringify({ domains: [] }, null, 2));
}
if (!existsSync(SUPER_ADMINS_FILE)) {
  writeFileSync(SUPER_ADMINS_FILE, JSON.stringify({ superAdminEmails: BOOTSTRAP_SUPER_ADMINS }, null, 2));
}
if (!existsSync(USERS_FILE)) {
  writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}
if (!existsSync(ORGS_FILE)) {
  writeFileSync(ORGS_FILE, JSON.stringify({ orgs: [] }, null, 2));
}
if (!existsSync(EVENT_TYPES_FILE)) {
  writeFileSync(EVENT_TYPES_FILE, JSON.stringify({ eventTypes: [] }, null, 2));
}
if (!existsSync(BOOKINGS_FILE)) {
  writeFileSync(BOOKINGS_FILE, JSON.stringify({ bookings: [] }, null, 2));
}
if (!existsSync(COMMITMENT_TYPES_FILE)) {
  writeFileSync(COMMITMENT_TYPES_FILE, JSON.stringify({ commitmentTypes: [] }, null, 2));
}

// ---------------------------------------------------------------------------
// Generic JSON helpers
// ---------------------------------------------------------------------------
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------
function getAllowedDomains() {
  return readJson(DOMAINS_FILE, { domains: [] }).domains || [];
}

function saveAllowedDomains(domains) {
  writeFileSync(DOMAINS_FILE, JSON.stringify({ domains }, null, 2));
}

function isDomainAllowed(email) {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  if (ALWAYS_ALLOWED_DOMAINS.includes(domain)) return true;
  return getAllowedDomains().includes(domain);
}

// ---------------------------------------------------------------------------
// Super admins
// ---------------------------------------------------------------------------
function getSuperAdmins() {
  const fromFile = readJson(SUPER_ADMINS_FILE, { superAdminEmails: [] }).superAdminEmails || [];
  // Always include the hardcoded bootstrap admins
  return [...new Set([...BOOTSTRAP_SUPER_ADMINS, ...fromFile].map(e => e.toLowerCase()))];
}

function isSuperAdmin(email) {
  return getSuperAdmins().includes(email?.toLowerCase());
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function getUsers() {
  return readJson(USERS_FILE, { users: [] }).users || [];
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

function findUser(email) {
  return getUsers().find(u => u.email === email?.toLowerCase());
}

function upsertUser(userData) {
  const users = getUsers();
  const email = userData.email.toLowerCase();
  const now = new Date().toISOString();
  const existingIndex = users.findIndex(u => u.email === email);

  if (existingIndex >= 0) {
    users[existingIndex] = {
      ...users[existingIndex],
      name: userData.name,
      picture: userData.picture,
      domain: userData.domain,
      lastLoginAt: now,
    };
  } else {
    users.push({
      id: generateId('user'),
      email,
      name: userData.name,
      picture: userData.picture,
      domain: userData.domain,
      role: 'user', // default; super_admin is derived, admin is granted
      createdAt: now,
      lastLoginAt: now,
    });
  }

  saveUsers(users);
  return users.find(u => u.email === email);
}

// Effective role for a user: super_admin (derived) > stored role
function effectiveRole(email) {
  if (isSuperAdmin(email)) return 'super_admin';
  const user = findUser(email);
  return user?.role || 'user';
}

// ---------------------------------------------------------------------------
// Active role
// ---------------------------------------------------------------------------
// A privileged user picks, at sign-in, whether to act with their full rights or
// as an ordinary member. The choice lives in the session and is enforced by the
// authorization middleware below — so "sign in as user" genuinely closes the
// admin endpoints rather than only hiding them in the UI.
const ROLE_RANK = { user: 0, admin: 1, super_admin: 2 };

// The roles this account may act as: its own, plus plain 'user'.
function availableRoles(email) {
  const actual = effectiveRole(email);
  return actual === 'user' ? ['user'] : [actual, 'user'];
}

// The role in force for this request. A session choice can only ever reduce
// privilege, never raise it, so a stale or forged value is harmless.
function activeRole(req) {
  const actual = effectiveRole(req.user?.email);
  const chosen = req.session?.activeRole;
  if (chosen && ROLE_RANK[chosen] !== undefined && ROLE_RANK[chosen] < ROLE_RANK[actual]) {
    return chosen;
  }
  return actual;
}

function isActiveAdmin(req) {
  const role = activeRole(req);
  return role === 'admin' || role === 'super_admin';
}

function isActiveSuperAdmin(req) {
  return activeRole(req) === 'super_admin';
}

// Whether a signed-in session user may use the app.
function isUserAllowed(sessionUser) {
  if (!sessionUser?.email) return false;
  return isDomainAllowed(sessionUser.email);
}

// ---------------------------------------------------------------------------
// Orgs
// ---------------------------------------------------------------------------
function getOrgs() {
  return readJson(ORGS_FILE, { orgs: [] }).orgs || [];
}

function saveOrgs(orgs) {
  writeFileSync(ORGS_FILE, JSON.stringify({ orgs }, null, 2));
}

// Claim any unclaimed org whose domain matches this email, making the signer-in
// its admin. Called on a real sign-in only (the OAuth callback) — not on every
// /auth/user session check, so the creator doesn't claim their own org simply by
// having the page open when it is created.
// Returns the orgs claimed, for logging.
function claimOrgsOnLogin(email) {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (!domain) return [];

  const orgs = getOrgs();
  const now = new Date().toISOString();
  const claimed = [];
  for (const org of orgs) {
    if (org.domain === domain && !org.adminEmail) {
      org.adminEmail = email.toLowerCase();
      org.adminClaimedAt = now;
      org.updatedAt = now;
      claimed.push(org.name);
    }
  }
  if (claimed.length) saveOrgs(orgs);
  return claimed;
}

// Whether this user administers the org: its claimed admin, its creator, or a
// platform admin.
function canManageOrg(req, org) {
  const email = req.user?.email?.toLowerCase();
  return org.adminEmail === email || org.createdBy === email || isActiveAdmin(req);
}

// Orgs this user is the claimed admin of.
function orgsAdministeredBy(email) {
  const e = email?.toLowerCase();
  return e ? getOrgs().filter(o => o.adminEmail === e) : [];
}

// Email domains whose users an org admin may manage.
function administeredDomains(email) {
  return [...new Set(orgsAdministeredBy(email).map(o => o.domain).filter(Boolean))];
}

// Platform admins manage everyone; an org admin manages users on their org's
// email domain.
function canManageUsers(req) {
  return isActiveAdmin(req) || administeredDomains(req.user?.email).length > 0;
}

function canManageUser(req, targetEmail) {
  if (isActiveAdmin(req)) return true;
  const domain = targetEmail?.split('@')[1]?.toLowerCase();
  return !!domain && administeredDomains(req.user?.email).includes(domain);
}

// Which Anthropic key a user's model calls should run on: their organization's,
// when an admin of it has provided one, otherwise the server-wide key from .env.
// The org is matched on the user's email domain.
function anthropicKeyFor(email) {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (domain) {
    const org = getOrgs().find(o => o.domain === domain && o.anthropicKey);
    if (org) {
      const key = decryptSecret(org.anthropicKey);
      if (key) return { key, source: 'org', orgName: org.name };
      console.error(`[orgs] could not decrypt the API key for ${org.name} — was the server secret changed?`);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'server' };
  return { key: null, source: null };
}

// Orgs go to the client without the sealed key — only whether one is set, and a
// masked hint so an admin can recognise which key it is.
function publicOrg(org) {
  const { anthropicKey, anthropicKeyHint, ...rest } = org;
  return {
    ...rest,
    hasAnthropicKey: !!anthropicKey,
    anthropicKeyHint: anthropicKey ? anthropicKeyHint || '••••' : null,
  };
}

// A URL-safe slug derived from the org name, e.g. "Acme Corp." -> "acme-corp".
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Event types and bookings
// ---------------------------------------------------------------------------
function getEventTypes() {
  return readJson(EVENT_TYPES_FILE, { eventTypes: [] }).eventTypes || [];
}

function saveEventTypes(eventTypes) {
  writeFileSync(EVENT_TYPES_FILE, JSON.stringify({ eventTypes }, null, 2));
}

function getCommitmentTypes(ownerEmail) {
  const all = readJson(COMMITMENT_TYPES_FILE, { commitmentTypes: [] }).commitmentTypes || [];
  return ownerEmail ? all.filter(t => t.ownerEmail === ownerEmail.toLowerCase()) : all;
}

function saveCommitmentTypes(commitmentTypes) {
  writeFileSync(COMMITMENT_TYPES_FILE, JSON.stringify({ commitmentTypes }, null, 2));
}

// Colours are picked from a fixed palette so the calendar stays legible.
const COMMITMENT_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
  '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4b5563',
];

function getBookings() {
  return readJson(BOOKINGS_FILE, { bookings: [] }).bookings || [];
}

function saveBookings(bookings) {
  writeFileSync(BOOKINGS_FILE, JSON.stringify({ bookings }, null, 2));
}

// Per-booking secret in the cancel/reschedule links. Longer than the page slug
// because it authorizes changes to someone's meeting.
function generateManageToken() {
  return randomBytes(24).toString('base64url');
}

function cancelUrl(token) {
  return `${PUBLIC_URL}/cancel/${token}`;
}

function rescheduleUrl(token) {
  return `${PUBLIC_URL}/reschedule/${token}`;
}

// The invite body the guest and host both see in the calendar event.
function eventDescription({ eventTypeName, name, email, notes, manageToken }) {
  return [
    `${eventTypeName} booked via Calby by ${name} <${email}>.`,
    notes ? `\nNotes:\n${notes}` : '',
    '\nNeed to change this meeting?',
    `Reschedule: ${rescheduleUrl(manageToken)}`,
    `Cancel: ${cancelUrl(manageToken)}`,
  ].filter(Boolean).join('\n');
}

// Event types carry an internal name (what the owner calls it) and an external
// name (what guests see). Older records predate the split, so fall back.
function externalNameOf(eventType) {
  return eventType.externalName?.trim() || eventType.name;
}

// The public part of a booking URL: 16 random characters, unguessable, and the
// only thing standing between a stranger and the page — so it comes from a CSPRNG.
function generatePublicSlug() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789ACDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Which meeting length to use: the requested one when it is on offer, the
// event type's default otherwise. Returns null for an unsupported request.
function resolveDuration(eventType, requested) {
  const options = eventType.rules.durationOptions?.length
    ? eventType.rules.durationOptions
    : [eventType.rules.durationMinutes];
  if (requested === undefined || requested === null || requested === '') {
    return eventType.rules.durationMinutes;
  }
  const wanted = Number(requested);
  return options.includes(wanted) ? wanted : null;
}

// What a booking page may see. Never leaks the owner's guidance or email.
function publicEventType(eventType, ownerName, durationMinutes) {
  return {
    name: externalNameOf(eventType),
    description: eventType.description || '',
    ownerName,
    durationMinutes: durationMinutes || eventType.rules.durationMinutes,
    durationOptions: eventType.rules.durationOptions?.length
      ? eventType.rules.durationOptions
      : [eventType.rules.durationMinutes],
    timezone: eventType.rules.timezone,
    availabilitySummary: eventType.rules.summary || '',
  };
}

// The calendar credentials stored on a user record, if they connected one.
function calendarFor(email) {
  return findUser(email)?.calendar || null;
}

function saveCalendarFor(email, calendar) {
  const users = getUsers();
  const index = users.findIndex(u => u.email === email.toLowerCase());
  if (index < 0) return;
  users[index] = { ...users[index], calendar };
  saveUsers(users);
}

// Busy time + open slots for one event type. Shared by the owner's preview and
// the public booking page.
// `review` controls the commitment-aware pass over the candidate slots:
//   'compute' — run it (and cache the result). Used by the owner's own preview.
//   'cached'  — apply a cached review if one exists, never call the model.
// Public booking pages use 'cached' so a stranger loading a link can never
// trigger a model call, and the page stays fast.
async function availabilityFor(
  eventType,
  { ignoreBookingId = null, durationMinutes = null, review = 'cached' } = {}
) {
  const calendar = calendarFor(eventType.ownerEmail);
  if (!calendar?.refreshToken) {
    const err = new Error('The owner has not connected a calendar yet.');
    err.status = 409;
    throw err;
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + eventType.rules.horizonWeeks * 7 * 86400_000);
  const token = await accessTokenFor(eventType.ownerEmail, calendar.refreshToken);
  const busy = await fetchBusy(token, now, horizonEnd);

  // Bookings we made are already on the calendar, but freeBusy can lag a moment;
  // excluding them explicitly avoids handing out the same slot twice.
  const takenStarts = getBookings()
    .filter(b => b.eventTypeId === eventType.id && b.status !== 'cancelled' && b.id !== ignoreBookingId)
    .map(b => b.start);

  const days = generateSlots({ rules: eventType.rules, busy, now, takenStarts, durationMinutes });
  const apiKey = anthropicKeyFor(eventType.ownerEmail).key;
  if (!apiKey || !days.length) return { days, token, reviewNote: null, drops: [] };

  // What the surrounding commitments are, so the review can reason about them.
  const events = await fetchEvents(token, now, horizonEnd);
  const commitmentTypes = getCommitmentTypes(eventType.ownerEmail);
  const { assignments } =
    review === 'compute'
      ? await classifyEvents(events, commitmentTypes, { apiKey, email: eventType.ownerEmail })
      : splitCached(events, commitmentTypes);

  // Same inputs, same answer — so the whole thing is cached under one key that
  // covers the guidance, the slots on offer, and the classified commitments.
  const cacheKey = fingerprintOf({
    guidance: eventType.guidance,
    rules: eventType.rules,
    duration: durationMinutes || eventType.rules.durationMinutes,
    slots: days.flatMap(d => d.slots.map(s => s.start)),
    events: events.map(e => `${e.id}:${e.start}:${e.end}:${e.summary}:${assignments.get(e.id) || ''}`),
    types: commitmentTypes.map(t => `${t.id}:${t.condition}`),
  });

  const cached = cachedSlotReview(cacheKey);
  if (cached) {
    const dropped = new Set(cached.drops.map(d => d.start));
    return {
      days: days
        .map(day => ({ ...day, slots: day.slots.filter(s => !dropped.has(s.start)) }))
        .filter(day => day.slots.length),
      token,
      reviewNote: cached.note,
      drops: cached.drops,
    };
  }
  if (review !== 'compute') return { days, token, reviewNote: null, drops: [] };

  const result = await reviewSlots({
    guidance: eventType.guidance,
    rules: eventType.rules,
    days,
    events,
    commitmentTypes,
    assignments,
    apiKey,
    email: eventType.ownerEmail,
  });
  if (result.reviewed) {
    cacheSlotReview(cacheKey, { drops: result.drops, note: result.note });
  }
  return { days: result.days, token, reviewNote: result.note, drops: result.drops };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5178',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'calby-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    // 'lax' (not 'strict') so the session cookie is sent on the top-level
    // redirect back from Google's OAuth screen; 'strict' would drop it and
    // bounce the user back to the login page after sign-in.
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3002/auth/google/callback',
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails?.[0]?.value?.toLowerCase();
  const user = {
    id: profile.id,
    email,
    name: profile.displayName,
    picture: profile.photos?.[0]?.value,
    domain: email?.split('@')[1]?.toLowerCase(),
  };
  return done(null, user);
}));

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    // A genuine sign-in: hand this user any unclaimed org on their domain.
    if (isUserAllowed(req.user)) {
      const claimed = claimOrgsOnLogin(req.user.email);
      if (claimed.length) {
        console.log(`${req.user.email} is now admin of: ${claimed.join(', ')}`);
      }
    }
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5178';
    res.redirect(`${clientUrl}/auth/callback`);
  }
);

app.get('/auth/failure', (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5178';
  res.redirect(`${clientUrl}/login?error=auth_failed`);
});

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

app.get('/auth/user', (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }

  const allowed = isUserAllowed(req.user);
  let storedUser = null;
  if (allowed) {
    storedUser = upsertUser({
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture,
      domain: req.user.domain,
    });
  }

  const actualRole = effectiveRole(req.user.email);
  const roles = allowed ? availableRoles(req.user.email) : ['user'];
  const role = allowed ? activeRole(req) : actualRole;
  res.json({
    authenticated: true,
    allowed,
    user: {
      ...req.user,
      name: storedUser?.name || req.user.name,
      role,
    },
    role,
    actualRole,
    availableRoles: roles,
    // The frontend shows the role picker while this is true.
    needsRoleChoice: allowed && roles.length > 1 && !req.session.activeRole,
    isAdmin: role === 'admin' || role === 'super_admin',
    isSuperAdmin: role === 'super_admin',
    // Org admins can manage users on their org's domain without being platform
    // admins, so the frontend needs this separately from isAdmin.
    canManageUsers: allowed && canManageUsers(req),
    // Where this user's model calls get their API key: their org, the server, or nowhere.
    aiKeySource: allowed ? anthropicKeyFor(req.user.email).source : null,
    orgAdminOf: allowed ? orgsAdministeredBy(req.user.email).map(o => o.name) : [],
  });
});

// Choose (or switch) the role to act as for the rest of the session.
// Lives under /api/ so it is covered by the existing nginx proxy block.
app.post('/api/session/role', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isUserAllowed(req.user)) return res.status(403).json({ error: 'Access not allowed' });

  const role = req.body.role;
  if (!availableRoles(req.user.email).includes(role)) {
    return res.status(400).json({ error: 'That role is not available to this account' });
  }

  req.session.activeRole = role;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Could not save the role selection' });
    res.json({ ok: true, role, actualRole: effectiveRole(req.user.email) });
  });
});

// ---------------------------------------------------------------------------
// Authorization middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isUserAllowed(req.user)) return res.status(403).json({ error: 'Access not allowed' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isActiveAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isActiveSuperAdmin(req)) return res.status(403).json({ error: 'Super admin access required' });
  next();
}

// ---------------------------------------------------------------------------
// Orgs — any authenticated user can list and create; the creator (or an admin)
// can rename or delete.
// ---------------------------------------------------------------------------
app.get('/api/orgs', requireAuth, (req, res) => {
  const orgs = [...getOrgs()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicOrg);
  res.json({ orgs });
});

app.post('/api/orgs', requireAuth, (req, res) => {
  const name = req.body.name?.trim();
  const domain = req.body.domain?.toLowerCase().trim() || '';
  if (!name) return res.status(400).json({ error: 'Organization name is required' });

  const orgs = getOrgs();
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Organization name must contain letters or numbers' });
  if (orgs.some(o => o.slug === slug)) {
    return res.status(400).json({ error: 'An organization with that name already exists' });
  }

  const now = new Date().toISOString();
  const org = {
    id: generateId('org'),
    name,
    slug,
    domain,
    // Claimed by the first person with a matching email domain to sign in.
    // An org with no domain stays unclaimed; its creator still manages it.
    adminEmail: null,
    adminClaimedAt: null,
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  };
  orgs.push(org);
  saveOrgs(orgs);
  res.json(publicOrg(org));
});

app.put('/api/orgs/:id', requireAuth, (req, res) => {
  const orgs = getOrgs();
  const index = orgs.findIndex(o => o.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Organization not found' });
  if (!canManageOrg(req, orgs[index])) {
    return res.status(403).json({ error: 'Only this organization\'s admin can edit it' });
  }

  const name = req.body.name?.trim() || orgs[index].name;
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'Organization name must contain letters or numbers' });
  if (orgs.some((o, i) => i !== index && o.slug === slug)) {
    return res.status(400).json({ error: 'An organization with that name already exists' });
  }

  orgs[index] = {
    ...orgs[index],
    name,
    slug,
    domain: req.body.domain !== undefined ? req.body.domain.toLowerCase().trim() : orgs[index].domain,
    updatedAt: new Date().toISOString(),
  };
  saveOrgs(orgs);
  res.json(publicOrg(orgs[index]));
});

// An org admin supplies one Anthropic key for everyone on the org's domain, so
// individual users never have to hold one. Verified against the API before it
// is stored, then sealed — it is never sent back to a client.
app.put('/api/orgs/:id/anthropic-key', requireAuth, async (req, res) => {
  const orgs = getOrgs();
  const index = orgs.findIndex(o => o.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Organization not found' });
  if (!canManageOrg(req, orgs[index])) {
    return res.status(403).json({ error: 'Only this organization\'s admin can set its API key' });
  }
  if (!orgs[index].domain) {
    return res.status(400).json({
      error: 'Give this organization an email domain first — the key is shared with everyone on that domain.',
    });
  }
  if (!canSealSecrets()) {
    return res.status(500).json({ error: 'Set SESSION_SECRET on the server before storing API keys.' });
  }

  const apiKey = req.body.apiKey?.trim();
  if (!apiKey) return res.status(400).json({ error: 'Paste an Anthropic API key' });
  if (!apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'That does not look like an Anthropic API key (they start with sk-ant-).' });
  }

  // Check the key works before saving, so a typo fails here rather than later
  // for every user in the org.
  try {
    const probe = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (probe.status === 401 || probe.status === 403) {
      return res.status(400).json({ error: 'Anthropic rejected that key. Check it and try again.' });
    }
    if (!probe.ok) {
      const detail = await probe.json().catch(() => ({}));
      return res.status(400).json({
        error: detail.error?.message || `Could not verify the key (HTTP ${probe.status}).`,
      });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not reach the Anthropic API: ${err.message}` });
  }

  const now = new Date().toISOString();
  orgs[index] = {
    ...orgs[index],
    anthropicKey: encryptSecret(apiKey),
    anthropicKeyHint: maskSecret(apiKey),
    anthropicKeySetBy: req.user.email,
    anthropicKeySetAt: now,
    updatedAt: now,
  };
  saveOrgs(orgs);
  res.json(publicOrg(orgs[index]));
});

app.delete('/api/orgs/:id/anthropic-key', requireAuth, (req, res) => {
  const orgs = getOrgs();
  const index = orgs.findIndex(o => o.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Organization not found' });
  if (!canManageOrg(req, orgs[index])) {
    return res.status(403).json({ error: 'Only this organization\'s admin can remove its API key' });
  }

  orgs[index] = {
    ...orgs[index],
    anthropicKey: null,
    anthropicKeyHint: null,
    anthropicKeySetBy: null,
    anthropicKeySetAt: null,
    updatedAt: new Date().toISOString(),
  };
  saveOrgs(orgs);
  res.json(publicOrg(orgs[index]));
});

app.delete('/api/orgs/:id', requireAuth, (req, res) => {
  const orgs = getOrgs();
  const org = orgs.find(o => o.id === req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (!canManageOrg(req, org)) {
    return res.status(403).json({ error: 'Only this organization\'s admin can delete it' });
  }
  saveOrgs(orgs.filter(o => o.id !== org.id));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------
// Platform admins see every user; an org admin sees only their domain's users.
app.get('/api/users', requireAuth, (req, res) => {
  if (!canManageUsers(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const domains = administeredDomains(req.user.email);
  const users = getUsers()
    .filter(u => isActiveAdmin(req) || domains.includes(u.domain))
    .map(u => ({ ...u, role: effectiveRole(u.email) }));
  res.json({ users, scopedToDomains: isActiveAdmin(req) ? null : domains });
});

// Create a user ahead of their first sign-in. They still authenticate with
// Google; this pre-registers the account (and its name) so it can be listed and
// given a role before they ever log in.
app.post('/api/users', requireAuth, (req, res) => {
  const email = req.body.email?.toLowerCase().trim();
  const name = req.body.name?.trim() || '';

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!canManageUsers(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!canManageUser(req, email)) {
    return res.status(403).json({ error: 'You can only add users on your own organization\'s domain' });
  }
  if (findUser(email)) {
    return res.status(400).json({ error: 'That user already exists' });
  }

  const domain = email.split('@')[1];
  const users = getUsers();
  const user = {
    id: generateId('user'),
    email,
    name: name || email,
    domain,
    role: 'user',
    createdAt: new Date().toISOString(),
    createdBy: req.user.email,
    lastLoginAt: null,
  };
  users.push(user);
  saveUsers(users);

  // Sign-in is still gated by the allowed-domain list.
  res.json({ ...user, canSignIn: isDomainAllowed(email) });
});

app.delete('/api/users/:email', requireAuth, (req, res) => {
  const email = req.params.email.toLowerCase();

  if (!canManageUsers(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!canManageUser(req, email)) {
    return res.status(403).json({ error: 'You can only remove users on your own organization\'s domain' });
  }
  if (email === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: 'You cannot remove your own account' });
  }
  if (isSuperAdmin(email)) {
    return res.status(400).json({ error: 'Super admins are managed in super-admins.json' });
  }

  const users = getUsers();
  if (!users.some(u => u.email === email)) {
    return res.status(404).json({ error: 'User not found' });
  }
  saveUsers(users.filter(u => u.email !== email));

  // Hand any org they administered back to the next matching sign-in.
  const orgs = getOrgs();
  let released = false;
  for (const org of orgs) {
    if (org.adminEmail === email) {
      org.adminEmail = null;
      org.adminClaimedAt = null;
      released = true;
    }
  }
  if (released) saveOrgs(orgs);

  res.json({ success: true, releasedOrgs: released });
});

app.put('/api/users/:email/role', requireSuperAdmin, (req, res) => {
  const email = req.params.email.toLowerCase();
  const role = req.body.role;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (isSuperAdmin(email)) {
    return res.status(400).json({ error: 'Super admin roles are managed in super-admins.json' });
  }
  const users = getUsers();
  const index = users.findIndex(u => u.email === email);
  if (index < 0) return res.status(404).json({ error: 'User not found' });
  users[index] = { ...users[index], role };
  saveUsers(users);
  res.json(users[index]);
});

// ---------------------------------------------------------------------------
// Allowed domains (who can sign in)
// ---------------------------------------------------------------------------
app.get('/api/domains', requireAdmin, (req, res) => {
  res.json({ domains: getAllowedDomains(), alwaysAllowed: ALWAYS_ALLOWED_DOMAINS });
});

app.post('/api/domains', requireSuperAdmin, (req, res) => {
  const domain = req.body.domain?.toLowerCase().trim();
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });
  const domains = getAllowedDomains();
  if (domains.includes(domain) || ALWAYS_ALLOWED_DOMAINS.includes(domain)) {
    return res.status(400).json({ error: 'Domain already allowed' });
  }
  domains.push(domain);
  saveAllowedDomains(domains);
  res.json({ domains, alwaysAllowed: ALWAYS_ALLOWED_DOMAINS });
});

app.delete('/api/domains/:domain', requireSuperAdmin, (req, res) => {
  const domains = getAllowedDomains().filter(d => d !== req.params.domain.toLowerCase());
  saveAllowedDomains(domains);
  res.json({ domains, alwaysAllowed: ALWAYS_ALLOWED_DOMAINS });
});


// ---------------------------------------------------------------------------
// Calendar connection (explicit, separate from sign-in)
// ---------------------------------------------------------------------------
app.get('/api/calendar/status', requireAuth, (req, res) => {
  const calendar = calendarFor(req.user.email);
  res.json({
    connected: !!calendar?.refreshToken,
    connectedAt: calendar?.connectedAt || null,
    scopes: CALENDAR_SCOPES,
  });
});

app.get('/api/calendar/connect', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured' });
  }
  const state = generateState();
  req.session.calendarState = state;
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Could not start the calendar connection' });
    res.redirect(consentUrl(state));
  });
});

app.get('/api/calendar/callback', async (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5178';
  const fail = reason => res.redirect(`${clientUrl}/event-types?calendar=${reason}`);

  if (!req.user) return fail('signin_required');
  if (!req.query.code || req.query.state !== req.session.calendarState) return fail('failed');
  delete req.session.calendarState;

  try {
    const tokens = await exchangeCode(req.query.code);
    saveCalendarFor(req.user.email, {
      refreshToken: tokens.refresh_token,
      scopes: (tokens.scope || '').split(' ').filter(Boolean),
      connectedAt: new Date().toISOString(),
    });
    forgetAccessToken(req.user.email);
    res.redirect(`${clientUrl}/event-types?calendar=connected`);
  } catch (err) {
    console.error('[calendar] connect failed:', err.message);
    fail('failed');
  }
});

app.delete('/api/calendar/connect', requireAuth, (req, res) => {
  saveCalendarFor(req.user.email, null);
  forgetAccessToken(req.user.email);
  res.json({ connected: false });
});

// ---------------------------------------------------------------------------
// Event types — a name plus plain-text guidance, which Claude turns into rules
// ---------------------------------------------------------------------------
app.get('/api/event-types', requireAuth, (req, res) => {
  const mine = getEventTypes()
    .filter(e => e.ownerEmail === req.user.email.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ eventTypes: mine });
});

app.post('/api/event-types', requireAuth, async (req, res) => {
  const name = req.body.name?.trim();
  const guidance = req.body.guidance?.trim() || '';
  if (!name) return res.status(400).json({ error: 'A name is required' });
  if (!guidance) return res.status(400).json({ error: 'Guidance is required — describe when people may book you' });

  const key = anthropicKeyFor(req.user.email);
  const { rules, source } = await interpretGuidance(guidance, {
    timezone: req.body.timezone,
    apiKey: key.key,
    email: req.user.email,
    keySource: key.source,
  });
  const now = new Date().toISOString();
  const eventTypes = getEventTypes();
  const eventType = {
    id: generateId('evt'),
    ownerEmail: req.user.email.toLowerCase(),
    name,
    externalName: req.body.externalName?.trim() || name,
    description: req.body.description?.trim() || '',
    guidance,
    slug: generatePublicSlug(),
    rules,
    rulesSource: source,
    rulesUpdatedAt: now,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  eventTypes.push(eventType);
  saveEventTypes(eventTypes);
  res.json(eventType);
});

app.put('/api/event-types/:id', requireAuth, async (req, res) => {
  const eventTypes = getEventTypes();
  const index = eventTypes.findIndex(
    e => e.id === req.params.id && e.ownerEmail === req.user.email.toLowerCase()
  );
  if (index < 0) return res.status(404).json({ error: 'Event type not found' });

  const current = eventTypes[index];
  const guidance = req.body.guidance?.trim() ?? current.guidance;
  const now = new Date().toISOString();

  // Re-read the guidance only when it actually changed — one model call per edit.
  let { rules, rulesSource, rulesUpdatedAt } = current;
  if (guidance !== current.guidance) {
    const key = anthropicKeyFor(req.user.email);
    const interpreted = await interpretGuidance(guidance, {
      timezone: current.rules.timezone,
      apiKey: key.key,
      email: req.user.email,
      keySource: key.source,
    });
    rules = interpreted.rules;
    rulesSource = interpreted.source;
    rulesUpdatedAt = now;
  }

  eventTypes[index] = {
    ...current,
    name: req.body.name?.trim() || current.name,
    externalName: req.body.externalName?.trim() || externalNameOf(current),
    description: req.body.description?.trim() ?? current.description,
    guidance,
    active: typeof req.body.active === 'boolean' ? req.body.active : current.active,
    rules,
    rulesSource,
    rulesUpdatedAt,
    updatedAt: now,
  };
  saveEventTypes(eventTypes);
  res.json(eventTypes[index]);
});

app.delete('/api/event-types/:id', requireAuth, (req, res) => {
  const eventTypes = getEventTypes();
  const eventType = eventTypes.find(
    e => e.id === req.params.id && e.ownerEmail === req.user.email.toLowerCase()
  );
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });
  saveEventTypes(eventTypes.filter(e => e.id !== eventType.id));
  res.json({ success: true });
});

// The owner's own preview: bookable slots plus the meetings already on their
// calendar, so the two can be seen side by side.
app.get('/api/event-types/:id/availability', requireAuth, async (req, res) => {
  const eventType = getEventTypes().find(
    e => e.id === req.params.id && e.ownerEmail === req.user.email.toLowerCase()
  );
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });

  const durationMinutes = resolveDuration(eventType, req.query.duration);
  if (!durationMinutes) return res.status(400).json({ error: 'That meeting length is not offered' });

  try {
    const { days, token, reviewNote, drops } = await availabilityFor(eventType, {
      durationMinutes,
      review: 'compute',
    });
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + eventType.rules.horizonWeeks * 7 * 86400_000);
    // Event titles are the owner's own data — this route is behind requireAuth
    // and scoped to event types they own.
    const events = await fetchEvents(token, now, horizonEnd);

    // Colour-code the calendar by commitment type.
    const commitmentTypes = getCommitmentTypes(req.user.email);
    const key = anthropicKeyFor(req.user.email);
    const { assignments } = await classifyEvents(events, commitmentTypes, {
      apiKey: key.key,
      email: req.user.email,
      keySource: key.source,
    });
    const labelled = events.map(e => ({ ...e, commitmentTypeId: assignments.get(e.id) || null }));

    res.json({
      days,
      rules: eventType.rules,
      events: labelled,
      commitmentTypes,
      durationMinutes,
      // What the commitment-aware review did to the candidate slots.
      reviewNote,
      drops,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Bookings taken against the signed-in user's event types.
app.get('/api/bookings', requireAuth, (req, res) => {
  const mine = new Set(
    getEventTypes().filter(e => e.ownerEmail === req.user.email.toLowerCase()).map(e => e.id)
  );
  const bookings = getBookings()
    .filter(b => mine.has(b.eventTypeId))
    .sort((a, b) => b.start.localeCompare(a.start))
    .map(b => ({
      ...b,
      cancelUrl: b.manageToken ? cancelUrl(b.manageToken) : null,
      rescheduleUrl: b.manageToken ? rescheduleUrl(b.manageToken) : null,
    }));
  res.json({ bookings });
});

// ---------------------------------------------------------------------------
// Public booking page — no authentication, addressed only by the 16-char slug
// ---------------------------------------------------------------------------
function findBySlug(slug) {
  return getEventTypes().find(e => e.slug === slug && e.active);
}

app.get('/api/book/:slug', async (req, res) => {
  const eventType = findBySlug(req.params.slug);
  if (!eventType) return res.status(404).json({ error: 'This booking link is not valid.' });

  const durationMinutes = resolveDuration(eventType, req.query.duration);
  if (!durationMinutes) return res.status(400).json({ error: 'That meeting length is not offered' });

  const owner = findUser(eventType.ownerEmail);
  try {
    const { days } = await availabilityFor(eventType, { durationMinutes });
    res.json({
      eventType: publicEventType(eventType, owner?.name || 'the host', durationMinutes),
      days,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

app.post('/api/book/:slug', async (req, res) => {
  const eventType = findBySlug(req.params.slug);
  if (!eventType) return res.status(404).json({ error: 'This booking link is not valid.' });

  const name = req.body.name?.trim();
  const email = req.body.email?.toLowerCase().trim();
  const notes = req.body.notes?.trim() || '';
  const start = req.body.start;

  if (!name) return res.status(400).json({ error: 'Your name is required' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!start || Number.isNaN(Date.parse(start))) return res.status(400).json({ error: 'Pick a time slot' });

  const durationMinutes = resolveDuration(eventType, req.body.durationMinutes);
  if (!durationMinutes) return res.status(400).json({ error: 'That meeting length is not offered' });

  try {
    // Re-check against the live calendar: the slot may have been taken between
    // the page loading and this submission.
    const { days, token } = await availabilityFor(eventType, { durationMinutes });
    if (!slotIsAvailable(new Date(start).toISOString(), days)) {
      return res.status(409).json({ error: 'That time was just taken. Please pick another slot.' });
    }

    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
    const owner = findUser(eventType.ownerEmail);

    const manageToken = generateManageToken();
    const publicName = externalNameOf(eventType);
    const event = await createEvent(token, {
      summary: `${publicName} — ${name}`,
      description: eventDescription({
        eventTypeName: publicName,
        name,
        email,
        notes,
        manageToken,
      }),
      start: startDate,
      end: endDate,
      timeZone: eventType.rules.timezone,
      attendee: { email, name },
    });

    const booking = {
      id: generateId('booking'),
      manageToken,
      eventTypeId: eventType.id,
      // Internal name for the owner's list; external name for guest-facing pages.
      eventTypeName: eventType.name,
      eventTypeExternalName: publicName,
      ownerEmail: eventType.ownerEmail,
      name,
      email,
      notes,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      durationMinutes,
      timezone: eventType.rules.timezone,
      googleEventId: event.id || null,
      googleEventLink: event.htmlLink || null,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    saveBookings([...getBookings(), booking]);

    res.json({
      ok: true,
      booking: {
        start: booking.start,
        end: booking.end,
        durationMinutes,
        timezone: booking.timezone,
        name: booking.name,
        email: booking.email,
        eventTypeName: publicName,
        ownerName: owner?.name || 'the host',
        cancelUrl: cancelUrl(manageToken),
        rescheduleUrl: rescheduleUrl(manageToken),
      },
    });
  } catch (err) {
    console.error('[booking] failed:', err.message);
    res.status(err.status === 409 ? 409 : 502).json({ error: err.message });
  }
});


// ---------------------------------------------------------------------------
// Manage a booking from the links in the calendar invite. Authorized by the
// per-booking token in the URL — the guest has no account to sign in to.
// ---------------------------------------------------------------------------
function bookingByToken(token) {
  return getBookings().find(b => b.manageToken && b.manageToken === token);
}

function publicBooking(booking, eventType, ownerName) {
  return {
    eventTypeName:
      booking.eventTypeExternalName ||
      (eventType ? externalNameOf(eventType) : booking.eventTypeName),
    ownerName,
    name: booking.name,
    email: booking.email,
    notes: booking.notes,
    start: booking.start,
    end: booking.end,
    timezone: booking.timezone,
    durationMinutes: booking.durationMinutes || eventType?.rules.durationMinutes || null,
    status: booking.status,
  };
}

// Details for the cancel and reschedule pages. Reschedule also needs open slots.
app.get('/api/booking/:token', async (req, res) => {
  const booking = bookingByToken(req.params.token);
  if (!booking) return res.status(404).json({ error: 'This link is not valid.' });

  const eventType = getEventTypes().find(e => e.id === booking.eventTypeId);
  const owner = findUser(booking.ownerEmail);
  const payload = {
    booking: publicBooking(booking, eventType, owner?.name || 'the host'),
    days: [],
  };

  // Cancelled bookings are still viewable so the page can say so plainly.
  if (booking.status === 'cancelled' || !eventType || !eventType.active) {
    return res.json(payload);
  }

  try {
    // Ignore this booking's own slot so the current time isn't double-counted.
    const { days } = await availabilityFor(eventType, {
      ignoreBookingId: booking.id,
      // Offer alternatives at the length this meeting was booked at.
      durationMinutes: booking.durationMinutes || eventType.rules.durationMinutes,
    });
    payload.days = days;
  } catch {
    // Availability is only needed for rescheduling; cancelling still works.
  }
  res.json(payload);
});

app.post('/api/booking/:token/cancel', async (req, res) => {
  const bookings = getBookings();
  const index = bookings.findIndex(b => b.manageToken === req.params.token);
  if (index < 0) return res.status(404).json({ error: 'This link is not valid.' });

  const booking = bookings[index];
  if (booking.status === 'cancelled') {
    return res.json({ ok: true, alreadyCancelled: true });
  }

  try {
    const calendar = calendarFor(booking.ownerEmail);
    if (calendar?.refreshToken && booking.googleEventId) {
      const token = await accessTokenFor(booking.ownerEmail, calendar.refreshToken);
      await deleteEvent(token, booking.googleEventId);
    }
  } catch (err) {
    // A 404/410 means it is already gone from the calendar — still cancel ours.
    if (err.status !== 404 && err.status !== 410) {
      console.error('[booking] cancel failed:', err.message);
      return res.status(502).json({ error: err.message });
    }
  }

  bookings[index] = {
    ...booking,
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: 'guest',
    cancelReason: req.body?.reason?.trim() || '',
  };
  saveBookings(bookings);
  res.json({ ok: true });
});

app.post('/api/booking/:token/reschedule', async (req, res) => {
  const bookings = getBookings();
  const index = bookings.findIndex(b => b.manageToken === req.params.token);
  if (index < 0) return res.status(404).json({ error: 'This link is not valid.' });

  const booking = bookings[index];
  if (booking.status === 'cancelled') {
    return res.status(400).json({ error: 'This meeting was cancelled. Please book a new time.' });
  }

  const start = req.body.start;
  if (!start || Number.isNaN(Date.parse(start))) {
    return res.status(400).json({ error: 'Pick a new time slot' });
  }

  const eventType = getEventTypes().find(e => e.id === booking.eventTypeId);
  if (!eventType || !eventType.active) {
    return res.status(409).json({ error: 'This event type is no longer taking bookings.' });
  }

  try {
    const durationMinutes = booking.durationMinutes || eventType.rules.durationMinutes;
    const { days, token } = await availabilityFor(eventType, {
      ignoreBookingId: booking.id,
      durationMinutes,
    });
    const startIso = new Date(start).toISOString();
    if (!slotIsAvailable(startIso, days)) {
      return res.status(409).json({ error: 'That time is no longer open. Please pick another slot.' });
    }

    const startDate = new Date(startIso);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);

    if (booking.googleEventId) {
      await updateEventTime(token, booking.googleEventId, {
        start: startDate,
        end: endDate,
        timeZone: eventType.rules.timezone,
      });
    }

    bookings[index] = {
      ...booking,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      rescheduledAt: new Date().toISOString(),
      previousStart: booking.start,
    };
    saveBookings(bookings);

    const owner = findUser(booking.ownerEmail);
    res.json({ ok: true, booking: publicBooking(bookings[index], eventType, owner?.name || 'the host') });
  } catch (err) {
    console.error('[booking] reschedule failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});


// ---------------------------------------------------------------------------
// The owner's calendar: entries in a window, labelled by commitment type, plus
// a question-answering endpoint over the same data.
// ---------------------------------------------------------------------------
// A sensible default window for browsing and for questions: last week through
// the next four.
const CALENDAR_WINDOW = { back: 7, forward: 28 };

function calendarWindow(query = {}) {
  const back = Math.min(90, Math.max(0, Number(query.back) || CALENDAR_WINDOW.back));
  const forward = Math.min(180, Math.max(1, Number(query.forward) || CALENDAR_WINDOW.forward));
  const now = new Date();
  return {
    from: new Date(now.getTime() - back * 86400_000),
    to: new Date(now.getTime() + forward * 86400_000),
  };
}

// The timezone to read the calendar in: whichever the owner's event types use,
// else the app default.
function ownerTimezone(email) {
  const mine = getEventTypes().filter(e => e.ownerEmail === email.toLowerCase());
  return mine[0]?.rules?.timezone || 'America/Los_Angeles';
}

async function ownerEvents(req, { from, to, maxResults = 250 }) {
  const calendar = calendarFor(req.user.email);
  if (!calendar?.refreshToken) {
    const err = new Error('Connect your Google Calendar first.');
    err.status = 409;
    throw err;
  }
  const token = await accessTokenFor(req.user.email, calendar.refreshToken);
  const events = await fetchEvents(token, from, to, { maxResults });
  const key = anthropicKeyFor(req.user.email);
  const commitmentTypes = getCommitmentTypes(req.user.email);
  const { assignments, stats } = await classifyEvents(events, commitmentTypes, {
    apiKey: key.key,
    email: req.user.email,
    keySource: key.source,
  });
  return { events, commitmentTypes, assignments, stats };
}

// Background classification jobs. The calendar paints from cache immediately;
// anything still unjudged is worked through here so the page can report
// progress instead of waiting on a model call.
const classificationJobs = new Map();
const JOB_TTL = 10 * 60 * 1000;

function reapJobs() {
  const cutoff = Date.now() - JOB_TTL;
  for (const [id, job] of classificationJobs) {
    if (job.updatedAt < cutoff) classificationJobs.delete(id);
  }
}

app.post('/api/calendar/classify', requireAuth, async (req, res) => {
  reapJobs();
  const { from, to } = calendarWindow(req.body);

  let events;
  let commitmentTypes;
  try {
    const calendar = calendarFor(req.user.email);
    if (!calendar?.refreshToken) return res.status(409).json({ error: 'Connect your Google Calendar first.' });
    const token = await accessTokenFor(req.user.email, calendar.refreshToken);
    events = await fetchEvents(token, from, to);
    commitmentTypes = getCommitmentTypes(req.user.email);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }

  const { pending } = splitCached(events, commitmentTypes);
  if (!pending.length) {
    return res.json({ jobId: null, total: 0, done: 0, finished: true, assignments: {} });
  }

  const jobId = generateId('job');
  const job = {
    ownerEmail: req.user.email.toLowerCase(),
    total: pending.length,
    done: 0,
    assignments: {},
    finished: false,
    error: null,
    method: anthropicKeyFor(req.user.email).key ? 'model' : 'keyword',
    updatedAt: Date.now(),
  };
  classificationJobs.set(jobId, job);

  // Runs past this response; the client polls /api/calendar/classify/:jobId.
  (async () => {
    try {
      const key = anthropicKeyFor(req.user.email);
      const { assignments } = await classifyEvents(events, commitmentTypes, {
        apiKey: key.key,
        email: req.user.email,
        keySource: key.source,
        // The accumulated map is handed in: referring to the awaited result
        // from here would hit it before it is assigned.
        onProgress: (done, _total, assignments) => {
          job.done = done;
          job.assignments = Object.fromEntries(assignments);
          job.updatedAt = Date.now();
        },
      });
      job.assignments = Object.fromEntries(assignments);
      job.done = job.total;
    } catch (err) {
      console.error('[classify] job failed:', err.message);
      job.error = err.message;
    } finally {
      job.finished = true;
      job.updatedAt = Date.now();
    }
  })();

  res.json({ jobId, total: job.total, done: 0, finished: false, method: job.method, assignments: {} });
});

app.get('/api/calendar/classify/:jobId', requireAuth, (req, res) => {
  const job = classificationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'That classification job has expired.' });
  if (job.ownerEmail !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: 'Not your job' });
  }
  res.json({
    total: job.total,
    done: job.done,
    finished: job.finished,
    error: job.error,
    method: job.method,
    assignments: job.assignments,
  });
});

app.get('/api/calendar/events', requireAuth, async (req, res) => {
  const { from, to } = calendarWindow(req.query);
  try {
    const calendar = calendarFor(req.user.email);
    if (!calendar?.refreshToken) {
      return res.status(409).json({ error: 'Connect your Google Calendar first.' });
    }
    const token = await accessTokenFor(req.user.email, calendar.refreshToken);
    const events = await fetchEvents(token, from, to);
    const commitmentTypes = getCommitmentTypes(req.user.email);

    // Colour from the cache only — no model call — so the calendar renders
    // immediately. Anything still unjudged is reported as pending, and the
    // client starts a classification job for it.
    const { assignments, pending } = splitCached(events, commitmentTypes);

    res.json({
      events: events.map(e => ({ ...e, commitmentTypeId: assignments.get(e.id) || null })),
      commitmentTypes,
      timezone: ownerTimezone(req.user.email),
      from: from.toISOString(),
      to: to.toISOString(),
      classification: {
        cached: events.length - pending.length,
        pending: pending.length,
        matched: assignments.size,
        // How verdicts are reached for this user: with a key it is the model,
        // without one it is keyword overlap, which matches far less.
        method: anthropicKeyFor(req.user.email).key ? 'model' : 'keyword',
      },
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Ask a question about the calendar. The entries are rendered into the prompt —
// the model gets titles, times, organizers, guests and responses, and nothing
// beyond the owner's own calendar.
app.post('/api/calendar/ask', requireAuth, async (req, res) => {
  const question = req.body.question?.trim();
  if (!question) return res.status(400).json({ error: 'Ask a question' });
  if (question.length > 2000) return res.status(400).json({ error: 'That question is too long' });

  const { from, to } = calendarWindow(req.body);
  try {
    const { events, commitmentTypes, assignments } = await ownerEvents(req, { from, to });
    const timezone = ownerTimezone(req.user.email);
    const context = buildCalendarContext({ events, timezone, commitmentTypes, assignments });
    const askKey = anthropicKeyFor(req.user.email);
    const answer = await askCalendar({
      question,
      context,
      history: Array.isArray(req.body.history) ? req.body.history : [],
      apiKey: askKey.key,
      email: req.user.email,
      keySource: askKey.source,
    });
    res.json({ answer, eventsConsidered: events.length, timezone });
  } catch (err) {
    console.error('[assistant] failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Explain one entry against every commitment type: does it satisfy the
// condition, and on what evidence.
app.post('/api/calendar/explain', requireAuth, async (req, res) => {
  const eventId = req.body.eventId;
  if (!eventId) return res.status(400).json({ error: 'Pick an event' });

  const { from, to } = calendarWindow(req.body);
  try {
    const { events, commitmentTypes } = await ownerEvents(req, { from, to });
    const event = events.find(e => e.id === eventId);
    if (!event) return res.status(404).json({ error: 'That event is not in the current window.' });

    // The report for an unchanged event against unchanged conditions never
    // changes, so it is cached alongside the colours.
    const cached = cachedReport(event, commitmentTypes);
    if (cached) return res.json({ event, ...cached, cached: true });

    const explainKey = anthropicKeyFor(req.user.email);
    const report = await explainEventMatch({
      event,
      commitmentTypes,
      timezone: ownerTimezone(req.user.email),
      apiKey: explainKey.key,
      email: req.user.email,
      keySource: explainKey.source,
    });
    // Stored with the report, so a cached answer still says when it was worked out.
    report.calculatedAt = new Date().toISOString();
    cacheReport(event, commitmentTypes, report);
    res.json({ event, ...report, cached: false });
  } catch (err) {
    console.error('[assistant] explain failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Commitment types — plain-text conditions describing what a calendar entry is,
// each with a colour, used to colour-code the availability preview.
// ---------------------------------------------------------------------------
app.get('/api/commitment-types', requireAuth, (req, res) => {
  res.json({
    commitmentTypes: getCommitmentTypes(req.user.email)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    colors: COMMITMENT_COLORS,
  });
});

app.post('/api/commitment-types', requireAuth, (req, res) => {
  const name = req.body.name?.trim();
  const condition = req.body.condition?.trim() || '';
  if (!name) return res.status(400).json({ error: 'A name is required' });
  if (!condition) {
    return res.status(400).json({ error: 'Describe which calendar entries satisfy this commitment' });
  }

  const all = getCommitmentTypes();
  const mine = all.filter(t => t.ownerEmail === req.user.email.toLowerCase());
  const now = new Date().toISOString();
  const commitmentType = {
    id: generateId('ct'),
    ownerEmail: req.user.email.toLowerCase(),
    name,
    condition,
    // Default to the next unused palette colour.
    color: COMMITMENT_COLORS.includes(req.body.color)
      ? req.body.color
      : COMMITMENT_COLORS[mine.length % COMMITMENT_COLORS.length],
    createdAt: now,
    updatedAt: now,
  };
  saveCommitmentTypes([...all, commitmentType]);
  // No cache wipe needed: cached verdicts are keyed by the set of conditions,
  // so changing them simply misses and re-asks.
  res.json(commitmentType);
});

app.put('/api/commitment-types/:id', requireAuth, (req, res) => {
  const all = getCommitmentTypes();
  const index = all.findIndex(
    t => t.id === req.params.id && t.ownerEmail === req.user.email.toLowerCase()
  );
  if (index < 0) return res.status(404).json({ error: 'Commitment type not found' });

  all[index] = {
    ...all[index],
    name: req.body.name?.trim() || all[index].name,
    condition: req.body.condition?.trim() || all[index].condition,
    color: COMMITMENT_COLORS.includes(req.body.color) ? req.body.color : all[index].color,
    updatedAt: new Date().toISOString(),
  };
  saveCommitmentTypes(all);
  res.json(all[index]);
});

app.delete('/api/commitment-types/:id', requireAuth, (req, res) => {
  const all = getCommitmentTypes();
  const exists = all.some(
    t => t.id === req.params.id && t.ownerEmail === req.user.email.toLowerCase()
  );
  if (!exists) return res.status(404).json({ error: 'Commitment type not found' });
  saveCommitmentTypes(all.filter(t => t.id !== req.params.id));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// LLM cost
// ---------------------------------------------------------------------------
// Local calendar date for an instant, so daily totals line up with the user's
// idea of a day rather than UTC's.
function localDay(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

app.get('/api/usage', requireAuth, (req, res) => {
  const email = req.user.email.toLowerCase();
  const domain = email.split('@')[1];
  // Org admins and platform admins can see the whole organization's spend;
  // everyone else sees their own.
  const canSeeOrg = isActiveAdmin(req) || administeredDomains(email).includes(domain);
  const scope = req.query.scope === 'org' && canSeeOrg ? 'org' : 'me';

  const timezone = ownerTimezone(email);
  const mine = usageEntries().filter(e =>
    scope === 'org' ? e.domain === domain : e.email === email
  );

  const dayCount = Math.min(365, Math.max(1, Number(req.query.days) || 90));
  const since = Date.now() - dayCount * 86400_000;
  const windowed = mine.filter(e => Date.parse(e.at) >= since);

  const dayMs = 24 * 60 * 60 * 1000;
  const last24h = windowed.filter(e => Date.parse(e.at) >= Date.now() - dayMs);

  const byDay = new Map();
  const byFeature = new Map();
  for (const entry of windowed) {
    const day = localDay(entry.at, timezone);
    const bucket = byDay.get(day) || { date: day, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    bucket.costUsd += entry.costUsd;
    bucket.calls += 1;
    bucket.inputTokens += entry.input + entry.cacheWrite + entry.cacheRead;
    bucket.outputTokens += entry.output;
    byDay.set(day, bucket);

    const feature = byFeature.get(entry.feature) || { feature: entry.feature, costUsd: 0, calls: 0 };
    feature.costUsd += entry.costUsd;
    feature.calls += 1;
    byFeature.set(entry.feature, feature);
  }

  const sum = list => list.reduce((total, e) => total + e.costUsd, 0);

  res.json({
    scope,
    canSeeOrg,
    timezone,
    days: dayCount,
    last24h: { costUsd: sum(last24h), calls: last24h.length },
    total: { costUsd: sum(windowed), calls: windowed.length },
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byFeature: [...byFeature.values()].sort((a, b) => b.costUsd - a.costUsd),
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Calby server running on port ${PORT}`);
});
