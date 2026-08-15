// /api/transport/live/* — Live Bus GPS Tracking. Additional router
// mounted alongside the existing transportRoutes.js (same pattern as
// payrollRoutes + payrollTaxRoutes both mounting under /api/payroll) —
// distinct sub-paths, so nothing here can collide with existing routes.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const bus = require('../busTracking');

const router = express.Router();

// Anyone authenticated (student, parent, faculty, admin) can view a
// route's live position — mirrors how /api/transport/routes is already
// open to any authenticated user.
router.get('/live/:routeId', requireAuth, (req, res) => {
  try {
    res.json({ ok: true, live: bus.liveForRoute(req.params.routeId) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Convenience for the parent portal: resolve a student's active
// transport subscription and return that route's live position in one
// call, instead of requiring two round trips.
router.get('/live-for-student/:studentId', requireAuth, requireRole('parent', 'admin', 'ai-admin', 'faculty'), (req, res) => {
  const live = bus.liveForStudent(req.params.studentId);
  if (!live) return res.status(404).json({ ok: false, error: 'No active transport subscription for this student' });
  res.json({ ok: true, live });
});

// Driver/admin/faculty reports a real position update for a route.
router.post('/live/:routeId', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const location = bus.reportLocation(req.params.routeId, { ...req.body, reportedBy: req.user.id });
    res.json({ ok: true, location });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
