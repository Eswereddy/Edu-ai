// /api/study-plan/* — AI-generated, data-grounded weekly study schedules.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const studyPlanner = require('../studyPlanner');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();

  router.post('/generate', requireAuth, requireRole('student'), async (req, res) => {
    try {
      const plan = await studyPlanner.generatePlan({
        apiKey,
        model,
        studentId: req.user.id,
        classSection: req.body?.classSection || null,
        preferences: req.body?.preferences || null,
      });
      audit.record(req.user.id, 'generate', 'study_plan', plan.id, { aiGenerated: plan.aiGenerated });
      res.status(201).json({ ok: true, plan });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate study plan' });
    }
  });

  router.get('/', requireAuth, requireRole('student'), (req, res) => {
    res.json({ ok: true, plans: studyPlanner.listPlans(req.user.id, req.query.limit) });
  });

  router.get('/:id', requireAuth, requireRole('student'), (req, res) => {
    const plan = studyPlanner.getPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, plan });
  });

  return router;
};
