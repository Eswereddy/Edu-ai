// Mock Interview Scheduling: faculty or registered alumni offer interview
// slots, students book one, either side can cancel, and the interviewer
// closes it out with feedback + a rating. Additive — new table only.
//
// There's no separate "alumni" login role in this system (see
// VALID_ROLES in auth.js), so "interviewer" here means: faculty/admin,
// OR any user who has registered themselves in the existing `alumni`
// table (src/placements.js, untouched). Requiring that module just
// ensures its tables exist before this one queries `alumni`.
//
// NOTE on "live job feeds": that's an external job-board integration
// (LinkedIn/Naukri/Indeed APIs), which needs a real paid API key this
// environment doesn't have — not something to fake. What's genuinely
// buildable and IS built here is the piece those job feeds can't give
// you: a working interview-practice pipeline on top of the placements
// module that already exists.

const crypto = require('crypto');
const { db } = require('./db');
require('./placements'); // ensures the `alumni` table exists before we query it

db.exec(`
CREATE TABLE IF NOT EXISTS interview_slots (
  id TEXT PRIMARY KEY,
  interviewer_id TEXT NOT NULL,
  interview_type TEXT NOT NULL DEFAULT 'technical' CHECK(interview_type IN ('technical','hr','group_discussion','resume_review')),
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  student_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','booked','completed','cancelled')),
  feedback TEXT,
  rating INTEGER CHECK(rating IS NULL OR rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  booked_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interview_slots_interviewer ON interview_slots(interviewer_id);
CREATE INDEX IF NOT EXISTS idx_interview_slots_student ON interview_slots(student_id);
CREATE INDEX IF NOT EXISTS idx_interview_slots_date ON interview_slots(slot_date);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return String(aStart) < String(bEnd) && String(bStart) < String(aEnd);
}

const INTERVIEW_TYPES = ['technical', 'hr', 'group_discussion', 'resume_review'];

function isAlumni(userId) {
  return !!db.prepare('SELECT 1 FROM alumni WHERE user_id = ?').get(userId);
}

// -------------------------------------------------------------- Offering

function offerSlot({ interviewerId, interviewType, slotDate, startTime, endTime }) {
  if (!interviewerId || !slotDate || !startTime || !endTime) {
    throw fail('interviewerId, slotDate, startTime, endTime are required');
  }
  if (String(startTime) >= String(endTime)) throw fail('startTime must be before endTime');
  const type = INTERVIEW_TYPES.includes(interviewType) ? interviewType : 'technical';

  const sameDaySlots = db.prepare(
    `SELECT * FROM interview_slots WHERE interviewer_id = ? AND slot_date = ? AND status != 'cancelled'`
  ).all(interviewerId, slotDate);
  const clash = sameDaySlots.find((s) => timesOverlap(startTime, endTime, s.start_time, s.end_time));
  if (clash) throw fail('You already have a slot that overlaps this time', 409);

  const id = uid();
  db.prepare(
    `INSERT INTO interview_slots (id, interviewer_id, interview_type, slot_date, start_time, end_time)
     VALUES (?,?,?,?,?,?)`
  ).run(id, interviewerId, type, slotDate, startTime, endTime);
  return getSlot(id);
}

function getSlot(id) {
  return db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(id) || null;
}

function listOpenSlots({ interviewType, fromDate } = {}) {
  let sql = "SELECT * FROM interview_slots WHERE status = 'open'";
  const params = [];
  if (interviewType) { sql += ' AND interview_type = ?'; params.push(interviewType); }
  if (fromDate) { sql += ' AND slot_date >= ?'; params.push(fromDate); }
  sql += ' ORDER BY slot_date, start_time';
  return db.prepare(sql).all(...params);
}

function myOfferedSlots(interviewerId) {
  return db.prepare('SELECT * FROM interview_slots WHERE interviewer_id = ? ORDER BY slot_date DESC, start_time').all(interviewerId);
}

// ---------------------------------------------------------------- Booking

function bookSlot({ slotId, studentId }) {
  const slot = getSlot(slotId);
  if (!slot) throw fail('Slot not found', 404);
  if (slot.status !== 'open') throw fail('This slot is no longer available', 409);

  const studentBookings = db.prepare(
    `SELECT * FROM interview_slots WHERE student_id = ? AND slot_date = ? AND status = 'booked'`
  ).all(studentId, slot.slot_date);
  const clash = studentBookings.find((s) => timesOverlap(slot.start_time, slot.end_time, s.start_time, s.end_time));
  if (clash) throw fail('You already have another mock interview booked at an overlapping time', 409);

  db.prepare(
    `UPDATE interview_slots SET student_id = ?, status = 'booked', booked_at = datetime('now') WHERE id = ?`
  ).run(studentId, slotId);
  return getSlot(slotId);
}

function cancelByStudent({ slotId, studentId }) {
  const slot = getSlot(slotId);
  if (!slot) throw fail('Slot not found', 404);
  if (slot.student_id !== studentId) throw fail('This is not your booking', 403);
  if (slot.status !== 'booked') throw fail('This booking cannot be cancelled', 409);
  db.prepare(
    `UPDATE interview_slots SET status = 'open', student_id = NULL, booked_at = NULL WHERE id = ?`
  ).run(slotId);
  return getSlot(slotId);
}

function cancelByInterviewer({ slotId, interviewerId }) {
  const slot = getSlot(slotId);
  if (!slot) throw fail('Slot not found', 404);
  if (slot.interviewer_id !== interviewerId) throw fail('This is not your slot', 403);
  if (!['open', 'booked'].includes(slot.status)) throw fail('This slot cannot be cancelled', 409);
  db.prepare(`UPDATE interview_slots SET status = 'cancelled' WHERE id = ?`).run(slotId);
  return getSlot(slotId);
}

// -------------------------------------------------------------- Feedback

function completeInterview({ slotId, interviewerId, feedback, rating }) {
  const slot = getSlot(slotId);
  if (!slot) throw fail('Slot not found', 404);
  if (slot.interviewer_id !== interviewerId) throw fail('This is not your slot', 403);
  if (slot.status !== 'booked') throw fail('Only a booked slot can be marked completed', 409);
  if (!feedback || !String(feedback).trim()) throw fail('feedback is required');
  const r = rating != null ? Number(rating) : null;
  if (r != null && (Number.isNaN(r) || r < 1 || r > 5)) throw fail('rating must be between 1 and 5');
  db.prepare(
    `UPDATE interview_slots SET status = 'completed', feedback = ?, rating = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(String(feedback).trim(), r, slotId);
  return getSlot(slotId);
}

function myBookings(studentId) {
  return db.prepare(
    'SELECT * FROM interview_slots WHERE student_id = ? ORDER BY slot_date DESC, start_time'
  ).all(studentId);
}

module.exports = {
  INTERVIEW_TYPES, isAlumni,
  offerSlot, getSlot, listOpenSlots, myOfferedSlots,
  bookSlot, cancelByStudent, cancelByInterviewer,
  completeInterview, myBookings,
};
