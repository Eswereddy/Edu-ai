// Meetings: student/parent requests a meeting with a faculty/admin member;
// the recipient can suggest an alternate slot, or accept/decline.
// Distinct from leave.js (leave applications, untouched). Fully
// additive — own table, own file.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS meeting_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  requested_time TEXT NOT NULL,
  suggested_date TEXT,
  suggested_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','slot_suggested','confirmed','cancelled','declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meetings_requester ON meeting_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_meetings_recipient ON meeting_requests(recipient_id);
`);

function uid() {
  return crypto.randomUUID();
}

function requestMeeting({ requesterId, recipientId, topic, requestedDate, requestedTime }) {
  if (!recipientId || !topic || !requestedDate || !requestedTime) {
    throw Object.assign(new Error('recipientId, topic, requestedDate and requestedTime are required'), { status: 400 });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO meeting_requests (id, requester_id, recipient_id, topic, requested_date, requested_time) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, requesterId, recipientId, topic, requestedDate, requestedTime);
  return getById(id);
}

function getById(id) {
  return db.prepare('SELECT * FROM meeting_requests WHERE id = ?').get(id) || null;
}

function listForUser(userId) {
  return db
    .prepare('SELECT * FROM meeting_requests WHERE requester_id = ? OR recipient_id = ? ORDER BY created_at DESC')
    .all(userId, userId);
}

// Recipient proposes a different date/time.
function suggestSlot(id, recipientId, { date, time }) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Meeting request not found'), { status: 404 });
  if (row.recipient_id !== recipientId) throw Object.assign(new Error('Not authorized'), { status: 403 });
  if (!date || !time) throw Object.assign(new Error('date and time are required'), { status: 400 });
  db.prepare(
    `UPDATE meeting_requests SET status = 'slot_suggested', suggested_date = ?, suggested_time = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(date, time, id);
  return getById(id);
}

function confirm(id, userId) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Meeting request not found'), { status: 404 });
  if (row.requester_id !== userId && row.recipient_id !== userId) throw Object.assign(new Error('Not authorized'), { status: 403 });
  db.prepare(`UPDATE meeting_requests SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getById(id);
}

function decline(id, userId) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Meeting request not found'), { status: 404 });
  if (row.requester_id !== userId && row.recipient_id !== userId) throw Object.assign(new Error('Not authorized'), { status: 403 });
  db.prepare(`UPDATE meeting_requests SET status = 'declined', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getById(id);
}

function cancel(id, userId) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Meeting request not found'), { status: 404 });
  if (row.requester_id !== userId) throw Object.assign(new Error('Only the requester can cancel'), { status: 403 });
  if (row.status === 'confirmed') throw Object.assign(new Error('Cannot cancel a confirmed meeting — decline instead'), { status: 409 });
  db.prepare(`UPDATE meeting_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getById(id);
}

module.exports = { requestMeeting, getById, listForUser, suggestSlot, confirm, decline, cancel };
