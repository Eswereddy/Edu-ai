// /api/ai-admin/career-simulator/* — feature 4 of the AI Admin Portal
// add-on suite. AI-Admin/Admin only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const sim = require('../careerSimulator');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/runs', async (req, res) => {
    try {
      const { studentId, skills, cgpa, projectsCount, internshipsCount, trials } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const run = await sim.simulateAndSave({ apiKey, model, studentId, skills, cgpa, projectsCount, internshipsCount, trials });
      audit.record(req.user.id, 'create', 'career_sim_run', run.id, { studentId, trials: run.trials });
      res.status(201).json({ ok: true, run });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to run simulation' });
    }
  });

  router.get('/runs', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, runs: sim.listRuns(studentId) });
  });

  router.get('/runs/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const run = sim.getRun(studentId, req.params.id);
    if (!run) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, run });
  });

  return router;
};
