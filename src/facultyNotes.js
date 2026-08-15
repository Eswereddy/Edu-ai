// Faculty private notes: lesson-prep notes, remarks on a particular
// student, or general notes tied to a class-section/subject. Purely
// additive — own table, own file, visible only to the faculty member who
// wrote them (this is not a shared/forum feature — see forum.js for
// that). A note can optionally reference a student (ref_type='student',
// ref_id=studentId) so a faculty member can jot something down while
// reviewing a submission or attendance, without that student ever seeing
// it.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS faculty_notes (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  class_section TEXT,
  subject TEXT,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faculty_notes_faculty ON faculty_notes(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_notes_ref ON faculty_notes(ref_type, ref_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createNote({ facultyId, title, body, classSection, subject, refType, refId }) {
  if (!facultyId || !body || !String(body).trim()) {
    const err = new Error('body is required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO faculty_notes (id, faculty_id, title, body, class_section, subject, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, facultyId, title || null, String(body).trim(), classSection || null, subject || null, refType || null, refId || null);
  return getNote(id, facultyId);
}

function getNote(id, facultyId) {
  return db.prepare('SELECT * FROM faculty_notes WHERE id = ? AND faculty_id = ?').get(id, facultyId) || null;
}

function listNotes(facultyId, { refType, refId, classSection, subject } = {}) {
  let sql = 'SELECT * FROM faculty_notes WHERE faculty_id = ?';
  const params = [facultyId];
  if (refType) {
    sql += ' AND ref_type = ?';
    params.push(refType);
  }
  if (refId) {
    sql += ' AND ref_id = ?';
    params.push(refId);
  }
  if (classSection) {
    sql += ' AND class_section = ?';
    params.push(classSection);
  }
  if (subject) {
    sql += ' AND subject = ?';
    params.push(subject);
  }
  sql += ' ORDER BY updated_at DESC';
  return db.prepare(sql).all(...params);
}

function updateNote(id, facultyId, patch) {
  const note = getNote(id, facultyId);
  if (!note) {
    const err = new Error('Note not found');
    err.status = 404;
    throw err;
  }
  const next = {
    title: patch.title !== undefined ? patch.title : note.title,
    body: patch.body != null ? String(patch.body).trim() : note.body,
    class_section: patch.classSection !== undefined ? patch.classSection : note.class_section,
    subject: patch.subject !== undefined ? patch.subject : note.subject,
  };
  db.prepare(
    `UPDATE faculty_notes SET title = ?, body = ?, class_section = ?, subject = ?, updated_at = datetime('now')
     WHERE id = ? AND faculty_id = ?`
  ).run(next.title, next.body, next.class_section, next.subject, id, facultyId);
  return getNote(id, facultyId);
}

function deleteNote(id, facultyId) {
  const note = getNote(id, facultyId);
  if (!note) return false;
  db.prepare('DELETE FROM faculty_notes WHERE id = ? AND faculty_id = ?').run(id, facultyId);
  return true;
}

module.exports = { createNote, getNote, listNotes, updateNote, deleteNote };
