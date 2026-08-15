// /api/parent/wellness/:studentId — Wellness & Mental Health Alerts for
// the parent portal. Read-only, parent-portal only, additive. Gated by
// parentChildren.resolveChildrenIds() exactly like parentDashboardRoutes.js
// already does, so a parent can only ever see a linked child's data.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const parentWellness = require('../parentWellnessAlerts');

const router = express.Router();
router.use(requireAuth, requireRole('parent'));

router.get('/:studentId', (req, res) => {
  try {
    res.json({ ok: true, wellness: parentWellness.wellnessForChild(req.user, req.params.studentId) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to load wellness data' });
  }
});

module.exports = router;
