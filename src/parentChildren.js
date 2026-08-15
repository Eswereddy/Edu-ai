// Parent <-> child link requests. The existing `users.linked_student_id`
// column (see auth.js/db.js — both unchanged) already gives a parent
// account read access to one child via a self-declared field set at
// registration. This module adds a second, additive path on top of
// that: a parent can request to be linked to one or more children by
// student ID, and a faculty/admin member reviews and approves it before
// access is granted — giving real multi-child support (a family with
// two kids in the same school) plus a verification step the original
// single-field approach didn't have. Nothing about `linked_student_id`
// or the routes that already check it is touched; this is purely a new
// table and a new, additional way to resolve "which students can this
// parent see".

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS parent_child_links (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  note TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE(parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_child_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_student ON parent_child_links(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_status ON parent_child_links(status);
`);

function uid() {
  return crypto.randomUUID();
}

function requestLink({ parentId, studentId, note }) {
  if (!parentId || !studentId) {
    const err = new Error('studentId is required');
    err.status = 400;
    throw err;
  }
  const student = db.prepare("SELECT id, name, email FROM users WHERE id = ? AND role = 'student'").get(studentId);
  if (!student) {
    const err = new Error('No student account found with that ID');
    err.status = 404;
    throw err;
  }
  const existing = db.prepare('SELECT * FROM parent_child_links WHERE parent_id = ? AND student_id = ?').get(parentId, studentId);
  if (existing) return existing;
  const id = uid();
  db.prepare(
    `INSERT INTO parent_child_links (id, parent_id, student_id, note) VALUES (?, ?, ?, ?)`
  ).run(id, parentId, studentId, note || null);
  return getById(id);
}

function getById(id) {
  return db.prepare('SELECT * FROM parent_child_links WHERE id = ?').get(id) || null;
}

function listForParent(parentId, { status } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM parent_child_links WHERE parent_id = ? AND status = ? ORDER BY created_at DESC').all(parentId, status);
  }
  return db.prepare('SELECT * FROM parent_child_links WHERE parent_id = ? ORDER BY created_at DESC').all(parentId);
}

function listPending() {
  return db.prepare("SELECT * FROM parent_child_links WHERE status = 'pending' ORDER BY created_at ASC").all();
}

function review(id, { status, reviewedBy, reviewNote }) {
  const link = getById(id);
  if (!link) {
    const err = new Error('Link request not found');
    err.status = 404;
    throw err;
  }
  if (!['approved', 'rejected'].includes(status)) {
    const err = new Error("status must be 'approved' or 'rejected'");
    err.status = 400;
    throw err;
  }
  db.prepare(
    `UPDATE parent_child_links SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(status, reviewedBy || null, reviewNote || null, id);
  return getById(id);
}

function removeLink(id, parentId) {
  const link = getById(id);
  if (!link || link.parent_id !== parentId) return false;
  db.prepare('DELETE FROM parent_child_links WHERE id = ?').run(id);
  return true;
}

// Resolves the full set of children a parent can see: the legacy
// single `linked_student_id` (if the account has one) unioned with any
// approved parent_child_links rows. This is the one function the parent
// dashboard/notes routes should call to authorize access — it never
// grants access based on a pending or rejected request.
function resolveChildrenIds(parentUser) {
  const ids = new Set();
  if (parentUser.linkedStudentId) ids.add(parentUser.linkedStudentId);
  for (const row of listForParent(parentUser.id, { status: 'approved' })) {
    ids.add(row.student_id);
  }
  return [...ids];
}

module.exports = { requestLink, getById, listForParent, listPending, review, removeLink, resolveChildrenIds };
