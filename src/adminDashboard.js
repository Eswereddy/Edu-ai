// Admin dashboard: platform-wide KPIs in one call. Reads only — through
// existing module exports where available, or a plain SELECT on a table
// another module already owns (same approach as the existing
// GET /api/admin/overview in dataRoutes.js, which this is a richer,
// additive companion to — that route is untouched). Nothing here writes
// to or changes any existing table or function.

const { db } = require('./db');
const approvals = require('./adminApprovals');
const library = require('./library');
const forum = require('./forum');
const events = require('./events');
const audit = require('./audit');

function usersByRole() {
  return db.prepare('SELECT role, COUNT(*) as count FROM users GROUP BY role').all();
}

function attendanceSummary() {
  const rows = db.prepare('SELECT status FROM attendance').all();
  const present = rows.filter((r) => r.status === 'present').length;
  return {
    totalRecords: rows.length,
    overallPercent: rows.length ? Math.round((present / rows.length) * 1000) / 10 : null,
  };
}

function feesSummary() {
  const row = db.prepare("SELECT COALESCE(SUM(amount),0) total, COUNT(*) c FROM fees WHERE status = 'paid'").get();
  const pendingRow = db.prepare("SELECT COALESCE(SUM(amount),0) total, COUNT(*) c FROM fees WHERE status != 'paid'").get();
  return {
    collected: row.total,
    collectedCount: row.c,
    pending: pendingRow.total,
    pendingCount: pendingRow.c,
  };
}

function librarySummary() {
  const overdue = library.listOverdue();
  const active = library.listActiveIssues();
  return { activeLoans: active.length, overdueLoans: overdue.length };
}

function forumSummary() {
  const threads = forum.listThreads({ limit: 500 });
  return { totalThreads: threads.length, lockedThreads: threads.filter((t) => t.is_locked).length };
}

function buildDashboard() {
  const inbox = approvals.inbox();
  return {
    generatedAt: new Date().toISOString(),
    users: usersByRole(),
    approvals: { total: inbox.total, byKind: inbox.byKind },
    attendance: attendanceSummary(),
    fees: feesSummary(),
    library: librarySummary(),
    forum: forumSummary(),
    upcomingEvents: events.upcomingForRole('all', { limit: 5 }),
    recentActivity: audit.recent({ limit: 15 }),
  };
}

module.exports = { buildDashboard };
