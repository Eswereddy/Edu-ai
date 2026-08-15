// Class timetable: weekly period grid per class-section, assignable to a
// faculty member and room. Additive module — own table, own file.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS timetable_slots (
  id TEXT PRIMARY KEY,
  class_section TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  period_no INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  subject TEXT NOT NULL,
  faculty_id TEXT,
  room TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timetable_section ON timetable_slots(class_section, day_of_week);
CREATE INDEX IF NOT EXISTS idx_timetable_faculty ON timetable_slots(faculty_id);
`);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function uid() {
  return crypto.randomUUID();
}

function createSlot({ classSection, dayOfWeek, periodNo, startTime, endTime, subject, facultyId, room, createdBy }) {
  if (!classSection || dayOfWeek == null || periodNo == null || !subject) {
    const err = new Error('classSection, dayOfWeek, periodNo, subject are required');
    err.status = 400;
    throw err;
  }
  const day = Number(dayOfWeek);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    const err = new Error('dayOfWeek must be an integer 0 (Sun) - 6 (Sat)');
    err.status = 400;
    throw err;
  }
  // Prevent double-booking the same faculty member at the same day/period.
  if (facultyId) {
    const clash = db
      .prepare('SELECT id, class_section FROM timetable_slots WHERE faculty_id = ? AND day_of_week = ? AND period_no = ?')
      .get(facultyId, day, Number(periodNo));
    if (clash) {
      const err = new Error(`Faculty already scheduled for ${DAY_NAMES[day]} period ${periodNo} (section ${clash.class_section})`);
      err.status = 409;
      throw err;
    }
  }
  const id = uid();
  db.prepare(
    `INSERT INTO timetable_slots (id, class_section, day_of_week, period_no, start_time, end_time, subject, faculty_id, room, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, classSection, day, Number(periodNo), startTime || null, endTime || null, subject, facultyId || null, room || null, createdBy || null);
  return getSlot(id);
}

function getSlot(id) {
  return db.prepare('SELECT * FROM timetable_slots WHERE id = ?').get(id) || null;
}

function updateSlot(id, patch) {
  const existing = getSlot(id);
  if (!existing) {
    const err = new Error('Timetable slot not found');
    err.status = 404;
    throw err;
  }
  const fields = ['startTime:start_time', 'endTime:end_time', 'subject:subject', 'facultyId:faculty_id', 'room:room'];
  const sets = [];
  const params = [];
  for (const spec of fields) {
    const [jsKey, col] = spec.split(':');
    if (Object.prototype.hasOwnProperty.call(patch, jsKey)) {
      sets.push(`${col} = ?`);
      params.push(patch[jsKey]);
    }
  }
  if (!sets.length) return existing;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE timetable_slots SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getSlot(id);
}

function deleteSlot(id) {
  const info = db.prepare('DELETE FROM timetable_slots WHERE id = ?').run(id);
  return info.changes > 0;
}

function listForSection(classSection) {
  const rows = db
    .prepare('SELECT * FROM timetable_slots WHERE class_section = ? ORDER BY day_of_week, period_no')
    .all(classSection);
  return groupByDay(rows);
}

function listForFaculty(facultyId) {
  const rows = db
    .prepare('SELECT * FROM timetable_slots WHERE faculty_id = ? ORDER BY day_of_week, period_no')
    .all(facultyId);
  return groupByDay(rows);
}

function groupByDay(rows) {
  const byDay = {};
  for (let d = 0; d < 7; d++) byDay[DAY_NAMES[d]] = [];
  for (const r of rows) byDay[DAY_NAMES[r.day_of_week]].push(r);
  return byDay;
}

function listSections() {
  return db.prepare('SELECT DISTINCT class_section FROM timetable_slots ORDER BY class_section').all().map((r) => r.class_section);
}

module.exports = { createSlot, getSlot, updateSlot, deleteSlot, listForSection, listForFaculty, listSections, DAY_NAMES };
