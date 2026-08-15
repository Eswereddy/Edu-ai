// /api/admin/broadcast — create an announcement and immediately push it
// as a real-time notification to every currently-registered matching
// user. Admin-portal only (the plain, polling-only announcement route
// at POST /api/announcements remains available to faculty too,
// unchanged).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const broadcast = require('../adminBroadcast');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.post('/', (req, res) => {
  try {
    const result = broadcast.broadcast({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'broadcast', 'announcement', result.id, { targetRole: result.targetRole, notifiedCount: result.notifiedCount });
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
