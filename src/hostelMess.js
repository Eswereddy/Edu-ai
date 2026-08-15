// Hostel Mess: weekly menu, meal attendance tracking, and hostel
// complaint management. Additive-only — new tables, own file, doesn't
// touch hostel.js (rooms/allocation) at all.
//
// NOTE on "RFID scanning": there's no physical card reader here — that's
// hardware. What this gives you is the software side an RFID reader
// would call into: a mark-attendance endpoint that's idempotent per
// student/date/meal (so a duplicate scan/tap can't double-count someone
// for a kitchen headcount), ready for a real reader to hit as a webhook
// later.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS mess_menu (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','snacks','dinner')),
  items TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(day_of_week, meal_type)
);

CREATE TABLE IF NOT EXISTS mess_attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  meal_date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','snacks','dinner')),
  marked_by TEXT,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, meal_date, meal_type)
);
CREATE INDEX IF NOT EXISTS idx_mess_att_date ON mess_attendance(meal_date, meal_type);
CREATE INDEX IF NOT EXISTS idx_mess_att_student ON mess_attendance(student_id);

CREATE TABLE IF NOT EXISTS hostel_complaints (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('room','mess','maintenance','other')),
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
  assigned_to TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_complaints_student ON hostel_complaints(student_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON hostel_complaints(status);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// -------------------------------------------------------------------- Menu

function upsertMenu({ dayOfWeek, mealType, items, updatedBy }) {
  const dow = Number(dayOfWeek);
  if (Number.isNaN(dow) || dow < 0 || dow > 6) throw fail('dayOfWeek must be 0 (Sunday) through 6 (Saturday)');
  if (!MEAL_TYPES.includes(mealType)) throw fail(`mealType must be one of ${MEAL_TYPES.join(', ')}`);
  if (!items || !String(items).trim()) throw fail('items is required');

  const existing = db.prepare('SELECT * FROM mess_menu WHERE day_of_week = ? AND meal_type = ?').get(dow, mealType);
  if (existing) {
    db.prepare(`UPDATE mess_menu SET items = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(items).trim(), updatedBy || null, existing.id);
    return db.prepare('SELECT * FROM mess_menu WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare('INSERT INTO mess_menu (id, day_of_week, meal_type, items, updated_by) VALUES (?,?,?,?,?)')
    .run(id, dow, mealType, String(items).trim(), updatedBy || null);
  return db.prepare('SELECT * FROM mess_menu WHERE id = ?').get(id);
}

function weeklyMenu() {
  const rows = db.prepare('SELECT * FROM mess_menu ORDER BY day_of_week').all();
  const byDay = {};
  for (let d = 0; d < 7; d += 1) byDay[DAY_NAMES[d]] = {};
  for (const row of rows) byDay[DAY_NAMES[row.day_of_week]][row.meal_type] = row.items;
  return byDay;
}

function menuForDay(dayOfWeek) {
  const dow = Number(dayOfWeek);
  const rows = db.prepare('SELECT * FROM mess_menu WHERE day_of_week = ?').all(dow);
  const out = {};
  for (const row of rows) out[row.meal_type] = row.items;
  return { dayOfWeek: dow, dayName: DAY_NAMES[dow], meals: out };
}

function todaysMenu() {
  return menuForDay(new Date().getDay());
}

// -------------------------------------------------------------- Attendance

function markMealAttendance({ studentId, mealDate, mealType, markedBy }) {
  if (!studentId) throw fail('studentId is required');
  if (!DATE_PATTERN.test(mealDate || '')) throw fail('mealDate must look like "2026-08-15"');
  if (!MEAL_TYPES.includes(mealType)) throw fail(`mealType must be one of ${MEAL_TYPES.join(', ')}`);

  const id = uid();
  try {
    db.prepare('INSERT INTO mess_attendance (id, student_id, meal_date, meal_type, marked_by) VALUES (?,?,?,?,?)')
      .run(id, studentId, mealDate, mealType, markedBy || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      throw fail('Already marked for this student, date, and meal — duplicate scan ignored', 409);
    }
    throw e;
  }
  return db.prepare('SELECT * FROM mess_attendance WHERE id = ?').get(id);
}

function myMealHistory(studentId, { from, to } = {}) {
  let sql = 'SELECT * FROM mess_attendance WHERE student_id = ?';
  const params = [studentId];
  if (from) { sql += ' AND meal_date >= ?'; params.push(from); }
  if (to) { sql += ' AND meal_date <= ?'; params.push(to); }
  sql += ' ORDER BY meal_date DESC, meal_type';
  return db.prepare(sql).all(...params);
}

// Headcount + roster for a given date/meal — what the kitchen needs to
// know how much to cook, and who to expect.
function attendanceReport({ mealDate, mealType }) {
  if (!DATE_PATTERN.test(mealDate || '')) throw fail('mealDate must look like "2026-08-15"');
  if (!MEAL_TYPES.includes(mealType)) throw fail(`mealType must be one of ${MEAL_TYPES.join(', ')}`);
  const rows = db.prepare(
    `SELECT ma.*, u.name FROM mess_attendance ma JOIN users u ON u.id = ma.student_id
     WHERE ma.meal_date = ? AND ma.meal_type = ? ORDER BY u.name`
  ).all(mealDate, mealType);
  return { mealDate, mealType, count: rows.length, students: rows };
}

// -------------------------------------------------------------- Complaints

const VALID_CATEGORY = new Set(['room', 'mess', 'maintenance', 'other']);
const VALID_STATUS = new Set(['open', 'in_progress', 'resolved', 'closed']);

function fileComplaint({ studentId, category, subject, description }) {
  if (!studentId) throw fail('studentId is required');
  if (!VALID_CATEGORY.has(category)) throw fail(`category must be one of ${[...VALID_CATEGORY].join(', ')}`);
  if (!subject || !String(subject).trim()) throw fail('subject is required');

  const id = uid();
  db.prepare('INSERT INTO hostel_complaints (id, student_id, category, subject, description) VALUES (?,?,?,?,?)')
    .run(id, studentId, category, String(subject).trim(), description || null);
  return db.prepare('SELECT * FROM hostel_complaints WHERE id = ?').get(id);
}

function getComplaint(id) {
  return db.prepare('SELECT * FROM hostel_complaints WHERE id = ?').get(id) || null;
}

function myComplaints(studentId) {
  return db.prepare('SELECT * FROM hostel_complaints WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

function listComplaints({ status, category } = {}) {
  let sql = 'SELECT hc.*, u.name AS student_name FROM hostel_complaints hc JOIN users u ON u.id = hc.student_id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND hc.status = ?'; params.push(status); }
  if (category) { sql += ' AND hc.category = ?'; params.push(category); }
  sql += ' ORDER BY hc.created_at DESC';
  return db.prepare(sql).all(...params);
}

function assignComplaint({ id, assignedTo, assignedBy }) {
  const row = getComplaint(id);
  if (!row) throw fail('Complaint not found', 404);
  if (row.status === 'closed') throw fail('Complaint is closed', 409);
  if (!assignedTo) throw fail('assignedTo is required');
  db.prepare(
    `UPDATE hostel_complaints SET assigned_to = ?, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = datetime('now') WHERE id = ?`
  ).run(assignedTo, id);
  return getComplaint(id);
}

function updateComplaintStatus({ id, status, resolutionNotes, updatedBy }) {
  const row = getComplaint(id);
  if (!row) throw fail('Complaint not found', 404);
  if (row.status === 'closed') throw fail('Complaint is already closed', 409);
  if (!VALID_STATUS.has(status)) throw fail(`status must be one of ${[...VALID_STATUS].join(', ')}`);
  if ((status === 'resolved' || status === 'closed') && !resolutionNotes) {
    throw fail('resolutionNotes is required to mark a complaint resolved or closed');
  }
  const resolvedAtClause = status === 'resolved' ? "datetime('now')" : 'resolved_at';
  db.prepare(
    `UPDATE hostel_complaints SET status = ?, resolution_notes = ?, updated_at = datetime('now'),
     resolved_at = ${resolvedAtClause} WHERE id = ?`
  ).run(status, resolutionNotes || row.resolution_notes, id);
  return getComplaint(id);
}

module.exports = {
  MEAL_TYPES,
  upsertMenu, weeklyMenu, menuForDay, todaysMenu,
  markMealAttendance, myMealHistory, attendanceReport,
  fileComplaint, getComplaint, myComplaints, listComplaints, assignComplaint, updateComplaintStatus,
};
