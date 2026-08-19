// /api/ai-admin/interview-mastery/* — AI Interview & Career Mastery Coach
// (DSA logic practice, presentation skills coaching, interview round
// strategy). AI-Admin/Admin only, matching every other module in the
// AI Admin Portal add-on suite (see interviewMasteryCoach.js for why).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const coach = require('../interviewMasteryCoach');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  // --- DSA practice ---
  router.post('/dsa/problems', async (req, res) => {
    try {
      const { studentId, topic, difficulty } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const problem = await coach.generateDsaProblem({ apiKey, model, studentId, topic, difficulty });
      audit.record(req.user.id, 'create', 'dsa_practice_problem', problem.id, { studentId, topic, difficulty });
      res.status(201).json({ ok: true, problem });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate DSA problem' });
    }
  });

  router.get('/dsa/problems', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, problems: coach.listDsaProblems(studentId) });
  });

  router.get('/dsa/problems/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const problem = coach.getDsaProblem(studentId, req.params.id);
    if (!problem) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, problem });
  });

  router.post('/dsa/problems/:id/attempt', async (req, res) => {
    try {
      const { studentId, approachText, code } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const problem = await coach.gradeDsaAttempt({ apiKey, model, studentId, problemId: req.params.id, approachText, code });
      res.json({ ok: true, problem });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to grade attempt' });
    }
  });

  // --- Presentation skills ---
  router.post('/presentation/reviews', async (req, res) => {
    try {
      const { studentId, topic, audience, durationMinutes, draftText } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const review = await coach.reviewPresentation({ apiKey, model, studentId, topic, audience, durationMinutes, draftText });
      audit.record(req.user.id, 'create', 'presentation_review', review.id, { studentId, topic });
      res.status(201).json({ ok: true, review });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to review presentation' });
    }
  });

  router.get('/presentation/reviews', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, reviews: coach.listPresentationReviews(studentId) });
  });

  router.get('/presentation/reviews/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const review = coach.getPresentationReview(studentId, req.params.id);
    if (!review) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, review });
  });

  // --- Interview round strategy ---
  router.post('/round-strategy', async (req, res) => {
    try {
      const { studentId, company, targetRole, roundType, experienceLevel } = req.body || {};
      if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
      const strategy = await coach.generateRoundStrategy({ apiKey, model, studentId, company, targetRole, roundType, experienceLevel });
      audit.record(req.user.id, 'create', 'interview_round_strategy', strategy.id, { studentId, targetRole, roundType });
      res.status(201).json({ ok: true, strategy });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate round strategy' });
    }
  });

  router.get('/round-strategy', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    res.json({ ok: true, strategies: coach.listRoundStrategies(studentId) });
  });

  router.get('/round-strategy/:id', (req, res) => {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId query param is required' });
    const strategy = coach.getRoundStrategy(studentId, req.params.id);
    if (!strategy) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, strategy });
  });

  return router;
};
