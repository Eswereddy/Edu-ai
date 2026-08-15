// Student personal planner / to-do list. Purely additive — own table,
// own file, touches nothing that exists already. This is separate from
// faculty-assigned `assignments`: these are self-created reminders a
// student sets for themselves (e.g. "revise DBMS chapter 4", "buy graph
// sheet"), optionally linked to a subject and/or a due date.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS student_tasks (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  notes TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_student_tasks_student ON student_tasks(student_id);
CREATE INDEX IF NOT EXISTS idx_student_tasks_due ON student_tasks(due_date);
`);

function uid() {
  return crypto.randomUUID();
}

function createTask({ studentId, title, subject, notes, dueDate, priority }) {
  if (!studentId || !title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  const cleanPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
  const id = uid();
  db.prepare(
    `INSERT INTO student_tasks (id, student_id, title, subject, notes, due_date, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, String(title).trim(), subject || null, notes || null, dueDate || null, cleanPriority);
  return getTask(id, studentId);
}

function getTask(id, studentId) {
  return db.prepare('SELECT * FROM student_tasks WHERE id = ? AND student_id = ?').get(id, studentId) || null;
}

function listTasks(studentId, { includeDone = true } = {}) {
  const rows = includeDone
    ? db.prepare('SELECT * FROM student_tasks WHERE student_id = ? ORDER BY is_done ASC, due_date IS NULL, due_date ASC, created_at DESC').all(studentId)
    : db.prepare("SELECT * FROM student_tasks WHERE student_id = ? AND is_done = 0 ORDER BY due_date IS NULL, due_date ASC, created_at DESC").all(studentId);
  return rows;
}

function updateTask(id, studentId, patch) {
  const task = getTask(id, studentId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  const next = {
    title: patch.title != null ? String(patch.title).trim() : task.title,
    subject: patch.subject !== undefined ? patch.subject : task.subject,
    notes: patch.notes !== undefined ? patch.notes : task.notes,
    due_date: patch.dueDate !== undefined ? patch.dueDate : task.due_date,
    priority: ['low', 'medium', 'high'].includes(patch.priority) ? patch.priority : task.priority,
  };
  db.prepare(
    `UPDATE student_tasks SET title = ?, subject = ?, notes = ?, due_date = ?, priority = ? WHERE id = ? AND student_id = ?`
  ).run(next.title, next.subject, next.notes, next.due_date, next.priority, id, studentId);
  return getTask(id, studentId);
}

function toggleDone(id, studentId, isDone) {
  const task = getTask(id, studentId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  const done = isDone == null ? task.is_done === 0 : Boolean(isDone);
  db.prepare(
    `UPDATE student_tasks SET is_done = ?, completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ? AND student_id = ?`
  ).run(done ? 1 : 0, done ? 1 : 0, id, studentId);
  return getTask(id, studentId);
}

function deleteTask(id, studentId) {
  const task = getTask(id, studentId);
  if (!task) return false;
  db.prepare('DELETE FROM student_tasks WHERE id = ? AND student_id = ?').run(id, studentId);
  return true;
}

function taskStats(studentId) {
  const rows = listTasks(studentId);
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: rows.length,
    done: rows.filter((r) => r.is_done).length,
    pending: rows.filter((r) => !r.is_done).length,
    overdue: rows.filter((r) => !r.is_done && r.due_date && r.due_date < today).length,
  };
}

module.exports = { createTask, getTask, listTasks, updateTask, toggleDone, deleteTask, taskStats };
