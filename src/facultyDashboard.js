// Faculty dashboard: a single read-only aggregation endpoint, mirroring
// studentDashboard.js but for the faculty portal — today's timetable,
// pending grading count, gradebook overview, pending leave requests
// awaiting review, unread notifications, upcoming events, and the new
// faculty task/note stats. Reads only through existing module exports
// (or a plain SELECT on a table another module already owns) — nothing
// here writes to or changes any existing table or function.

const { db } = require('./db');
const timetable = require('./timetable');
const leave = require('./leave');
const events = require('./events');
const gradebook = require('./facultyGradebook');
const tasks = require('./facultyTasks');
const notes = require('./facultyNotes');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todaysClasses(facultyId) {
  const byDay = timetable.listForFaculty(facultyId);
  const today = DAY_NAMES[new Date().getDay()];
  return byDay[today] || [];
}

function notificationsSummary(facultyId) {
  const row = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(facultyId);
  return { unread: row.c };
}

function buildDashboard(facultyId, { classSection, subject } = {}) {
  const gb = gradebook.overview(facultyId, { classSection, subject });
  return {
    generatedAt: new Date().toISOString(),
    todaysClasses: todaysClasses(facultyId),
    grading: {
      pendingAssignments: gb.assignments.totalUngraded,
      assignmentCount: gb.assignments.count,
      quizCount: gb.quizzes.count,
    },
    gradebook: gb,
    leave: { pendingReviewCount: leave.listPending().length },
    notifications: notificationsSummary(facultyId),
    upcomingEvents: events.upcomingForRole('faculty', { limit: 5 }),
    tasks: tasks.taskStats(facultyId),
    notes: { count: notes.listNotes(facultyId).length },
  };
}

module.exports = { buildDashboard };
