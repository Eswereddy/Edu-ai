// /api/assignments/* — post, submit, grade, and track coursework.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const assignments = require('../assignments');
const gamification = require('../gamification');
const audit = require('../audit');
const notify = require('../notify'); // additive: real-time push on grading

const router = express.Router();

router.post('/', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const a = assignments.createAssignment({ ...req.body, facultyId: req.user.id });
    audit.record(req.user.id, 'create', 'assignment', a.id, { title: a.title });
    res.status(201).json({ ok: true, assignment: a });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/section/:classSection', requireAuth, (req, res) => {
  res.json({ ok: true, assignments: assignments.listForSection(req.params.classSection) });
});

router.get('/mine', requireAuth, requireRole('faculty'), (req, res) => {
  const list = assignments.listForFaculty(req.user.id).map((a) => ({ ...a, stats: assignments.assignmentStats(a.id) }));
  res.json({ ok: true, assignments: list });
});

router.get('/:id', requireAuth, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, assignment: a });
});

router.delete('/:id', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const removed = assignments.deleteAssignment(req.params.id, req.user.role === 'faculty' ? req.user.id : null);
    if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
    audit.record(req.user.id, 'delete', 'assignment', req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------- Submissions
router.post('/:id/submit', requireAuth, requireRole('student'), (req, res) => {
  try {
    const submission = assignments.submit({
      assignmentId: req.params.id,
      studentId: req.user.id,
      content: req.body?.content,
      uploadId: req.body?.uploadId,
    });
    audit.record(req.user.id, 'submit', 'assignment', req.params.id, null);
    res.status(201).json({ ok: true, submission });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// NOTE: literal routes like /mine/submissions must be declared before the
// parameterized /:id/submissions routes below — otherwise Express matches
// ":id" = "mine" first and this route becomes unreachable.
router.get('/mine/submissions', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, submissions: assignments.listSubmissionsForStudent(req.user.id) });
});

router.get('/:id/submissions', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  res.json({ ok: true, submissions: assignments.listSubmissions(req.params.id), stats: assignments.assignmentStats(req.params.id) });
});

router.get('/:id/submissions/me', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, submission: assignments.getSubmission(req.params.id, req.user.id) });
});

router.post('/:id/submissions/:studentId/grade', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const submission = assignments.grade({
      assignmentId: req.params.id,
      studentId: req.params.studentId,
      marks: req.body?.marks,
      feedback: req.body?.feedback,
    });
    audit.record(req.user.id, 'grade', 'assignment_submission', `${req.params.id}:${req.params.studentId}`, { marks: submission.marks });
    // Reward timely, well-graded work with a few gamification points.
    if (submission.marks != null) {
      gamification.awardPoints(req.params.studentId, Math.max(1, Math.round(submission.marks / 10)), `Graded: assignment ${req.params.id}`);
    }
    notify.send(req.params.studentId, {
      title: 'Assignment graded',
      body: submission.marks != null ? `You scored ${submission.marks} marks.` : 'Your submission was reviewed.',
      type: 'assignment_graded',
      meta: { assignmentId: req.params.id, marks: submission.marks },
    });
    res.json({ ok: true, submission });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
