// /api/reports/* — CSV export of core datasets for admins (no new
// dependency needed — CSV is simple enough to build by hand and this
// avoids pulling in a library just for comma-escaping).
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}

router.get('/attendance.csv', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  const rows = db.prepare('SELECT * FROM attendance ORDER BY date DESC').all();
  sendCsv(res, 'attendance.csv', rows);
});

router.get('/grades.csv', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  const rows = db.prepare('SELECT * FROM grades ORDER BY created_at DESC').all();
  sendCsv(res, 'grades.csv', rows);
});

router.get('/fees.csv', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM fees ORDER BY created_at DESC').all();
  sendCsv(res, 'fees.csv', rows);
});

router.get('/library-issues.csv', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM library_issues ORDER BY issued_at DESC').all();
  sendCsv(res, 'library-issues.csv', rows);
});

router.get('/quiz-attempts.csv', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  const rows = db.prepare('SELECT * FROM quiz_attempts ORDER BY started_at DESC').all();
  sendCsv(res, 'quiz-attempts.csv', rows);
});

router.get('/users.csv', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC').all();
  sendCsv(res, 'users.csv', rows);
});

// Aggregate dashboard numbers (JSON, not CSV) — a quick "state of the
// platform" summary for the admin overview page.
router.get('/summary', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const count = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
  res.json({
    ok: true,
    summary: {
      users: count('users'),
      assignments: count('assignments'),
      submissions: count('assignment_submissions'),
      quizzes: count('quizzes'),
      quizAttempts: count('quiz_attempts'),
      libraryBooks: count('library_books'),
      activeLoans: db.prepare('SELECT COUNT(*) c FROM library_issues WHERE returned_at IS NULL').get().c,
      forumThreads: count('forum_threads'),
      events: count('events'),
      messages: count('direct_messages'),
    },
  });
});

module.exports = router;
