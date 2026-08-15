// /api/gamification/* — points, badges, leaderboard.
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const gamification = require('../gamification');

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    total: gamification.totalPoints(req.user.id),
    history: gamification.history(req.user.id),
    badges: gamification.badgesForUser(req.user.id),
  });
});

router.get('/badges', requireAuth, (req, res) => {
  res.json({ ok: true, badges: gamification.allBadges() });
});

router.get('/leaderboard', requireAuth, (req, res) => {
  const board = gamification.leaderboard({ limit: req.query.limit });
  const withNames = board.map((entry) => {
    const user = db.prepare('SELECT name, role FROM users WHERE id = ?').get(entry.userId);
    return { ...entry, name: user?.name || 'Unknown', role: user?.role || null };
  });
  res.json({ ok: true, leaderboard: withNames });
});

// Manual award — teachers/admins recognizing participation, effort, etc.
router.post('/award', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  const { userId, points, reason } = req.body || {};
  if (!userId || !points) return res.status(400).json({ ok: false, error: 'userId and points are required' });
  const capped = Math.max(-100, Math.min(100, Number(points)));
  const result = gamification.awardPoints(userId, capped, reason || `Awarded by ${req.user.name}`);
  res.json({ ok: true, ...result });
});

module.exports = router;
