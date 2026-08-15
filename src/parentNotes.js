// Parent personal reminders: fee due dates, PTM dates, things a parent
// wants to remember about a specific child (or general). Purely
// additive — own table, own file, mirrors studentTasks.js/
// facultyTasks.js in shape but kept as its own module/table
// (parent_reminders) so this pass stays isolated to the parent portal.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS parent_reminders (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  student_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_parent_reminders_parent ON parent_reminders(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_reminders_due ON parent_reminders(due_date);
`);

function uid() {
  return crypto.randomUUID();
}

function createReminder({ parentId, studentId, title, notes, dueDate }) {
  if (!parentId || !title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO parent_reminders (id, parent_id, student_id, title, notes, due_date) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, parentId, studentId || null, String(title).trim(), notes || null, dueDate || null);
  return getReminder(id, parentId);
}

function getReminder(id, parentId) {
  return db.prepare('SELECT * FROM parent_reminders WHERE id = ? AND parent_id = ?').get(id, parentId) || null;
}

function listReminders(parentId, { includeDone = true } = {}) {
  return includeDone
    ? db.prepare('SELECT * FROM parent_reminders WHERE parent_id = ? ORDER BY is_done ASC, due_date IS NULL, due_date ASC, created_at DESC').all(parentId)
    : db.prepare("SELECT * FROM parent_reminders WHERE parent_id = ? AND is_done = 0 ORDER BY due_date IS NULL, due_date ASC, created_at DESC").all(parentId);
}

function toggleDone(id, parentId, isDone) {
  const reminder = getReminder(id, parentId);
  if (!reminder) {
    const err = new Error('Reminder not found');
    err.status = 404;
    throw err;
  }
  const done = isDone == null ? reminder.is_done === 0 : Boolean(isDone);
  db.prepare(
    `UPDATE parent_reminders SET is_done = ?, completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ? AND parent_id = ?`
  ).run(done ? 1 : 0, done ? 1 : 0, id, parentId);
  return getReminder(id, parentId);
}

function deleteReminder(id, parentId) {
  const reminder = getReminder(id, parentId);
  if (!reminder) return false;
  db.prepare('DELETE FROM parent_reminders WHERE id = ? AND parent_id = ?').run(id, parentId);
  return true;
}

module.exports = { createReminder, getReminder, listReminders, toggleDone, deleteReminder };
