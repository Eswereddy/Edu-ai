// Parent dashboard: read-only aggregation for the parent's children,
// resolved via parentChildren.resolveChildrenIds() (the legacy
// linked_student_id column plus any admin/faculty-approved
// parent_child_links). Mirrors the shape of studentDashboard.js /
// facultyDashboard.js — reads through existing module exports (or a
// plain SELECT on a table another module already owns) only. Nothing
// here writes to or changes any existing table or function.

const { db } = require('./db');
const library = require('./library');
const academics = require('./academics');
const gamification = require('./gamification');
const events = require('./events');
const leave = require('./leave');
const parentChildren = require('./parentChildren');

function attendanceSummary(studentId) {
  const rows = db.prepare('SELECT status FROM attendance WHERE student_id = ?').all(studentId);
  const present = rows.filter((r) => r.status === 'present').length;
  return {
    overallPercent: rows.length ? Math.round((present / rows.length) * 1000) / 10 : null,
    totalRecords: rows.length,
  };
}

function feesSummary(studentId) {
  const rows = db.prepare('SELECT * FROM fees WHERE student_id = ? ORDER BY due_date ASC').all(studentId);
  const pending = rows.filter((r) => r.status !== 'paid');
  return {
    pendingCount: pending.length,
    totalDue: pending.reduce((s, r) => s + r.amount, 0),
    nextDue: pending[0] || null,
  };
}

function academicsSummary(studentId) {
  try {
    const transcript = academics.transcriptFor(studentId);
    return { cgpa: transcript.cgpa, semesterCount: transcript.semesters.length };
  } catch (_e) {
    return { cgpa: null, semesterCount: 0 };
  }
}

function librarySummary(studentId) {
  const loans = library.listIssuesForStudent(studentId);
  const active = loans.filter((l) => !l.returned_at);
  const today = new Date().toISOString().slice(0, 10);
  return { activeLoans: active.length, overdue: active.filter((l) => l.due_at && l.due_at < today) };
}

function recentGrades(studentId, limit = 5) {
  return db.prepare('SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC LIMIT ?').all(studentId, limit);
}

function studentBasics(studentId) {
  return db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(studentId) || { id: studentId };
}

// One card per child — used for the "all my children" overview.
function childCard(studentId) {
  return {
    student: studentBasics(studentId),
    attendance: attendanceSummary(studentId),
    fees: feesSummary(studentId),
    academics: academicsSummary(studentId),
    gamificationPoints: gamification.totalPoints(studentId),
  };
}

// Full detail for one child, plus the parent's own notifications/events.
function childDetail(studentId) {
  return {
    student: studentBasics(studentId),
    attendance: attendanceSummary(studentId),
    fees: feesSummary(studentId),
    academics: academicsSummary(studentId),
    recentGrades: recentGrades(studentId),
    library: librarySummary(studentId),
    gamificationPoints: gamification.totalPoints(studentId),
    recentLeaveRequests: leave.listForUser(studentId).slice(0, 5),
  };
}

function overviewForParent(parentUser) {
  const childIds = parentChildren.resolveChildrenIds(parentUser);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(parentUser.id).c;
  return {
    generatedAt: new Date().toISOString(),
    children: childIds.map(childCard),
    notifications: { unread },
    upcomingEvents: events.upcomingForRole('parent', { limit: 5 }),
  };
}

function detailForChild(parentUser, studentId) {
  const childIds = parentChildren.resolveChildrenIds(parentUser);
  if (!childIds.includes(studentId)) {
    const err = new Error('Not authorized for this student');
    err.status = 403;
    throw err;
  }
  return { generatedAt: new Date().toISOString(), ...childDetail(studentId) };
}

module.exports = { overviewForParent, detailForChild };
