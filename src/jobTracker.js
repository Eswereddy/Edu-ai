// Job Tracker: a student's personal record of jobs THEY applied to
// (possibly outside the placement cell's own listings), with a status
// flow Applied -> Interview -> Offer/Rejected. Distinct from
// placements.js (the placement cell's own postings + applications to
// those postings, which is untouched). Fully additive — own table.

const crypto = require('crypto');
const { db } = require('./db');

const STATUS_FLOW = ['applied', 'interview', 'offer', 'rejected', 'withdrawn'];

db.exec(`
CREATE TABLE IF NOT EXISTS job_tracker_entries (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  job_url TEXT,
  status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','interview','offer','rejected','withdrawn')),
  notes TEXT,
  applied_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_tracker_student ON job_tracker_entries(student_id);

CREATE TABLE IF NOT EXISTS job_tracker_status_history (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES job_tracker_entries(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() {
  return crypto.randomUUID();
}

function addEntry(studentId, { company, roleTitle, jobUrl, notes, appliedDate }) {
  if (!company || !roleTitle) throw Object.assign(new Error('company and roleTitle are required'), { status: 400 });
  const id = uid();
  const date = appliedDate || new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO job_tracker_entries (id, student_id, company, role_title, job_url, notes, applied_date) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, company, roleTitle, jobUrl || null, notes || null, date);
  db.prepare('INSERT INTO job_tracker_status_history (id, entry_id, status) VALUES (?, ?, ?)').run(uid(), id, 'applied');
  return getEntry(studentId, id);
}

function getEntry(studentId, id) {
  const row = db.prepare('SELECT * FROM job_tracker_entries WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  const history = db.prepare('SELECT status, changed_at FROM job_tracker_status_history WHERE entry_id = ? ORDER BY changed_at ASC').all(id);
  return { ...row, history };
}

function listEntries(studentId, { status } = {}) {
  const rows = status
    ? db.prepare('SELECT id FROM job_tracker_entries WHERE student_id = ? AND status = ? ORDER BY updated_at DESC').all(studentId, status)
    : db.prepare('SELECT id FROM job_tracker_entries WHERE student_id = ? ORDER BY updated_at DESC').all(studentId);
  return rows.map((r) => getEntry(studentId, r.id));
}

function updateStatus(studentId, id, status) {
  if (!STATUS_FLOW.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
  const row = db.prepare('SELECT id FROM job_tracker_entries WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Entry not found'), { status: 404 });
  db.prepare(`UPDATE job_tracker_entries SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  db.prepare('INSERT INTO job_tracker_status_history (id, entry_id, status) VALUES (?, ?, ?)').run(uid(), id, status);
  return getEntry(studentId, id);
}

function deleteEntry(studentId, id) {
  const row = db.prepare('SELECT id FROM job_tracker_entries WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Entry not found'), { status: 404 });
  db.prepare('DELETE FROM job_tracker_entries WHERE id = ?').run(id);
  return { deleted: true };
}

function summary(studentId) {
  const rows = db.prepare('SELECT status, COUNT(*) as n FROM job_tracker_entries WHERE student_id = ? GROUP BY status').all(studentId);
  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

module.exports = { addEntry, getEntry, listEntries, updateStatus, deleteEntry, summary, STATUS_FLOW };
