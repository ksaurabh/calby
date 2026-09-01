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
  forgetAccessToken,
  generateState,
  updateEventTime,
} from './calendar.js';
import {
  generateSlots,
  interpretGuidance,
  slotIsAvailable,
} from './scheduling.js';

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

// The public part of a booking URL: 16 random characters, unguessable, and the
// only thing standing between a stranger and the page — so it comes from a CSPRNG.
function generatePublicSlug() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789ACDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// What a booking page may see. Never leaks the owner's guidance or email.
function publicEventType(eventType, ownerName) {
  return {
    name: eventType.name,
    description: eventType.description || '',
    ownerName,
    durationMinutes: eventType.rules.durationMinutes,
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
async function availabilityFor(eventType, { ignoreBookingId = null } = {}) {
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

  return { days: generateSlots({ rules: eventType.rules, busy, now, takenStarts }), token };
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
  const orgs = [...getOrgs()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  res.json(org);
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
  res.json(orgs[index]);
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

  const { rules, source } = await interpretGuidance(guidance, { timezone: req.body.timezone });
  const now = new Date().toISOString();
  const eventTypes = getEventTypes();
  const eventType = {
    id: generateId('evt'),
    ownerEmail: req.user.email.toLowerCase(),
    name,
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
    const interpreted = await interpretGuidance(guidance, { timezone: current.rules.timezone });
    rules = interpreted.rules;
    rulesSource = interpreted.source;
    rulesUpdatedAt = now;
  }

  eventTypes[index] = {
    ...current,
    name: req.body.name?.trim() || current.name,
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

// The owner's own preview of what visitors would see.
app.get('/api/event-types/:id/availability', requireAuth, async (req, res) => {
  const eventType = getEventTypes().find(
    e => e.id === req.params.id && e.ownerEmail === req.user.email.toLowerCase()
  );
  if (!eventType) return res.status(404).json({ error: 'Event type not found' });
  try {
    const { days } = await availabilityFor(eventType);
    res.json({ days, rules: eventType.rules });
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

  const owner = findUser(eventType.ownerEmail);
  try {
    const { days } = await availabilityFor(eventType);
    res.json({ eventType: publicEventType(eventType, owner?.name || 'the host'), days });
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

  try {
    // Re-check against the live calendar: the slot may have been taken between
    // the page loading and this submission.
    const { days, token } = await availabilityFor(eventType);
    if (!slotIsAvailable(new Date(start).toISOString(), days)) {
      return res.status(409).json({ error: 'That time was just taken. Please pick another slot.' });
    }

    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + eventType.rules.durationMinutes * 60_000);
    const owner = findUser(eventType.ownerEmail);

    const manageToken = generateManageToken();
    const event = await createEvent(token, {
      summary: `${eventType.name} — ${name}`,
      description: eventDescription({
        eventTypeName: eventType.name,
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
      eventTypeName: eventType.name,
      ownerEmail: eventType.ownerEmail,
      name,
      email,
      notes,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
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
        timezone: booking.timezone,
        name: booking.name,
        email: booking.email,
        eventTypeName: eventType.name,
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
    eventTypeName: booking.eventTypeName,
    ownerName,
    name: booking.name,
    email: booking.email,
    notes: booking.notes,
    start: booking.start,
    end: booking.end,
    timezone: booking.timezone,
    durationMinutes: eventType?.rules.durationMinutes ?? null,
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
    const { days } = await availabilityFor(eventType, { ignoreBookingId: booking.id });
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
    const { days, token } = await availabilityFor(eventType, { ignoreBookingId: booking.id });
    const startIso = new Date(start).toISOString();
    if (!slotIsAvailable(startIso, days)) {
      return res.status(409).json({ error: 'That time is no longer open. Please pick another slot.' });
    }

    const startDate = new Date(startIso);
    const endDate = new Date(startDate.getTime() + eventType.rules.durationMinutes * 60_000);

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
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Calby server running on port ${PORT}`);
});
