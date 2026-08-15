// /api/student/streak/* — daily check-in / study streak tracker.
// Student-portal only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const streak = require('../studentStreak');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  res.json({ ok: true, streak: streak.getStreak(req.user.id) });
});

router.post('/checkin', (req, res) => {
  res.json({ ok: true, streak: streak.checkIn(req.user.id) });
});

module.exports = router;
