// /api/student/wellness/* — goals with progress bars + mood check-ins.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const wellness = require('../wellness');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/goals', (req, res) => {
  res.json({ ok: true, goals: wellness.listGoals(req.user.id) });
});

router.post('/goals', (req, res) => {
  try {
    const goal = wellness.addGoal(req.user.id, req.body || {});
    audit.record(req.user.id, 'create', 'student_goal', goal.id);
    res.status(201).json({ ok: true, goal });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add goal' });
  }
});

router.patch('/goals/:id', (req, res) => {
  try {
    const goal = wellness.updateGoal(req.user.id, req.params.id, req.body || {});
    audit.record(req.user.id, 'update', 'student_goal', req.params.id);
    res.json({ ok: true, goal });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update goal' });
  }
});

router.delete('/goals/:id', (req, res) => {
  try {
    wellness.deleteGoal(req.user.id, req.params.id);
    audit.record(req.user.id, 'delete', 'student_goal', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete goal' });
  }
});

router.post('/mood', (req, res) => {
  try {
    const checkin = wellness.checkInMood(req.user.id, req.body || {});
    res.json({ ok: true, checkin });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to save mood check-in' });
  }
});

router.get('/mood', (req, res) => {
  res.json({ ok: true, history: wellness.moodHistory(req.user.id, req.query.days) });
});

module.exports = router;
