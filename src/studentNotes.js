// Student notes & bookmarks: quick personal notes a student can attach to
// any resource in the platform (an assignment, a quiz, a library book, a
// forum thread, a knowledge-base entry) or just a freeform standalone
// note. Purely additive — own table, own file, read/write scoped to the
// owning student only.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS student_notes (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  subject TEXT,
  ref_type TEXT,
  ref_id TEXT,
  is_bookmarked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_student_notes_student ON student_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_student_notes_ref ON student_notes(ref_type, ref_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createNote({ studentId, title, body, subject, refType, refId, isBookmarked }) {
  if (!studentId || !body || !String(body).trim()) {
    const err = new Error('body is required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO student_notes (id, student_id, title, body, subject, ref_type, ref_id, is_bookmarked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, title || null, String(body).trim(), subject || null, refType || null, refId || null, isBookmarked ? 1 : 0);
  return getNote(id, studentId);
}

function getNote(id, studentId) {
  return db.prepare('SELECT * FROM student_notes WHERE id = ? AND student_id = ?').get(id, studentId) || null;
}

function listNotes(studentId, { refType, subject, bookmarkedOnly } = {}) {
  let sql = 'SELECT * FROM student_notes WHERE student_id = ?';
  const params = [studentId];
  if (refType) {
    sql += ' AND ref_type = ?';
    params.push(refType);
  }
  if (subject) {
    sql += ' AND subject = ?';
    params.push(subject);
  }
  if (bookmarkedOnly) {
    sql += ' AND is_bookmarked = 1';
  }
  sql += ' ORDER BY updated_at DESC';
  return db.prepare(sql).all(...params);
}

function updateNote(id, studentId, patch) {
  const note = getNote(id, studentId);
  if (!note) {
    const err = new Error('Note not found');
    err.status = 404;
    throw err;
  }
  const next = {
    title: patch.title !== undefined ? patch.title : note.title,
    body: patch.body != null ? String(patch.body).trim() : note.body,
    subject: patch.subject !== undefined ? patch.subject : note.subject,
    is_bookmarked: patch.isBookmarked !== undefined ? (patch.isBookmarked ? 1 : 0) : note.is_bookmarked,
  };
  db.prepare(
    `UPDATE student_notes SET title = ?, body = ?, subject = ?, is_bookmarked = ?, updated_at = datetime('now')
     WHERE id = ? AND student_id = ?`
  ).run(next.title, next.body, next.subject, next.is_bookmarked, id, studentId);
  return getNote(id, studentId);
}

function deleteNote(id, studentId) {
  const note = getNote(id, studentId);
  if (!note) return false;
  db.prepare('DELETE FROM student_notes WHERE id = ? AND student_id = ?').run(id, studentId);
  return true;
}

module.exports = { createNote, getNote, listNotes, updateNote, deleteNote };
