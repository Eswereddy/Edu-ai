// Backlog Manager: a student's own list of pending/failed subjects
// (arrears) to clear, with a status flow. Fully additive — own table.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS student_backlogs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  semester_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','attempted','cleared')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backlogs_student ON student_backlogs(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addBacklog(studentId, { subjectName, semesterName, notes }) {
  if (!subjectName) throw Object.assign(new Error('subjectName is required'), { status: 400 });
  const id = uid();
  db.prepare(
    `INSERT INTO student_backlogs (id, student_id, subject_name, semester_name, notes) VALUES (?, ?, ?, ?, ?)`
  ).run(id, studentId, subjectName, semesterName || null, notes || null);
  return db.prepare('SELECT * FROM student_backlogs WHERE id = ?').get(id);
}

function listBacklogs(studentId) {
  return db.prepare('SELECT * FROM student_backlogs WHERE student_id = ? ORDER BY status ASC, created_at DESC').all(studentId);
}

function updateBacklog(studentId, id, { status, notes, incrementAttempt }) {
  const row = db.prepare('SELECT * FROM student_backlogs WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Backlog entry not found'), { status: 404 });
  const nextStatus = ['pending', 'attempted', 'cleared'].includes(status) ? status : row.status;
  const nextAttempts = incrementAttempt ? row.attempt_count + 1 : row.attempt_count;
  db.prepare(
    `UPDATE student_backlogs SET status = ?, attempt_count = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`
  ).run(nextStatus, nextAttempts, notes != null ? notes : null, id);
  return db.prepare('SELECT * FROM student_backlogs WHERE id = ?').get(id);
}

function clearBacklog(studentId, id) {
  return updateBacklog(studentId, id, { status: 'cleared' });
}

function deleteBacklog(studentId, id) {
  const row = db.prepare('SELECT id FROM student_backlogs WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Backlog entry not found'), { status: 404 });
  db.prepare('DELETE FROM student_backlogs WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { addBacklog, listBacklogs, updateBacklog, clearBacklog, deleteBacklog };
