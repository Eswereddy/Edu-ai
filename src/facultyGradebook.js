// Faculty gradebook analytics: read-only aggregation across the marks
// data that already exists (assignment submissions + quiz attempts) for
// the assignments/quizzes this faculty member created. No new marks
// tables, no writes — it only reads through the existing exported
// functions in assignments.js and quiz.js (and, for quiz attempts, a
// plain SELECT on quiz_attempts, the same table quiz.js itself owns).
// Nothing in either of those modules is changed.

const { db } = require('./db');
const assignments = require('./assignments');
const quiz = require('./quiz');

function round1(n) {
  return Math.round(n * 10) / 10;
}

// One row per assignment this faculty member created, with its stats,
// optionally filtered to a class-section and/or subject.
function assignmentBreakdown(facultyId, { classSection, subject } = {}) {
  let list = assignments.listForFaculty(facultyId);
  if (classSection) list = list.filter((a) => a.class_section === classSection);
  if (subject) list = list.filter((a) => a.subject === subject);
  return list.map((a) => ({
    id: a.id,
    title: a.title,
    subject: a.subject,
    classSection: a.class_section,
    dueDate: a.due_date,
    maxMarks: a.max_marks,
    ...assignments.assignmentStats(a.id),
  }));
}

// One row per quiz this faculty member created, with attempt stats,
// optionally filtered the same way.
function quizBreakdown(facultyId, { classSection, subject } = {}) {
  let list = quiz.listForCreator(facultyId);
  if (classSection) list = list.filter((q) => q.class_section === classSection);
  if (subject) list = list.filter((q) => q.subject === subject);
  return list.map((q) => {
    const attempts = db
      .prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND submitted_at IS NOT NULL')
      .all(q.id);
    const scored = attempts.filter((a) => a.score != null && a.max_score);
    const avgPercent = scored.length
      ? round1(scored.reduce((s, a) => s + (a.score / a.max_score) * 100, 0) / scored.length)
      : null;
    const passCount = scored.filter((a) => a.max_score && a.score / a.max_score >= 0.4).length;
    return {
      id: q.id,
      title: q.title,
      subject: q.subject,
      classSection: q.class_section,
      isPublished: Boolean(q.is_published),
      attemptCount: attempts.length,
      averagePercent: avgPercent,
      passRate: scored.length ? round1((passCount / scored.length) * 100) : null,
    };
  });
}

// Top-level roll-up across everything this faculty member owns — the
// number the faculty dashboard shows as one tile.
function overview(facultyId, { classSection, subject } = {}) {
  const assignmentRows = assignmentBreakdown(facultyId, { classSection, subject });
  const quizRows = quizBreakdown(facultyId, { classSection, subject });

  const totalUngraded = assignmentRows.reduce((s, a) => s + a.ungraded, 0);
  const gradedAssignmentAverages = assignmentRows.filter((a) => a.averageMarks != null).map((a) => a.averageMarks);
  const assignmentAvg = gradedAssignmentAverages.length
    ? round1(gradedAssignmentAverages.reduce((s, v) => s + v, 0) / gradedAssignmentAverages.length)
    : null;

  const quizAverages = quizRows.filter((q) => q.averagePercent != null).map((q) => q.averagePercent);
  const quizAvgPercent = quizAverages.length
    ? round1(quizAverages.reduce((s, v) => s + v, 0) / quizAverages.length)
    : null;

  return {
    assignments: { count: assignmentRows.length, totalUngraded, averageMarks: assignmentAvg, breakdown: assignmentRows },
    quizzes: { count: quizRows.length, averagePercent: quizAvgPercent, breakdown: quizRows },
  };
}

module.exports = { assignmentBreakdown, quizBreakdown, overview };
