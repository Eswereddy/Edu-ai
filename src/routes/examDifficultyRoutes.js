// /api/ai-admin/exam-difficulty/* — feature 7 of the AI Admin Portal
// add-on suite. AI-Admin/Admin only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const analyzer = require('../examDifficultyAnalyzer');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/reports', async (req, res) => {
    try {
      const { subject, examRef, questions } = req.body || {};
      const report = await analyzer.analyzePaper({ apiKey, model, subject, examRef, questions, createdBy: req.user.id });
      audit.record(req.user.id, 'create', 'exam_difficulty_report', report.id, { subject, examRef: examRef || null });
      res.status(201).json({ ok: true, report });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to analyze paper' });
    }
  });

  router.get('/reports', (req, res) => {
    res.json({ ok: true, reports: analyzer.listReports({ subject: req.query.subject }) });
  });

  router.get('/reports/:id', (req, res) => {
    const report = analyzer.getReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, report });
  });

  return router;
};
