// Faculty "Full Student Profile (Read-Only)" — aggregates a complete,
// read-only view of any student for the faculty portal: basic info,
// bio/social links, attendance, grades/academics, assignment &amp; quiz
// performance, library loans, and gamification points.
//
// Fully additive: no new tables, no writes anywhere. It only reads
// through existing module exports (or a plain SELECT on a table another
// module already owns), the same pattern parentDashboard.js and
// facultyDashboard.js already use. Nothing here changes any existing
// table, function, or route.

const { db } = require('./db');
const academics = require('./academics');
const library = require('./library');
const gamification = require('./gamification');
const studentProfile = require('./studentProfile');

function round1(n) {
  return Math.round(n * 10) / 10;
}

function studentBasics(studentId) {
  return db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ? AND role = ?').get(studentId, 'student') || null;
}

function listAllStudents({ search } = {}) {
  if (search) {
    const like = `%${search}%`;
    return db
      .prepare("SELECT id, name, email FROM users WHERE role = 'student' AND (name LIKE ? OR email LIKE ?) ORDER BY name")
      .all(like, like);
  }
  return db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
}

function attendanceDetail(studentId) {
  const rows = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC').all(studentId);
  const present = rows.filter((r) => r.status === 'present').length;
  const late = rows.filter((r) => r.status === 'late').length;
  const absent = rows.filter((r) => r.status === 'absent').length;
  return {
    overallPercent: rows.length ? round1((present / rows.length) * 100) : null,
    totalRecords: rows.length,
    present,
    late,
    absent,
    recent: rows.slice(0, 20),
  };
}

function gradesDetail(studentId) {
  const rows = db.prepare('SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
  return { count: rows.length, recent: rows.slice(0, 20) };
}

function academicsDetail(studentId) {
  try {
    return academics.transcriptFor(studentId);
  } catch (_e) {
    return { cgpa: null, semesters: [] };
  }
}

function assignmentsDetail(studentId) {
  const rows = db
    .prepare(
      `SELECT s.*, a.title, a.subject, a.class_section, a.max_marks
       FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
       WHERE s.student_id = ? ORDER BY s.submitted_at DESC`
    )
    .all(studentId);
  const graded = rows.filter((r) => r.marks != null);
  const avgPercent = graded.length
    ? round1(graded.reduce((sum, r) => sum + (r.marks / r.max_marks) * 100, 0) / graded.length)
    : null;
  return { count: rows.length, gradedCount: graded.length, averagePercent: avgPercent, recent: rows.slice(0, 20) };
}

function quizzesDetail(studentId) {
  const rows = db
    .prepare(
      `SELECT qa.*, q.title, q.subject, q.class_section
       FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.student_id = ? AND qa.submitted_at IS NOT NULL ORDER BY qa.submitted_at DESC`
    )
    .all(studentId);
  const scored = rows.filter((r) => r.score != null && r.max_score);
  const avgPercent = scored.length
    ? round1(scored.reduce((sum, r) => sum + (r.score / r.max_score) * 100, 0) / scored.length)
    : null;
  return { count: rows.length, averagePercent: avgPercent, recent: rows.slice(0, 20) };
}

function libraryDetail(studentId) {
  const loans = library.listIssuesForStudent(studentId);
  const active = loans.filter((l) => !l.returned_at);
  const today = new Date().toISOString().slice(0, 10);
  return { totalLoans: loans.length, activeLoans: active.length, overdue: active.filter((l) => l.due_at && l.due_at < today) };
}

// Full read-only detail for one student — used by the faculty "Full
// Student Profile" view. Faculty are trusted, school-wide readers of
// student academic data (same trust level assumed by the existing
// library.js `/loans/:studentId` and messaging.js routes), so this is
// not gated to only students in the faculty member's own classes.
function fullProfile(studentId) {
  const student = studentBasics(studentId);
  if (!student) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }
  const profile = studentProfile.getProfile(studentId);
  return {
    generatedAt: new Date().toISOString(),
    student,
    bio: profile.bio,
    socialLinks: profile.socialLinks,
    attendance: attendanceDetail(studentId),
    grades: gradesDetail(studentId),
    academics: academicsDetail(studentId),
    assignments: assignmentsDetail(studentId),
    quizzes: quizzesDetail(studentId),
    library: libraryDetail(studentId),
    gamificationPoints: gamification.totalPoints(studentId),
  };
}

module.exports = { listAllStudents, fullProfile };
