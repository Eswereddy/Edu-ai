// Real authentication: bcrypt-hashed passwords + JWT sessions.
// Additive module — the old AI_API_TOKEN bearer check in server.js still
// works exactly as before for the /api/ai/instant endpoint; this adds a
// proper per-user account system on top for the new data + memory routes.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const VALID_ROLES = new Set(['student', 'faculty', 'parent', 'admin', 'ai-admin']);

function uid() {
  return crypto.randomUUID();
}

async function registerUser({ name, email, password, role, linkedStudentId }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = VALID_ROLES.has(role) ? role : 'student';

  if (!name || !cleanEmail || !password) {
    const err = new Error('name, email, and password are required');
    err.status = 400;
    throw err;
  }
  if (String(password).length < 6) {
    const err = new Error('Password must be at least 6 characters');
    err.status = 400;
    throw err;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    const err = new Error('An account with this email already exists');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const id = uid();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, linked_student_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, String(name).trim(), cleanEmail, passwordHash, cleanRole, linkedStudentId || null);

  return publicUser({ id, name, email: cleanEmail, role: cleanRole, linked_student_id: linkedStudentId || null });
}

function logLoginAttempt({ userId, emailAttempted, method, success }) {
  try {
    db.prepare(
      'INSERT INTO login_audit (id, user_id, email_attempted, method, success) VALUES (?, ?, ?, ?, ?)'
    ).run(uid(), userId || null, emailAttempted || null, method, success ? 1 : 0);
  } catch (e) {
    console.warn('[auth] could not write login_audit row:', e.message);
  }
}

async function loginUser({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user) {
    logLoginAttempt({ userId: null, emailAttempted: cleanEmail, method: 'password', success: false });
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    logLoginAttempt({ userId: user.id, emailAttempted: cleanEmail, method: 'password', success: false });
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }
  logLoginAttempt({ userId: user.id, emailAttempted: cleanEmail, method: 'password', success: true });
  const token = issueToken(user);
  return { token, user: publicUser(user) };
}

// Real OAuth account resolution: link-by-provider-id first, fall back to
// linking by verified email (so a user who registered with email/password
// and later clicks "Continue with Google" using the same address gets
// merged into the same account instead of a duplicate), otherwise create
// a brand-new account. OAuth-only accounts get a random, never-typeable
// bcrypt hash stored in password_hash so the existing NOT NULL column and
// email/password login path are both untouched.
async function findOrCreateOAuthUser({ provider, providerId, email, name, avatarUrl, role }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = VALID_ROLES.has(role) ? role : 'student';

  let user = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?').get(provider, providerId);
  let isNewUser = false;

  if (!user && cleanEmail) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (user) {
      db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?').run(
        provider,
        providerId,
        avatarUrl || null,
        user.id
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
  }

  if (!user) {
    if (!cleanEmail) {
      const err = new Error(`${provider} did not share a verified email address`);
      err.status = 400;
      throw err;
    }
    const id = uid();
    const unusablePassword = crypto.randomBytes(24).toString('hex'); // never revealed, never used to log in
    const passwordHash = await bcrypt.hash(unusablePassword, 10);
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, oauth_provider, oauth_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, String(name || cleanEmail.split('@')[0]).trim(), cleanEmail, passwordHash, cleanRole, provider, providerId, avatarUrl || null);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    isNewUser = true;
  }

  const token = issueToken(user);
  logLoginAttempt({ userId: user.id, emailAttempted: cleanEmail, method: provider, success: true });
  return { token, user: publicUser(user), isNewUser };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    linkedStudentId: u.linked_student_id || null,
    avatarUrl: u.avatar_url || null,
    oauthProvider: u.oauth_provider || null,
  };
}

// Attaches req.user if a valid Bearer JWT is present; does NOT reject
// otherwise, so existing anonymous flows keep working unchanged.
function attachUserIfPresent(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.sub, role: payload.role, name: payload.name, email: payload.email };
    } catch (_e) {
      // invalid/expired token: proceed unauthenticated rather than hard-fail,
      // since this endpoint historically accepted the AI_API_TOKEN instead.
    }
  }
  next();
}

// Hard requirement for the new data routes.
function requireAuth(req, res, next) {
  attachUserIfPresent(req, res, () => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Login required' });
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { registerUser, loginUser, findOrCreateOAuthUser, attachUserIfPresent, requireAuth, requireRole, uid };
