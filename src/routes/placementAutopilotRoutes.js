// /api/ai-admin/placement-autopilot/* — feature 2 of the AI Admin
// Portal add-on suite. AI-Admin/Admin only. "Apply" is explicitly
// simulated (see placementAutopilot.js header) — no external request
// is ever sent to a job board.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const autopilot = require('../placementAutopilot');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/matches', async (req, res) => {
    try {
      const { studentId, studentName, company, roleTitle, jobDescription, studentSkills } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const match = await autopilot.matchAndDraft({ apiKey, model, studentId, studentName, company, roleTitle, jobDescription, studentSkills });
      audit.record(req.user.id, 'create', 'autopilot_match', match.id, { studentId, company, roleTitle });
      res.status(201).json({ ok: true, match });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate match' });
    }
  });

  router.get('/matches', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, matches: autopilot.listMatches(studentId) });
  });

  router.post('/matches/:id/apply', (req, res) => {
    try {
      const { studentId } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const match = autopilot.simulateApply(studentId, req.params.id);
      audit.record(req.user.id, 'simulate_apply', 'autopilot_match', req.params.id, { studentId });
      res.json({ ok: true, match, note: 'Simulated — no external application was sent.' });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to mark as applied' });
    }
  });

  return router;
};
