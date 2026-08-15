// /api/ai-admin/code-reviewer/* — feature 3 of the AI Admin Portal
// add-on suite. AI-Admin/Admin only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const reviewer = require('../codeReviewer');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/submissions', async (req, res) => {
    try {
      const { studentId, repoUrl, code } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const submission = await reviewer.reviewSubmission({ apiKey, model, studentId, repoUrl, code });
      audit.record(req.user.id, 'create', 'code_review_submission', submission.id, { studentId, repoUrl: repoUrl || null });
      res.status(201).json({ ok: true, submission });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to review submission' });
    }
  });

  router.get('/submissions', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, submissions: reviewer.listSubmissions(studentId) });
  });

  router.get('/submissions/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const submission = reviewer.getSubmission(studentId, req.params.id);
    if (!submission) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, submission });
  });

  return router;
};
