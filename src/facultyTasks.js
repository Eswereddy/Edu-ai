// Faculty personal planner / to-do list. Purely additive — own table,
// own file, mirrors the shape of studentTasks.js but is intentionally a
// separate module/table (faculty_tasks, not student_tasks) so this pass
// stays scoped to the faculty portal without touching the student-portal
// files added previously. Typical uses: "grade Section-A lab reports",
// "prep unit 3 slides", "submit internal marks by Friday".

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS faculty_tasks (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  title TEXT NOT NULL,
  class_section TEXT,
  subject TEXT,
  notes TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_faculty_tasks_faculty ON faculty_tasks(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_tasks_due ON faculty_tasks(due_date);
`);

function uid() {
  return crypto.randomUUID();
}

function createTask({ facultyId, title, classSection, subject, notes, dueDate, priority }) {
  if (!facultyId || !title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  const cleanPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
  const id = uid();
  db.prepare(
    `INSERT INTO faculty_tasks (id, faculty_id, title, class_section, subject, notes, due_date, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, facultyId, String(title).trim(), classSection || null, subject || null, notes || null, dueDate || null, cleanPriority);
  return getTask(id, facultyId);
}

function getTask(id, facultyId) {
  return db.prepare('SELECT * FROM faculty_tasks WHERE id = ? AND faculty_id = ?').get(id, facultyId) || null;
}

function listTasks(facultyId, { includeDone = true } = {}) {
  return includeDone
    ? db.prepare('SELECT * FROM faculty_tasks WHERE faculty_id = ? ORDER BY is_done ASC, due_date IS NULL, due_date ASC, created_at DESC').all(facultyId)
    : db.prepare("SELECT * FROM faculty_tasks WHERE faculty_id = ? AND is_done = 0 ORDER BY due_date IS NULL, due_date ASC, created_at DESC").all(facultyId);
}

function updateTask(id, facultyId, patch) {
  const task = getTask(id, facultyId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  const next = {
    title: patch.title != null ? String(patch.title).trim() : task.title,
    class_section: patch.classSection !== undefined ? patch.classSection : task.class_section,
    subject: patch.subject !== undefined ? patch.subject : task.subject,
    notes: patch.notes !== undefined ? patch.notes : task.notes,
    due_date: patch.dueDate !== undefined ? patch.dueDate : task.due_date,
    priority: ['low', 'medium', 'high'].includes(patch.priority) ? patch.priority : task.priority,
  };
  db.prepare(
    `UPDATE faculty_tasks SET title = ?, class_section = ?, subject = ?, notes = ?, due_date = ?, priority = ?
     WHERE id = ? AND faculty_id = ?`
  ).run(next.title, next.class_section, next.subject, next.notes, next.due_date, next.priority, id, facultyId);
  return getTask(id, facultyId);
}

function toggleDone(id, facultyId, isDone) {
  const task = getTask(id, facultyId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  const done = isDone == null ? task.is_done === 0 : Boolean(isDone);
  db.prepare(
    `UPDATE faculty_tasks SET is_done = ?, completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ? AND faculty_id = ?`
  ).run(done ? 1 : 0, done ? 1 : 0, id, facultyId);
  return getTask(id, facultyId);
}

function deleteTask(id, facultyId) {
  const task = getTask(id, facultyId);
  if (!task) return false;
  db.prepare('DELETE FROM faculty_tasks WHERE id = ? AND faculty_id = ?').run(id, facultyId);
  return true;
}

function taskStats(facultyId) {
  const rows = listTasks(facultyId);
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: rows.length,
    done: rows.filter((r) => r.is_done).length,
    pending: rows.filter((r) => !r.is_done).length,
    overdue: rows.filter((r) => !r.is_done && r.due_date && r.due_date < today).length,
  };
}

module.exports = { createTask, getTask, listTasks, updateTask, toggleDone, deleteTask, taskStats };
