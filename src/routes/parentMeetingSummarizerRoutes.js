// /api/ai-admin/parent-meeting-summarizer/* — feature 8 of the AI
// Admin Portal add-on suite. AI-Admin/Admin only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const summarizer = require('../parentMeetingSummarizer');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/summaries', async (req, res) => {
    try {
      const { chatLog, meetingRef, studentName } = req.body || {};
      const summary = await summarizer.summarize({ apiKey, model, chatLog, meetingRef, studentName, createdBy: req.user.id });
      audit.record(req.user.id, 'create', 'parent_meeting_summary', summary.id, { meetingRef: meetingRef || null });
      res.status(201).json({ ok: true, summary });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to summarize meeting' });
    }
  });

  router.get('/summaries', (req, res) => {
    res.json({ ok: true, summaries: summarizer.listSummaries({ meetingRef: req.query.meetingRef }) });
  });

  router.get('/summaries/:id', (req, res) => {
    const summary = summarizer.getSummary(req.params.id);
    if (!summary) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, summary });
  });

  return router;
};
