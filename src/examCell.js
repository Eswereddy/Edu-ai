// Exam Cell: exam scheduling, auto-seating across rooms, invigilation
// rostering (with double-booking clash detection, same pattern as
// timetable.js), result recording, and a revaluation request workflow.
//
// Fully additive — new tables only, own file. Deliberately NOT wired into
// the existing `grades` table in db.js: that table is generic and already
// used elsewhere, so exam-cell results live in their own `exam_results`
// table keyed by exam_id instead of touching it.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  class_section TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  max_marks REAL NOT NULL DEFAULT 100,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exams_section ON exams(class_section);
CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date);

CREATE TABLE IF NOT EXISTS exam_rooms (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(exam_id, room_name)
);

CREATE TABLE IF NOT EXISTS exam_seats (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  seat_no INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  class_section TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(exam_id, room_name, seat_no),
  UNIQUE(exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_seats_student ON exam_seats(exam_id, student_id);

CREATE TABLE IF NOT EXISTS exam_invigilators (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,
  faculty_id TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(exam_id, room_name, faculty_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_invig_faculty ON exam_invigilators(faculty_id);

CREATE TABLE IF NOT EXISTS exam_results (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  marks REAL NOT NULL,
  graded_by TEXT,
  graded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS exam_revaluation_requests (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','under_review','approved','rejected','completed')),
  original_marks REAL NOT NULL,
  revised_marks REAL,
  remarks TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exam_reval_student ON exam_revaluation_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_reval_status ON exam_revaluation_requests(status);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

// ------------------------------------------------------------------ Exams

function createExam({ title, subject, classSection, examDate, startTime, endTime, maxMarks, createdBy }) {
  if (!title || !subject || !classSection || !examDate || !startTime || !endTime) {
    throw fail('title, subject, classSection, examDate, startTime, endTime are required');
  }
  if (String(startTime) >= String(endTime)) {
    throw fail('startTime must be before endTime');
  }
  const id = uid();
  db.prepare(
    `INSERT INTO exams (id, title, subject, class_section, exam_date, start_time, end_time, max_marks, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, String(title).trim(), String(subject).trim(), classSection, examDate, startTime, endTime,
    maxMarks != null ? Number(maxMarks) : 100, createdBy || null);
  return getExam(id);
}

function getExam(id) {
  return db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
}

function listExams({ classSection, upcomingOnly } = {}) {
  let sql = 'SELECT * FROM exams WHERE 1=1';
  const params = [];
  if (classSection) {
    sql += ' AND class_section = ?';
    params.push(classSection);
  }
  if (upcomingOnly) {
    sql += " AND exam_date >= date('now')";
  }
  sql += ' ORDER BY exam_date, start_time';
  return db.prepare(sql).all(...params);
}

function deleteExam(id) {
  const exam = getExam(id);
  if (!exam) return null;
  db.prepare('DELETE FROM exams WHERE id = ?').run(id); // cascades rooms/seats/invigilators/results/reval
  return exam;
}

// ------------------------------------------------------------------ Rooms

function addExamRoom({ examId, roomName, capacity }) {
  if (!getExam(examId)) throw fail('Exam not found', 404);
  if (!roomName || !capacity || Number(capacity) < 1) {
    throw fail('roomName and a positive capacity are required');
  }
  const id = uid();
  try {
    db.prepare('INSERT INTO exam_rooms (id, exam_id, room_name, capacity) VALUES (?,?,?,?)')
      .run(id, examId, roomName, Number(capacity));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw fail('That room is already added to this exam', 409);
    throw e;
  }
  return db.prepare('SELECT * FROM exam_rooms WHERE id = ?').get(id);
}

function listExamRooms(examId) {
  return db.prepare('SELECT * FROM exam_rooms WHERE exam_id = ? ORDER BY room_name').all(examId);
}

// ----------------------------------------------------------------- Seating

// Distributes students across the exam's rooms. Students from the same
// class_section are interleaved round-robin *before* filling rooms
// sequentially, which spreads each section out instead of clustering it —
// a simple, explainable anti-copying heuristic (not a guarantee).
function generateSeating({ examId, students }) {
  const exam = getExam(examId);
  if (!exam) throw fail('Exam not found', 404);
  if (!Array.isArray(students) || students.length === 0) {
    throw fail('students (array of {studentId, classSection}) is required');
  }
  const rooms = listExamRooms(examId);
  if (rooms.length === 0) throw fail('Add at least one room to this exam before generating seating');

  const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);
  if (students.length > totalCapacity) {
    throw fail(`Not enough seats: ${students.length} students but only ${totalCapacity} seats across ${rooms.length} room(s)`, 409);
  }

  const bySection = new Map();
  for (const s of students) {
    if (!s.studentId || !s.classSection) throw fail('Each student needs studentId and classSection');
    if (!bySection.has(s.classSection)) bySection.set(s.classSection, []);
    bySection.get(s.classSection).push(s);
  }
  const sectionKeys = [...bySection.keys()];
  const cursors = Object.fromEntries(sectionKeys.map((k) => [k, 0]));
  const interleaved = [];
  while (interleaved.length < students.length) {
    for (const k of sectionKeys) {
      const bucket = bySection.get(k);
      if (cursors[k] < bucket.length) {
        interleaved.push(bucket[cursors[k]]);
        cursors[k] += 1;
      }
    }
  }

  const insertSeat = db.prepare(
    'INSERT INTO exam_seats (id, exam_id, room_name, seat_no, student_id, class_section) VALUES (?,?,?,?,?,?)'
  );
  // node:sqlite's DatabaseSync has no .transaction() helper (that's a
  // better-sqlite3-only API) — use explicit BEGIN/COMMIT/ROLLBACK instead.
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM exam_seats WHERE exam_id = ?').run(examId); // regenerate cleanly if re-run
    let ptr = 0;
    for (const room of rooms) {
      for (let seat = 1; seat <= room.capacity && ptr < interleaved.length; seat += 1, ptr += 1) {
        const s = interleaved[ptr];
        insertSeat.run(uid(), examId, room.room_name, seat, s.studentId, s.classSection);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return listSeatingByRoom(examId);
}

function listSeatingByRoom(examId) {
  const rows = db.prepare(
    'SELECT * FROM exam_seats WHERE exam_id = ? ORDER BY room_name, seat_no'
  ).all(examId);
  const byRoom = {};
  for (const r of rows) {
    if (!byRoom[r.room_name]) byRoom[r.room_name] = [];
    byRoom[r.room_name].push(r);
  }
  return byRoom;
}

function getSeatForStudent(examId, studentId) {
  return db.prepare('SELECT * FROM exam_seats WHERE exam_id = ? AND student_id = ?').get(examId, studentId);
}

// ------------------------------------------------------------ Invigilation

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return String(aStart) < String(bEnd) && String(bStart) < String(aEnd);
}

function assignInvigilator({ examId, roomName, facultyId, assignedBy }) {
  const exam = getExam(examId);
  if (!exam) throw fail('Exam not found', 404);
  if (!roomName || !facultyId) throw fail('roomName and facultyId are required');
  const room = db.prepare('SELECT * FROM exam_rooms WHERE exam_id = ? AND room_name = ?').get(examId, roomName);
  if (!room) throw fail('That room has not been added to this exam yet', 404);

  // Clash check: same faculty, same date, overlapping time window, any other exam.
  const sameDayAssignments = db.prepare(
    `SELECT ei.room_name, e.id as exam_id, e.title, e.start_time, e.end_time
     FROM exam_invigilators ei JOIN exams e ON e.id = ei.exam_id
     WHERE ei.faculty_id = ? AND e.exam_date = ? AND e.id != ?`
  ).all(facultyId, exam.exam_date, examId);
  const clash = sameDayAssignments.find((row) => timesOverlap(exam.start_time, exam.end_time, row.start_time, row.end_time));
  if (clash) {
    throw fail(`Faculty already invigilating "${clash.title}" (room ${clash.room_name}) at an overlapping time`, 409);
  }

  const id = uid();
  try {
    db.prepare('INSERT INTO exam_invigilators (id, exam_id, room_name, faculty_id, assigned_by) VALUES (?,?,?,?,?)')
      .run(id, examId, roomName, facultyId, assignedBy || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw fail('That faculty member is already invigilating this room for this exam', 409);
    throw e;
  }
  return db.prepare('SELECT * FROM exam_invigilators WHERE id = ?').get(id);
}

function removeInvigilator(id) {
  const row = db.prepare('SELECT * FROM exam_invigilators WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM exam_invigilators WHERE id = ?').run(id);
  return row;
}

function listInvigilators(examId) {
  return db.prepare('SELECT * FROM exam_invigilators WHERE exam_id = ? ORDER BY room_name').all(examId);
}

function myInvigilations(facultyId) {
  return db.prepare(
    `SELECT ei.*, e.title, e.subject, e.class_section, e.exam_date, e.start_time, e.end_time
     FROM exam_invigilators ei JOIN exams e ON e.id = ei.exam_id
     WHERE ei.faculty_id = ? ORDER BY e.exam_date, e.start_time`
  ).all(facultyId);
}

// ----------------------------------------------------------------- Results

function recordResult({ examId, studentId, marks, gradedBy }) {
  const exam = getExam(examId);
  if (!exam) throw fail('Exam not found', 404);
  if (!studentId || marks == null) throw fail('studentId and marks are required');
  const m = Number(marks);
  if (Number.isNaN(m) || m < 0 || m > exam.max_marks) {
    throw fail(`marks must be a number between 0 and ${exam.max_marks}`);
  }
  const existing = db.prepare('SELECT id FROM exam_results WHERE exam_id = ? AND student_id = ?').get(examId, studentId);
  if (existing) {
    db.prepare('UPDATE exam_results SET marks = ?, graded_by = ?, graded_at = datetime(\'now\') WHERE id = ?')
      .run(m, gradedBy || null, existing.id);
    return db.prepare('SELECT * FROM exam_results WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare('INSERT INTO exam_results (id, exam_id, student_id, marks, graded_by) VALUES (?,?,?,?,?)')
    .run(id, examId, studentId, m, gradedBy || null);
  return db.prepare('SELECT * FROM exam_results WHERE id = ?').get(id);
}

function listResults(examId) {
  return db.prepare('SELECT * FROM exam_results WHERE exam_id = ? ORDER BY student_id').all(examId);
}

function getResult(examId, studentId) {
  return db.prepare('SELECT * FROM exam_results WHERE exam_id = ? AND student_id = ?').get(examId, studentId);
}

function myResults(studentId) {
  return db.prepare(
    `SELECT r.*, e.title, e.subject, e.class_section, e.exam_date, e.max_marks
     FROM exam_results r JOIN exams e ON e.id = r.exam_id
     WHERE r.student_id = ? ORDER BY e.exam_date DESC`
  ).all(studentId);
}

// ------------------------------------------------------------ Revaluation

function requestRevaluation({ examId, studentId, reason }) {
  const result = getResult(examId, studentId);
  if (!result) throw fail('No recorded result for this exam yet — nothing to revaluate', 404);
  const openExisting = db.prepare(
    `SELECT id FROM exam_revaluation_requests WHERE exam_id = ? AND student_id = ? AND status IN ('pending','under_review')`
  ).get(examId, studentId);
  if (openExisting) throw fail('A revaluation request for this exam is already open', 409);

  const id = uid();
  db.prepare(
    `INSERT INTO exam_revaluation_requests (id, exam_id, student_id, reason, original_marks) VALUES (?,?,?,?,?)`
  ).run(id, examId, studentId, reason || null, result.marks);
  return db.prepare('SELECT * FROM exam_revaluation_requests WHERE id = ?').get(id);
}

function listRevaluationRequests({ status } = {}) {
  let sql = `SELECT rr.*, e.title, e.subject, e.class_section
             FROM exam_revaluation_requests rr JOIN exams e ON e.id = rr.exam_id WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND rr.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY rr.requested_at DESC';
  return db.prepare(sql).all(...params);
}

function myRevaluationRequests(studentId) {
  return db.prepare(
    `SELECT rr.*, e.title, e.subject, e.class_section
     FROM exam_revaluation_requests rr JOIN exams e ON e.id = rr.exam_id
     WHERE rr.student_id = ? ORDER BY rr.requested_at DESC`
  ).all(studentId);
}

const VALID_REVAL_STATUS = new Set(['pending', 'under_review', 'approved', 'rejected', 'completed']);

function reviewRevaluation({ id, status, revisedMarks, remarks, reviewedBy }) {
  const row = db.prepare('SELECT * FROM exam_revaluation_requests WHERE id = ?').get(id);
  if (!row) throw fail('Revaluation request not found', 404);
  if (!VALID_REVAL_STATUS.has(status)) throw fail('Invalid status');

  if (status === 'completed') {
    if (revisedMarks == null) throw fail('revisedMarks is required to complete a revaluation');
    const exam = getExam(row.exam_id);
    const rm = Number(revisedMarks);
    if (Number.isNaN(rm) || rm < 0 || rm > exam.max_marks) {
      throw fail(`revisedMarks must be between 0 and ${exam.max_marks}`);
    }
    recordResult({ examId: row.exam_id, studentId: row.student_id, marks: rm, gradedBy: reviewedBy });
  }

  db.prepare(
    `UPDATE exam_revaluation_requests
     SET status = ?, revised_marks = ?, remarks = ?, reviewed_by = ?, reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(status, revisedMarks != null ? Number(revisedMarks) : null, remarks || null, reviewedBy || null, id);
  return db.prepare('SELECT * FROM exam_revaluation_requests WHERE id = ?').get(id);
}

module.exports = {
  createExam, getExam, listExams, deleteExam,
  addExamRoom, listExamRooms,
  generateSeating, listSeatingByRoom, getSeatForStudent,
  assignInvigilator, removeInvigilator, listInvigilators, myInvigilations,
  recordResult, listResults, getResult, myResults,
  requestRevaluation, listRevaluationRequests, myRevaluationRequests, reviewRevaluation,
};
