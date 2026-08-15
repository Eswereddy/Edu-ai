// /api/faculty/gradebook — read-only analytics across this faculty
// member's own assignments and quizzes: per-item stats plus an overview
// roll-up. Faculty-portal only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const gradebook = require('../facultyGradebook');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/', (req, res) => {
  const { classSection, subject } = req.query;
  res.json({ ok: true, gradebook: gradebook.overview(req.user.id, { classSection, subject }) });
});

router.get('/assignments', (req, res) => {
  const { classSection, subject } = req.query;
  res.json({ ok: true, assignments: gradebook.assignmentBreakdown(req.user.id, { classSection, subject }) });
});

router.get('/quizzes', (req, res) => {
  const { classSection, subject } = req.query;
  res.json({ ok: true, quizzes: gradebook.quizBreakdown(req.user.id, { classSection, subject }) });
});

module.exports = router;
