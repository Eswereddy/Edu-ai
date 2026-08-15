// Multi-device sync for the student portal's local data.
//
// The student portal keeps a chunk of its state (job tracker entries,
// notes, goals, wellness check-ins, etc. — the `DATA.student` object in
// the frontend) only in the browser's IndexedDB/localStorage. That
// never left the device it was created on, so a student switching to
// a phone or a different laptop saw none of it. This module gives that
// blob a home on the server, keyed per-user, so any device can pull the
// latest copy and push its own changes back.
//
// Deliberately a generic opaque-JSON store (not modeled table-by-table)
// because the frontend's local schema evolves independently of this
// backend — mirroring it field-for-field would mean touching this file
// every time a student-portal-only field is added client-side. Real
// entities that already have first-class backend support (jobs,
// resumes, quizzes, etc.) are unaffected and keep using their own
// tables — this only covers what was previously device-local-only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS student_local_sync (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_from_device TEXT
);
`);

function uid() { return crypto.randomUUID(); }

function getSync(userId) {
  const row = db.prepare('SELECT * FROM student_local_sync WHERE user_id = ?').get(userId);
  if (!row) return null;
  let data;
  try { data = JSON.parse(row.data); } catch (_e) { data = null; }
  return { data, updatedAt: row.updated_at, updatedFromDevice: row.updated_from_device };
}

function putSync(userId, data, deviceLabel) {
  if (!userId) throw Object.assign(new Error('userId is required'), { status: 400 });
  const json = JSON.stringify(data ?? {});
  if (json.length > 2_000_000) throw Object.assign(new Error('Sync payload too large (max ~2MB)'), { status: 413 });
  const existing = db.prepare('SELECT user_id FROM student_local_sync WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`UPDATE student_local_sync SET data = ?, updated_at = datetime('now'), updated_from_device = ? WHERE user_id = ?`)
      .run(json, deviceLabel || null, userId);
  } else {
    db.prepare(`INSERT INTO student_local_sync (user_id, data, updated_from_device) VALUES (?,?,?)`)
      .run(userId, json, deviceLabel || null);
  }
  return getSync(userId);
}

function clearSync(userId) {
  db.prepare('DELETE FROM student_local_sync WHERE user_id = ?').run(userId);
  return { cleared: true };
}

module.exports = { getSync, putSync, clearSync, uid };
