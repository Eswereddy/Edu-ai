// /api/admin/approvals — one call, every pending approval across the
// platform (leave, certificates, admissions, parent-child links).
// Read-only; reviewing still happens through each item's own existing
// route. Admin-portal only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const approvals = require('../adminApprovals');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/', (req, res) => {
  res.json({ ok: true, approvals: approvals.inbox() });
});

module.exports = router;
