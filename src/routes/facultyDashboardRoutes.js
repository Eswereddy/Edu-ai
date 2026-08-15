// /api/faculty/dashboard — one call, everything a faculty member's home
// screen needs: today's timetable, pending grading count, a gradebook
// overview, pending leave requests awaiting review, unread
// notifications, upcoming events, personal task/note stats.
// Faculty-portal only, read-only, additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const dashboard = require('../facultyDashboard');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/', (req, res) => {
  try {
    const summary = dashboard.buildDashboard(req.user.id, {
      classSection: req.query.classSection || null,
      subject: req.query.subject || null,
    });
    res.json({ ok: true, dashboard: summary });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build dashboard' });
  }
});

module.exports = router;
