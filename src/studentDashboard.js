// Student dashboard: a single read-only aggregation endpoint that pulls
// together data already sitting in the database via existing modules —
// attendance, grades/CGPA, fees, assignments, quizzes, library loans,
// notifications, gamification, events — plus the new personal-planner
// modules (tasks, notes, streak). Nothing here writes to or changes any
// existing table's schema or any existing module's functions; it only
// *reads* through the exports those modules already expose (or, where a
// module only exposes routes today, via a plain read-only SELECT on the
// same tables `dataRoutes.js` already reads from).
//
// `classSection` is optional context the frontend already knows about a
// student (same pattern used by `studyPlanner.generatePlan`) — sections
// of the dashboard that depend on it are simply omitted if it's not
// supplied, so this stays fully backward compatible with callers that
// don't pass it yet.

const { db } = require('./db');
const assignments = require('./assignments');
const quiz = require('./quiz');
const library = require('./library');
const gamification = require('./gamification');
const events = require('./events');
const academics = require('./academics');
const tasks = require('./studentTasks');
const notes = require('./studentNotes');
const streak = require('./studentStreak');

const LOW_ATTENDANCE_THRESHOLD = Number(process.env.LOW_ATTENDANCE_THRESHOLD || 75);
const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS || 3);

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function attendanceSummary(studentId) {
  const rows = db.prepare('SELECT subject, status FROM attendance WHERE student_id = ?').all(studentId);
  const bySubject = new Map();
  for (const r of rows) {
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, { subject: r.subject, present: 0, total: 0 });
    const entry = bySubject.get(r.subject);
    entry.total += 1;
    if (r.status === 'present') entry.present += 1;
  }
  const perSubject = [...bySubject.values()].map((e) => ({
    ...e,
    percent: e.total ? Math.round((e.present / e.total) * 1000) / 10 : null,
  }));
  const totalPresent = rows.filter((r) => r.status === 'present').length;
  const overallPercent = rows.length ? Math.round((totalPresent / rows.length) * 1000) / 10 : null;
  const lowAttendanceSubjects = perSubject.filter((e) => e.percent != null && e.percent < LOW_ATTENDANCE_THRESHOLD);
  return { overallPercent, perSubject, lowAttendanceSubjects, threshold: LOW_ATTENDANCE_THRESHOLD };
}

function feesSummary(studentId) {
  const rows = db.prepare('SELECT * FROM fees WHERE student_id = ? ORDER BY due_date ASC').all(studentId);
  const pending = rows.filter((r) => r.status !== 'paid');
  const totalDue = pending.reduce((s, r) => s + r.amount, 0);
  return { pendingCount: pending.length, totalDue, nextDue: pending[0] || null };
}

function assignmentsSummary(studentId, classSection) {
  if (!classSection) return { available: false };
  const list = assignments.listForSection(classSection);
  const dueSoonCutoff = daysFromNow(DUE_SOON_DAYS);
  const pending = list.filter((a) => {
    const submission = assignments.getSubmission(a.id, studentId);
    return !submission;
  });
  const dueSoon = pending.filter((a) => a.due_date && a.due_date <= dueSoonCutoff);
  return { available: true, pendingCount: pending.length, dueSoon };
}

function quizzesSummary(studentId, classSection) {
  if (!classSection) return { available: false };
  const list = quiz.listForSection(classSection); // already published-only
  const attempts = quiz.listAttemptsForStudent(studentId);
  const attemptedIds = new Set(attempts.map((a) => a.quiz_id));
  const notAttempted = list.filter((q) => !attemptedIds.has(q.id));
  return { available: true, notAttemptedCount: notAttempted.length, notAttempted };
}

function librarySummary(studentId) {
  const loans = library.listIssuesForStudent(studentId);
  const active = loans.filter((l) => !l.returned_at);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = active.filter((l) => l.due_at && l.due_at < today);
  return { activeLoans: active.length, overdue };
}

function academicsSummary(studentId) {
  try {
    const transcript = academics.transcriptFor(studentId);
    return { cgpa: transcript.cgpa, semesterCount: transcript.semesters.length };
  } catch (_e) {
    return { cgpa: null, semesterCount: 0 };
  }
}

function notificationsSummary(studentId) {
  const row = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(studentId);
  return { unread: row.c };
}

function buildDashboard(studentId, { classSection } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    attendance: attendanceSummary(studentId),
    fees: feesSummary(studentId),
    assignments: assignmentsSummary(studentId, classSection),
    quizzes: quizzesSummary(studentId, classSection),
    library: librarySummary(studentId),
    academics: academicsSummary(studentId),
    notifications: notificationsSummary(studentId),
    gamification: { points: gamification.totalPoints(studentId) },
    upcomingEvents: events.upcomingForRole('student', { limit: 5 }),
    tasks: tasks.taskStats(studentId),
    notes: { count: notes.listNotes(studentId).length, bookmarked: notes.listNotes(studentId, { bookmarkedOnly: true }).length },
    streak: streak.getStreak(studentId),
  };
}

module.exports = { buildDashboard, LOW_ATTENDANCE_THRESHOLD, DUE_SOON_DAYS };
