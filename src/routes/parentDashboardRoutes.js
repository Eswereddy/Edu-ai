// /api/parent/dashboard — overview of all linked children; /:studentId
// for full detail on one. Access is gated by
// parentChildren.resolveChildrenIds(), which only trusts the legacy
// linked_student_id column plus admin/faculty-approved link requests.
// Parent-portal only, read-only, additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const dashboard = require('../parentDashboard');

const router = express.Router();
router.use(requireAuth, requireRole('parent'));

router.get('/', (req, res) => {
  res.json({ ok: true, dashboard: dashboard.overviewForParent(req.user) });
});

router.get('/:studentId', (req, res) => {
  try {
    res.json({ ok: true, dashboard: dashboard.detailForChild(req.user, req.params.studentId) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build dashboard' });
  }
});

module.exports = router;
