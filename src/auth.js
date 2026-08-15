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

async function loginUser({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!user) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }
  const token = issueToken(user);
  return { token, user: publicUser(user) };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, linkedStudentId: u.linked_student_id || null };
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

module.exports = { registerUser, loginUser, attachUserIfPresent, requireAuth, requireRole, uid };
