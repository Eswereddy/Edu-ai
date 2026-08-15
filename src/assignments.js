// Assignments: faculty post work for a class-section, students submit,
// faculty grade. Additive module — own tables, own file.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  class_section TEXT NOT NULL,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  max_marks REAL NOT NULL DEFAULT 100,
  attachment_upload_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  content TEXT,
  upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','late','graded','returned')),
  marks REAL,
  feedback TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  graded_at TEXT,
  UNIQUE(assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_section ON assignments(class_section);
CREATE INDEX IF NOT EXISTS idx_assignments_faculty ON assignments(faculty_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON assignment_submissions(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createAssignment({ facultyId, classSection, subject, title, description, dueDate, maxMarks, attachmentUploadId }) {
  if (!facultyId || !classSection || !subject || !title) {
    const err = new Error('classSection, subject, title are required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO assignments (id, faculty_id, class_section, subject, title, description, due_date, max_marks, attachment_upload_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, facultyId, classSection, subject, title, description || null, dueDate || null, Number(maxMarks) || 100, attachmentUploadId || null);
  return getAssignment(id);
}

function getAssignment(id) {
  return db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) || null;
}

function listForSection(classSection) {
  return db.prepare('SELECT * FROM assignments WHERE class_section = ? ORDER BY due_date IS NULL, due_date ASC').all(classSection);
}

function listForFaculty(facultyId) {
  return db.prepare('SELECT * FROM assignments WHERE faculty_id = ? ORDER BY created_at DESC').all(facultyId);
}

function deleteAssignment(id, facultyId) {
  const a = getAssignment(id);
  if (!a) return false;
  if (facultyId && a.faculty_id !== facultyId) {
    const err = new Error('Not your assignment');
    err.status = 403;
    throw err;
  }
  db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
  return true;
}

function submit({ assignmentId, studentId, content, uploadId }) {
  const assignment = getAssignment(assignmentId);
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }
  if (!content && !uploadId) {
    const err = new Error('Submission needs text content or an uploaded file');
    err.status = 400;
    throw err;
  }
  const isLate = assignment.due_date ? new Date() > new Date(assignment.due_date) : false;
  const id = uid();
  db.prepare(
    `INSERT INTO assignment_submissions (id, assignment_id, student_id, content, upload_id, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(assignment_id, student_id) DO UPDATE SET
       content = excluded.content, upload_id = excluded.upload_id, status = excluded.status,
       submitted_at = datetime('now'), marks = NULL, feedback = NULL, graded_at = NULL`
  ).run(id, assignmentId, studentId, content || null, uploadId || null, isLate ? 'late' : 'submitted');
  return getSubmission(assignmentId, studentId);
}

function getSubmission(assignmentId, studentId) {
  return db
    .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
    .get(assignmentId, studentId) || null;
}

function listSubmissions(assignmentId) {
  return db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? ORDER BY submitted_at ASC').all(assignmentId);
}

function listSubmissionsForStudent(studentId) {
  return db
    .prepare(
      `SELECT s.*, a.title, a.subject, a.max_marks, a.due_date
       FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
       WHERE s.student_id = ? ORDER BY s.submitted_at DESC`
    )
    .all(studentId);
}

function grade({ assignmentId, studentId, marks, feedback }) {
  const assignment = getAssignment(assignmentId);
  const submission = getSubmission(assignmentId, studentId);
  if (!assignment || !submission) {
    const err = new Error('Submission not found');
    err.status = 404;
    throw err;
  }
  const numericMarks = Number(marks);
  if (Number.isNaN(numericMarks) || numericMarks < 0 || numericMarks > assignment.max_marks) {
    const err = new Error(`marks must be between 0 and ${assignment.max_marks}`);
    err.status = 400;
    throw err;
  }
  db.prepare(
    `UPDATE assignment_submissions SET marks = ?, feedback = ?, status = 'graded', graded_at = datetime('now')
     WHERE assignment_id = ? AND student_id = ?`
  ).run(numericMarks, feedback || null, assignmentId, studentId);
  return getSubmission(assignmentId, studentId);
}

function assignmentStats(assignmentId) {
  const rows = listSubmissions(assignmentId);
  const graded = rows.filter((r) => r.marks != null);
  const avg = graded.length ? graded.reduce((s, r) => s + r.marks, 0) / graded.length : null;
  return {
    totalSubmissions: rows.length,
    graded: graded.length,
    ungraded: rows.length - graded.length,
    averageMarks: avg == null ? null : Math.round(avg * 100) / 100,
    lateCount: rows.filter((r) => r.status === 'late').length,
  };
}

module.exports = {
  createAssignment,
  getAssignment,
  listForSection,
  listForFaculty,
  deleteAssignment,
  submit,
  getSubmission,
  listSubmissions,
  listSubmissionsForStudent,
  grade,
  assignmentStats,
};
