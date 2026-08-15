// Goals & Wellness: personal goals with a progress bar, and a daily mood
// check-in for a mood chart. Streaks already exist (studentStreak.js,
// untouched) — this adds the two pieces that didn't: goals and mood.
// Fully additive — own tables, own file.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS student_goals (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target_value REAL NOT NULL DEFAULT 100,
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goals_student ON student_goals(student_id);

CREATE TABLE IF NOT EXISTS mood_checkins (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  mood_score INTEGER NOT NULL CHECK(mood_score BETWEEN 1 AND 5),
  note TEXT,
  checkin_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, checkin_date)
);
CREATE INDEX IF NOT EXISTS idx_mood_student ON mood_checkins(student_id, checkin_date);
`);

function uid() {
  return crypto.randomUUID();
}

// -------------------------------------------------------------- Goals
function addGoal(studentId, { title, targetValue, currentValue, unit }) {
  if (!title) throw Object.assign(new Error('title is required'), { status: 400 });
  const id = uid();
  db.prepare(
    `INSERT INTO student_goals (id, student_id, title, target_value, current_value, unit) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, title, targetValue != null ? Number(targetValue) : 100, currentValue != null ? Number(currentValue) : 0, unit || null);
  return getGoal(studentId, id);
}

function getGoal(studentId, id) {
  const row = db.prepare('SELECT * FROM student_goals WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  const progressPercent = row.target_value > 0 ? Math.min(100, Math.round((row.current_value / row.target_value) * 10000) / 100) : 0;
  return { ...row, progressPercent };
}

function listGoals(studentId) {
  return db.prepare('SELECT id FROM student_goals WHERE student_id = ? ORDER BY status ASC, created_at DESC').all(studentId)
    .map((r) => getGoal(studentId, r.id));
}

function updateGoal(studentId, id, { currentValue, status, title, targetValue }) {
  const row = db.prepare('SELECT * FROM student_goals WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Goal not found'), { status: 404 });
  const nextCurrent = currentValue != null ? Number(currentValue) : row.current_value;
  const nextTarget = targetValue != null ? Number(targetValue) : row.target_value;
  let nextStatus = ['active', 'completed', 'abandoned'].includes(status) ? status : row.status;
  if (nextStatus === 'active' && nextTarget > 0 && nextCurrent >= nextTarget) nextStatus = 'completed';
  db.prepare(
    `UPDATE student_goals SET title = COALESCE(?, title), target_value = ?, current_value = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(title || null, nextTarget, nextCurrent, nextStatus, id);
  return getGoal(studentId, id);
}

function deleteGoal(studentId, id) {
  const row = db.prepare('SELECT id FROM student_goals WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) throw Object.assign(new Error('Goal not found'), { status: 404 });
  db.prepare('DELETE FROM student_goals WHERE id = ?').run(id);
  return { deleted: true };
}

// ------------------------------------------------------------ Mood
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkInMood(studentId, { moodScore, note }) {
  const score = Math.max(1, Math.min(5, Math.round(Number(moodScore))));
  if (!score) throw Object.assign(new Error('moodScore (1-5) is required'), { status: 400 });
  const today = todayStr();
  const existing = db.prepare('SELECT id FROM mood_checkins WHERE student_id = ? AND checkin_date = ?').get(studentId, today);
  if (existing) {
    db.prepare('UPDATE mood_checkins SET mood_score = ?, note = ? WHERE id = ?').run(score, note || null, existing.id);
    return db.prepare('SELECT * FROM mood_checkins WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare('INSERT INTO mood_checkins (id, student_id, mood_score, note, checkin_date) VALUES (?, ?, ?, ?, ?)').run(id, studentId, score, note || null, today);
  return db.prepare('SELECT * FROM mood_checkins WHERE id = ?').get(id);
}

function moodHistory(studentId, days = 30) {
  const cap = Math.max(1, Math.min(365, Number(days) || 30));
  return db
    .prepare('SELECT checkin_date, mood_score, note FROM mood_checkins WHERE student_id = ? ORDER BY checkin_date DESC LIMIT ?')
    .all(studentId, cap)
    .reverse();
}

module.exports = { addGoal, listGoals, getGoal, updateGoal, deleteGoal, checkInMood, moodHistory };
