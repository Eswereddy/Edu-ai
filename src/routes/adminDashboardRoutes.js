// /api/admin/dashboard — platform-wide KPIs in one call: users by role,
// pending-approvals breakdown, attendance/fees/library/forum summaries,
// upcoming events, and recent audit activity. Read-only, admin-portal
// only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const dashboard = require('../adminDashboard');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/', (req, res) => {
  res.json({ ok: true, dashboard: dashboard.buildDashboard() });
});

module.exports = router;
