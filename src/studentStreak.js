// Study streak: a student "checks in" at most once per day (e.g. from the
// dashboard on open) and this tracks a running streak, similar to habit
// trackers. Purely additive — own table, own file. Awards a small
// gamification bonus at streak milestones by calling the existing
// gamification.awardPoints() function (does not modify that module).

const { db } = require('./db');
const crypto = require('crypto');
const gamification = require('./gamification');

db.exec(`
CREATE TABLE IF NOT EXISTS student_checkins (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  checkin_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_student_checkins_student ON student_checkins(student_id, checkin_date);
`);

function uid() {
  return crypto.randomUUID();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const MILESTONES = [3, 7, 14, 30, 60, 100];

function checkIn(studentId) {
  const today = todayStr();
  const already = db.prepare('SELECT id FROM student_checkins WHERE student_id = ? AND checkin_date = ?').get(studentId, today);
  if (!already) {
    db.prepare('INSERT INTO student_checkins (id, student_id, checkin_date) VALUES (?, ?, ?)').run(uid(), studentId, today);
  }
  const status = getStreak(studentId);
  if (!already && MILESTONES.includes(status.currentStreak)) {
    gamification.awardPoints(studentId, status.currentStreak, `Study streak milestone: ${status.currentStreak} days`);
  }
  return { ...status, checkedInToday: true, alreadyCheckedIn: Boolean(already) };
}

function getStreak(studentId) {
  const dates = db
    .prepare('SELECT checkin_date FROM student_checkins WHERE student_id = ? ORDER BY checkin_date DESC')
    .all(studentId)
    .map((r) => r.checkin_date);

  if (!dates.length) {
    return { currentStreak: 0, longestStreak: 0, totalCheckins: 0, checkedInToday: false, lastCheckin: null };
  }

  const today = todayStr();
  const set = new Set(dates);

  // Current streak: walk back from today (or yesterday, if today isn't
  // checked in yet, so a missed "today" doesn't zero out an active streak
  // until the day is actually over).
  let cursor = set.has(today) ? today : yesterdayStr(today);
  let currentStreak = 0;
  while (set.has(cursor)) {
    currentStreak += 1;
    cursor = yesterdayStr(cursor);
  }

  // Longest streak across all history.
  const sortedAsc = [...dates].sort();
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const d of sortedAsc) {
    if (prev && yesterdayStr(d) === prev) {
      run += 1;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prev = d;
  }

  return {
    currentStreak,
    longestStreak,
    totalCheckins: dates.length,
    checkedInToday: set.has(today),
    lastCheckin: dates[0],
  };
}

module.exports = { checkIn, getStreak };
