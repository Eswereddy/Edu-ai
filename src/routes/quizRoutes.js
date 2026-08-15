// /api/quiz/* — author, publish, take, and auto-grade MCQ quizzes.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const quiz = require('../quiz');
const gamification = require('../gamification');
const audit = require('../audit');

module.exports = function createQuizRouter({ apiKey, model }) {
  const router = express.Router();

  router.post('/', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
    try {
      const q = quiz.createQuiz({ ...req.body, createdBy: req.user.id });
      audit.record(req.user.id, 'create', 'quiz', q.id, { title: q.title });
      res.status(201).json({ ok: true, quiz: q });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post('/:id/questions', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
    try {
      const question = quiz.addQuestion(req.params.id, req.body || {});
      res.status(201).json({ ok: true, question });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Ask the model to draft questions; caller reviews/edits before adding
  // any of them via POST /:id/questions above (kept as two steps on
  // purpose so a bad AI question never lands in a quiz un-reviewed).
  router.post('/:id/ai-draft-questions', requireAuth, requireRole('faculty', 'admin'), async (req, res) => {
    try {
      const q = quiz.getQuiz(req.params.id);
      if (!q) return res.status(404).json({ ok: false, error: 'Quiz not found' });
      const questions = await quiz.generateQuestionsWithAI({
        apiKey,
        model,
        subject: q.subject,
        topic: req.body?.topic,
        count: req.body?.count,
        difficulty: req.body?.difficulty,
      });
      res.json({ ok: true, questions });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post('/:id/publish', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
    const q = quiz.publishQuiz(req.params.id, req.body?.published !== false);
    audit.record(req.user.id, 'publish', 'quiz', req.params.id, { published: q.is_published });
    res.json({ ok: true, quiz: q });
  });

  router.get('/section/:classSection', requireAuth, (req, res) => {
    res.json({ ok: true, quizzes: quiz.listForSection(req.params.classSection) });
  });

  router.get('/mine', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
    res.json({ ok: true, quizzes: quiz.listForCreator(req.user.id) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const q = quiz.getQuiz(req.params.id);
    if (!q) return res.status(404).json({ ok: false, error: 'Not found' });
    const isOwnerOrStaff = ['admin', 'ai-admin'].includes(req.user.role) || q.created_by === req.user.id;
    res.json({ ok: true, quiz: q, questions: quiz.listQuestions(req.params.id, { hideAnswers: !isOwnerOrStaff }) });
  });

  router.post('/:id/start', requireAuth, requireRole('student'), (req, res) => {
    const attempt = quiz.startAttempt(req.params.id, req.user.id);
    res.json({ ok: true, attempt });
  });

  router.post('/:id/submit', requireAuth, requireRole('student'), (req, res) => {
    try {
      const attempt = quiz.submitAttempt(req.params.id, req.user.id, req.body?.answers || {});
      audit.record(req.user.id, 'submit', 'quiz', req.params.id, { score: attempt.score });
      if (attempt.max_score) {
        const pct = attempt.score / attempt.max_score;
        gamification.awardPoints(req.user.id, Math.round(pct * 20), `Quiz completed: ${req.params.id}`);
      }
      res.json({ ok: true, attempt });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // NOTE: declared before /:id/attempts — otherwise ":id" would match the
  // literal segment "mine" and shadow this route (same class of bug fixed
  // in assignmentRoutes.js's /mine/submissions).
  router.get('/mine/attempts', requireAuth, requireRole('student'), (req, res) => {
    res.json({ ok: true, attempts: quiz.listAttemptsForStudent(req.user.id) });
  });

  router.get('/:id/attempts', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
    res.json({ ok: true, attempts: quiz.listAttemptsForQuiz(req.params.id) });
  });

  return router;
};
