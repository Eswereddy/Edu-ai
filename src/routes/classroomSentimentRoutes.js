// /api/faculty/classroom-sentiment/* — real "Live Classroom Sentiment
// Analysis" feature for the faculty portal. Faculty-only, additive.
// The browser does the actual face-detection + expression inference
// (face-api.js / TensorFlow.js over WebRTC getUserMedia — see
// classroomSentiment.js header for the full design note); this backend
// only ever receives already-aggregated, anonymous percentages per
// reading, never video or images.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const sentiment = require('../classroomSentiment');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('faculty'));

  router.post('/', (req, res) => {
    try {
      const { classSection, subject } = req.body || {};
      const session = sentiment.startSession({ facultyId: req.user.id, classSection, subject });
      audit.record(req.user.id, 'create', 'classroom_sentiment_session', session.id, { classSection });
      res.status(201).json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to start session' });
    }
  });

  router.get('/', (req, res) => {
    res.json({ ok: true, sessions: sentiment.listSessions(req.user.id, req.query.limit) });
  });

  router.get('/:id', (req, res) => {
    try {
      res.json({ ok: true, session: sentiment.getSession(req.params.id, req.user.id) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Session not found' });
    }
  });

  router.post('/:id/samples', (req, res) => {
    try {
      const { faceCount, engagedPct, neutralPct, confusedPct, avgConfidence } = req.body || {};
      const result = sentiment.recordSample({
        sessionId: req.params.id,
        facultyId: req.user.id,
        faceCount,
        engagedPct,
        neutralPct,
        confusedPct,
        avgConfidence,
      });
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to record sample' });
    }
  });

  router.post('/:id/end', async (req, res) => {
    try {
      const session = await sentiment.endSession({ sessionId: req.params.id, facultyId: req.user.id, apiKey, model });
      audit.record(req.user.id, 'update', 'classroom_sentiment_session', session.id, { status: 'ended' });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to end session' });
    }
  });

  return router;
};
