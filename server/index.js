import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', 1); // Trust nginx reverse proxy for secure cookies
const PORT = process.env.PORT || 3002;

const DOMAINS_FILE = join(__dirname, 'allowed-domains.json');
const SUPER_ADMINS_FILE = join(__dirname, 'super-admins.json');
const USERS_FILE = join(__dirname, 'users.json');
const ORGS_FILE = join(__dirname, 'orgs.json');

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

function isAdmin(email) {
  const role = effectiveRole(email);
  return role === 'admin' || role === 'super_admin';
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

// A URL-safe slug derived from the org name, e.g. "Acme Corp." -> "acme-corp".
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

  const role = effectiveRole(req.user.email);
  res.json({
    authenticated: true,
    allowed,
    user: {
      ...req.user,
      name: storedUser?.name || req.user.name,
      role,
    },
    role,
    isAdmin: role === 'admin' || role === 'super_admin',
    isSuperAdmin: role === 'super_admin',
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
  if (!isAdmin(req.user.email)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!isSuperAdmin(req.user.email)) return res.status(403).json({ error: 'Super admin access required' });
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
  if (orgs[index].createdBy !== req.user.email && !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Only the creator or an admin can edit this organization' });
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
  if (org.createdBy !== req.user.email && !isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Only the creator or an admin can delete this organization' });
  }
  saveOrgs(orgs.filter(o => o.id !== org.id));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------
app.get('/api/users', requireAdmin, (req, res) => {
  const users = getUsers().map(u => ({ ...u, role: effectiveRole(u.email) }));
  res.json({ users });
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
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Calby server running on port ${PORT}`);
});
