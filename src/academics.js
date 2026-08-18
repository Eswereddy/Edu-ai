// Semester → Subjects → Results module. Fully additive — new tables only,
// does not touch or replace the existing flat `grades` table (still used
// by whatever already calls GET/POST /api/grades). This module is for a
// proper semester-wise academic record: subjects with credits, per-subject
// results with letter grades and grade points, and SGPA/CGPA rollups —
// the "semester subjects and results" system.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS semesters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_section TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS semester_subjects (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  subject_code TEXT,
  credits REAL NOT NULL DEFAULT 3,
  faculty_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES semester_subjects(id) ON DELETE CASCADE,
  marks_obtained REAL NOT NULL,
  max_marks REAL NOT NULL DEFAULT 100,
  grade_letter TEXT NOT NULL,
  grade_point REAL NOT NULL,
  entered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_semester_subjects_semester ON semester_subjects(semester_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_semester ON results(semester_id);
`);

function uid() {
  return crypto.randomUUID();
}

// Standard 10-point scale (common for semester/CGPA systems). Kept as a
// pure function so it's easy to swap the scale later without touching
// callers.
const GRADE_SCALE = [
  { min: 90, letter: 'O', point: 10 },
  { min: 80, letter: 'A+', point: 9 },
  { min: 70, letter: 'A', point: 8 },
  { min: 60, letter: 'B+', point: 7 },
  { min: 50, letter: 'B', point: 6 },
  { min: 40, letter: 'C', point: 5 },
  { min: 0, letter: 'F', point: 0 },
];

function gradeFor(marksObtained, maxMarks) {
  const pct = maxMarks > 0 ? (marksObtained / maxMarks) * 100 : 0;
  const band = GRADE_SCALE.find((b) => pct >= b.min) || GRADE_SCALE[GRADE_SCALE.length - 1];
  return { percent: Math.round(pct * 100) / 100, letter: band.letter, point: band.point };
}

// ------------------------------------------------------------ Semesters
function createSemester({ name, classSection, startDate, endDate, createdBy }) {
  if (!name || !classSection) throw Object.assign(new Error('name and classSection are required'), { status: 400 });
  const id = uid();
  db.prepare(
    'INSERT INTO semesters (id, name, class_section, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, classSection, startDate || null, endDate || null, createdBy || null);
  return getSemester(id);
}

function getSemester(id) {
  return db.prepare('SELECT * FROM semesters WHERE id = ?').get(id) || null;
}

function listSemesters({ classSection } = {}) {
  if (classSection) {
    return db.prepare('SELECT * FROM semesters WHERE class_section = ? ORDER BY created_at DESC').all(classSection);
  }
  return db.prepare('SELECT * FROM semesters ORDER BY created_at DESC').all();
}

function updateSemester(id, { name, classSection, startDate, endDate, isActive }) {
  const existing = getSemester(id);
  if (!existing) throw Object.assign(new Error('Semester not found'), { status: 404 });
  db.prepare(
    `UPDATE semesters SET
       name = ?, class_section = ?, start_date = ?, end_date = ?, is_active = ?
     WHERE id = ?`
  ).run(
    name != null ? name : existing.name,
    classSection != null ? classSection : existing.class_section,
    startDate !== undefined ? startDate : existing.start_date,
    endDate !== undefined ? endDate : existing.end_date,
    isActive != null ? (isActive ? 1 : 0) : existing.is_active,
    id
  );
  return getSemester(id);
}

function deleteSemester(id) {
  if (!getSemester(id)) throw Object.assign(new Error('Semester not found'), { status: 404 });
  // Cascades to semester_subjects and results via ON DELETE CASCADE.
  db.prepare('DELETE FROM semesters WHERE id = ?').run(id);
  return { deleted: true };
}

// ------------------------------------------------------------- Subjects
function addSubject(semesterId, { subjectName, subjectCode, credits, facultyId }) {
  if (!getSemester(semesterId)) throw Object.assign(new Error('Semester not found'), { status: 404 });
  if (!subjectName) throw Object.assign(new Error('subjectName is required'), { status: 400 });
  const id = uid();
  db.prepare(
    'INSERT INTO semester_subjects (id, semester_id, subject_name, subject_code, credits, faculty_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, semesterId, subjectName, subjectCode || null, credits != null ? Number(credits) : 3, facultyId || null);
  return db.prepare('SELECT * FROM semester_subjects WHERE id = ?').get(id);
}

function listSubjects(semesterId) {
  return db.prepare('SELECT * FROM semester_subjects WHERE semester_id = ? ORDER BY created_at ASC').all(semesterId);
}

function getSubject(id) {
  return db.prepare('SELECT * FROM semester_subjects WHERE id = ?').get(id) || null;
}

function updateSubject(id, { subjectName, subjectCode, credits, facultyId }) {
  const existing = getSubject(id);
  if (!existing) throw Object.assign(new Error('Subject not found'), { status: 404 });
  db.prepare(
    `UPDATE semester_subjects SET
       subject_name = ?, subject_code = ?, credits = ?, faculty_id = ?
     WHERE id = ?`
  ).run(
    subjectName != null ? subjectName : existing.subject_name,
    subjectCode !== undefined ? subjectCode : existing.subject_code,
    credits != null ? Number(credits) : existing.credits,
    facultyId !== undefined ? facultyId : existing.faculty_id,
    id
  );
  return getSubject(id);
}

function deleteSubject(id) {
  if (!getSubject(id)) throw Object.assign(new Error('Subject not found'), { status: 404 });
  // Cascades to results via ON DELETE CASCADE.
  db.prepare('DELETE FROM semester_subjects WHERE id = ?').run(id);
  return { deleted: true };
}

// -------------------------------------------------------------- Results
function upsertResult({ studentId, semesterId, subjectId, marksObtained, maxMarks, enteredBy }) {
  const subject = getSubject(subjectId);
  if (!subject || subject.semester_id !== semesterId) {
    throw Object.assign(new Error('Subject not found in this semester'), { status: 404 });
  }
  if (studentId == null || marksObtained == null) {
    throw Object.assign(new Error('studentId and marksObtained are required'), { status: 400 });
  }
  const max = maxMarks != null ? Number(maxMarks) : 100;
  const { letter, point } = gradeFor(Number(marksObtained), max);
  const existing = db.prepare('SELECT id FROM results WHERE student_id = ? AND subject_id = ?').get(studentId, subjectId);
  if (existing) {
    db.prepare(
      'UPDATE results SET marks_obtained = ?, max_marks = ?, grade_letter = ?, grade_point = ?, entered_by = ?, created_at = datetime(\'now\') WHERE id = ?'
    ).run(Number(marksObtained), max, letter, point, enteredBy || null, existing.id);
    return getResultById(existing.id);
  }
  const id = uid();
  db.prepare(
    'INSERT INTO results (id, student_id, semester_id, subject_id, marks_obtained, max_marks, grade_letter, grade_point, entered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, studentId, semesterId, subjectId, Number(marksObtained), max, letter, point, enteredBy || null);
  return getResultById(id);
}

function getResultById(id) {
  return db
    .prepare(
      `SELECT r.*, s.subject_name, s.subject_code, s.credits
       FROM results r JOIN semester_subjects s ON s.id = r.subject_id
       WHERE r.id = ?`
    )
    .get(id);
}

function listResultsForStudentInSemester(studentId, semesterId) {
  return db
    .prepare(
      `SELECT r.*, s.subject_name, s.subject_code, s.credits
       FROM results r JOIN semester_subjects s ON s.id = r.subject_id
       WHERE r.student_id = ? AND r.semester_id = ?
       ORDER BY s.created_at ASC`
    )
    .all(studentId, semesterId);
}

function deleteResult(id) {
  const row = db.prepare('SELECT id FROM results WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Result not found'), { status: 404 });
  db.prepare('DELETE FROM results WHERE id = ?').run(id);
  return { deleted: true };
}

function listResultsForSemester(semesterId) {
  return db
    .prepare(
      `SELECT r.*, s.subject_name, s.subject_code, s.credits
       FROM results r JOIN semester_subjects s ON s.id = r.subject_id
       WHERE r.semester_id = ?
       ORDER BY r.student_id ASC`
    )
    .all(semesterId);
}

// SGPA = credit-weighted average grade point for one semester.
function sgpaFor(studentId, semesterId) {
  const rows = listResultsForStudentInSemester(studentId, semesterId);
  if (!rows.length) return null;
  const totalCredits = rows.reduce((sum, r) => sum + r.credits, 0);
  if (totalCredits <= 0) return null;
  const weighted = rows.reduce((sum, r) => sum + r.credits * r.grade_point, 0);
  return Math.round((weighted / totalCredits) * 100) / 100;
}

// Full transcript: every semester this student has results in, each with
// its subject breakdown + SGPA, plus an overall CGPA across all of them.
function transcriptFor(studentId) {
  const semesterIds = db
    .prepare('SELECT DISTINCT semester_id FROM results WHERE student_id = ?')
    .all(studentId)
    .map((r) => r.semester_id);

  const semesters = semesterIds.map((semId) => {
    const semester = getSemester(semId);
    const subjects = listResultsForStudentInSemester(studentId, semId);
    return {
      semesterId: semId,
      name: semester?.name || 'Unknown semester',
      classSection: semester?.class_section || null,
      subjects: subjects.map((r) => ({
        subjectName: r.subject_name,
        subjectCode: r.subject_code,
        credits: r.credits,
        marksObtained: r.marks_obtained,
        maxMarks: r.max_marks,
        gradeLetter: r.grade_letter,
        gradePoint: r.grade_point,
      })),
      sgpa: sgpaFor(studentId, semId),
    };
  });

  const allCredits = semesters.reduce((sum, s) => sum + s.subjects.reduce((a, sub) => a + sub.credits, 0), 0);
  const allWeighted = semesters.reduce(
    (sum, s) => sum + s.subjects.reduce((a, sub) => a + sub.credits * sub.gradePoint, 0),
    0
  );
  const cgpa = allCredits > 0 ? Math.round((allWeighted / allCredits) * 100) / 100 : null;

  return { studentId, semesters, cgpa };
}

module.exports = {
  gradeFor,
  createSemester,
  getSemester,
  listSemesters,
  updateSemester,
  deleteSemester,
  addSubject,
  listSubjects,
  getSubject,
  updateSubject,
  deleteSubject,
  upsertResult,
  getResultById,
  deleteResult,
  listResultsForStudentInSemester,
  listResultsForSemester,
  sgpaFor,
  transcriptFor,
};
