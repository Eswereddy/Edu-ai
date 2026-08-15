// /api/student/dashboard — one call, everything a student's home screen
// needs: attendance (with low-attendance flags), pending assignments,
// unattempted quizzes, library dues, fees due, CGPA snapshot, unread
// notifications, gamification points, upcoming events, personal task/
// note/streak stats. Student-portal only, read-only, additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const dashboard = require('../studentDashboard');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  try {
    const summary = dashboard.buildDashboard(req.user.id, { classSection: req.query.classSection || null });
    res.json({ ok: true, dashboard: summary });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build dashboard' });
  }
});

module.exports = router;
