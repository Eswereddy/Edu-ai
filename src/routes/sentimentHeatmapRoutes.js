// /api/ai-admin/sentiment-heatmap/* — feature 10 of the AI Admin
// Portal add-on suite. AI-Admin/Admin only. Reads existing
// mood-checkin/forum data read-only — see sentimentHeatmap.js header.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const heatmap = require('../sentimentHeatmap');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/snapshots', async (req, res) => {
    try {
      const { windowDays } = req.body || {};
      const snapshot = await heatmap.computeSnapshot({ apiKey, model, windowDays, createdBy: req.user.id });
      audit.record(req.user.id, 'create', 'sentiment_snapshot', snapshot.id, { gauge: snapshot.gauge });
      res.status(201).json({ ok: true, snapshot });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to compute snapshot' });
    }
  });

  router.get('/latest', (req, res) => {
    res.json({ ok: true, snapshot: heatmap.latestSnapshot() });
  });

  router.get('/history', (req, res) => {
    res.json({ ok: true, history: heatmap.history(req.query.limit) });
  });

  return router;
};
