// /api/ai-admin/interview-lab/* — AI Interview Orchestrator (feature 1
// of the AI Admin Portal add-on suite). AI-Admin/Admin only, matching
// every other module added in this pass. studentId is passed in the
// body/query so an AI-Admin can run or review a lab session for any
// student (e.g. while configuring the feature or reviewing coaching
// outcomes) without needing a separate student-facing surface.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const lab = require('../interviewLab');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/sessions', async (req, res) => {
    try {
      const { studentId, targetRole, difficulty, voiceMode, questionCount } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const session = await lab.createSession({ apiKey, model, studentId, targetRole, difficulty, voiceMode, questionCount });
      audit.record(req.user.id, 'create', 'interview_lab_session', session.id, { studentId, targetRole });
      res.status(201).json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to create session' });
    }
  });

  router.get('/sessions', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, sessions: lab.listSessions(studentId) });
  });

  router.get('/sessions/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const session = lab.getSession(studentId, req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, session });
  });

  router.post('/sessions/:id/answer', async (req, res) => {
    try {
      const { studentId, questionId, answerText } = req.body || {};
      if (!studentId || !questionId) return res.status(400).json({ ok: false, error: 'studentId and questionId are required' });
      const session = await lab.submitAnswer({ apiKey, model, studentId, sessionId: req.params.id, questionId, answerText });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to grade answer' });
    }
  });

  router.post('/sessions/:id/complete', async (req, res) => {
    try {
      const { studentId } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const session = await lab.completeSession({ apiKey, model, studentId, sessionId: req.params.id });
      audit.record(req.user.id, 'complete', 'interview_lab_session', req.params.id, { overallScore: session.overall_score });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to complete session' });
    }
  });

  return router;
};
