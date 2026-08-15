// Leave management: students and faculty apply for leave, faculty/admin
// approve or reject. Additive — new table only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'general',
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
`);

function uid() {
  return crypto.randomUUID();
}

function dayCount(fromDate, toDate) {
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}

function apply({ userId, userRole, leaveType, fromDate, toDate, reason }) {
  if (!userId || !fromDate || !toDate) {
    throw Object.assign(new Error('fromDate and toDate are required'), { status: 400 });
  }
  if (new Date(toDate) < new Date(fromDate)) {
    throw Object.assign(new Error('toDate cannot be before fromDate'), { status: 400 });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO leave_requests (id, user_id, user_role, leave_type, from_date, to_date, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, userRole, leaveType || 'general', fromDate, toDate, reason || null);
  return getById(id);
}

function getById(id) {
  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) || null;
}

function listForUser(userId) {
  return db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function listPending() {
  return db.prepare("SELECT * FROM leave_requests WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function listAll({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM leave_requests WHERE status = ? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all();
}

function review(id, { status, reviewedBy, reviewNote }) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Leave request not found'), { status: 404 });
  if (row.status !== 'pending') throw Object.assign(new Error('This request has already been reviewed'), { status: 409 });
  if (!['approved', 'rejected'].includes(status)) throw Object.assign(new Error('status must be approved or rejected'), { status: 400 });
  db.prepare(
    `UPDATE leave_requests SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(status, reviewedBy || null, reviewNote || null, id);
  return getById(id);
}

function cancel(id, userId) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Leave request not found'), { status: 404 });
  if (row.user_id !== userId) throw Object.assign(new Error('Not authorized'), { status: 403 });
  if (row.status !== 'pending') throw Object.assign(new Error('Only pending requests can be cancelled'), { status: 409 });
  db.prepare(`UPDATE leave_requests SET status = 'cancelled' WHERE id = ?`).run(id);
  return getById(id);
}

module.exports = { apply, getById, listForUser, listPending, listAll, review, cancel, dayCount };
