// /api/ai-admin/live-interview/* — AI Live Interview Bot (adaptive,
// turn-by-turn, real-interview-style). AI-Admin/Admin only, matching
// every other module in the AI Admin Portal add-on suite.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const bot = require('../liveInterviewBot');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/sessions', async (req, res) => {
    try {
      const { studentId, targetRole, company, roundType, difficulty, maxTurns } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const session = await bot.startSession({ apiKey, model, studentId, targetRole, company, roundType, difficulty, maxTurns });
      audit.record(req.user.id, 'create', 'live_interview_session', session.id, { studentId, targetRole, roundType });
      res.status(201).json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to start live interview' });
    }
  });

  router.get('/sessions', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, sessions: bot.listSessions(studentId) });
  });

  router.get('/sessions/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const session = bot.getSession(studentId, req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, session });
  });

  router.post('/sessions/:id/respond', async (req, res) => {
    try {
      const { studentId, answerText } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const session = await bot.respond({ apiKey, model, studentId, sessionId: req.params.id, answerText });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to process response' });
    }
  });

  router.post('/sessions/:id/end', async (req, res) => {
    try {
      const { studentId } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const session = await bot.endSessionEarly({ apiKey, model, studentId, sessionId: req.params.id });
      audit.record(req.user.id, 'complete', 'live_interview_session', req.params.id, { overallScore: session.overall_score });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to end session' });
    }
  });

  return router;
};
