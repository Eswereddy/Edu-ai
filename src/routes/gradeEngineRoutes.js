// /api/grade-engine/* — SGPA batch comparison + risk assessment.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const gradeEngine = require('../gradeEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/batch-comparison/:semesterId', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, comparison: gradeEngine.batchComparison(req.params.semesterId) });
});

router.get('/risk/:semesterId/mine', requireRole('student'), (req, res) => {
  res.json({ ok: true, risk: gradeEngine.riskAssessment(req.user.id, req.params.semesterId) });
});

router.get('/risk/:semesterId/:studentId', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, risk: gradeEngine.riskAssessment(req.params.studentId, req.params.semesterId) });
});

router.get('/risk/:semesterId', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, risks: gradeEngine.riskAssessmentForSemester(req.params.semesterId) });
});

module.exports = router;
