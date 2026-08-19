// /api/student/interview-coach/* — Student self-service AI Interview Bot
// + DSA Practice. Fully additive: new file, new routes, student role
// only. Reuses the existing liveInterviewBot.js (turn-by-turn AI mock
// interview with adaptive difficulty + a post-interview AI recommendation
// report) and interviewMasteryCoach.js (AI-generated DSA practice
// problems + attempt grading) modules, which already exist and were
// previously wired only into the AI Admin Portal (admin/ai-admin roles).
// Nothing in those files, or any existing route file, is changed here —
// this just gives the logged-in student direct access to their own data
// (studentId is always taken from req.user.id, never from the request
// body/query, so a student can only ever see their own sessions/problems).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const bot = require('../liveInterviewBot');
const coach = require('../interviewMasteryCoach');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('student'));

  // ---------------- AI Live Interview Bot ----------------
  router.post('/live-interview/sessions', async (req, res) => {
    try {
      const studentId = req.user.id;
      const { targetRole, company, roundType, difficulty, maxTurns } = req.body || {};
      if (!targetRole) return res.status(400).json({ ok: false, error: 'targetRole is required' });
      const session = await bot.startSession({ apiKey, model, studentId, targetRole, company, roundType, difficulty, maxTurns });
      audit.record(studentId, 'create', 'live_interview_session', session.id, { targetRole, roundType });
      res.status(201).json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to start interview' });
    }
  });

  router.get('/live-interview/sessions', (req, res) => {
    res.json({ ok: true, sessions: bot.listSessions(req.user.id) });
  });

  router.get('/live-interview/sessions/:id', (req, res) => {
    const session = bot.getSession(req.user.id, req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, session });
  });

  router.post('/live-interview/sessions/:id/respond', async (req, res) => {
    try {
      const { answerText } = req.body || {};
      const session = await bot.respond({ apiKey, model, studentId: req.user.id, sessionId: req.params.id, answerText });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to submit answer' });
    }
  });

  router.post('/live-interview/sessions/:id/end', async (req, res) => {
    try {
      const session = await bot.endSessionEarly({ apiKey, model, studentId: req.user.id, sessionId: req.params.id });
      audit.record(req.user.id, 'update', 'live_interview_session', req.params.id, { action: 'ended_early' });
      res.json({ ok: true, session });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to end interview' });
    }
  });

  // ---------------- AI DSA Practice (defaults to 'easy') ----------------
  router.post('/dsa/problems', async (req, res) => {
    try {
      const studentId = req.user.id;
      const { topic, difficulty } = req.body || {};
      const problem = await coach.generateDsaProblem({ apiKey, model, studentId, topic, difficulty: difficulty || 'easy' });
      audit.record(studentId, 'create', 'dsa_practice_problem', problem.id, { topic, difficulty: difficulty || 'easy' });
      res.status(201).json({ ok: true, problem });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate DSA problem' });
    }
  });

  router.get('/dsa/problems', (req, res) => {
    res.json({ ok: true, problems: coach.listDsaProblems(req.user.id) });
  });

  router.get('/dsa/problems/:id', (req, res) => {
    const problem = coach.getDsaProblem(req.user.id, req.params.id);
    if (!problem) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, problem });
  });

  router.post('/dsa/problems/:id/attempt', async (req, res) => {
    try {
      const studentId = req.user.id;
      const { approachText, code } = req.body || {};
      const problem = await coach.gradeDsaAttempt({ apiKey, model, studentId, problemId: req.params.id, approachText, code });
      res.json({ ok: true, problem });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to grade attempt' });
    }
  });

  return router;
};
