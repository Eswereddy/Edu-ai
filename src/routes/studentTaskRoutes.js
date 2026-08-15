// /api/student/tasks/* — student's own personal to-do/planner items.
// Student-portal only: every route is locked to role 'student' and to
// the caller's own records (req.user.id), matching the ground rule for
// this pass — additive, and scoped to the student portal alone.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const tasks = require('../studentTasks');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  const includeDone = req.query.includeDone !== 'false';
  res.json({ ok: true, tasks: tasks.listTasks(req.user.id, { includeDone }), stats: tasks.taskStats(req.user.id) });
});

router.post('/', (req, res) => {
  try {
    const task = tasks.createTask({ ...req.body, studentId: req.user.id });
    audit.record(req.user.id, 'create', 'student_task', task.id, { title: task.title });
    res.status(201).json({ ok: true, task });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const task = tasks.updateTask(req.params.id, req.user.id, req.body || {});
    res.json({ ok: true, task });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/toggle', (req, res) => {
  try {
    const task = tasks.toggleDone(req.params.id, req.user.id, req.body?.isDone);
    if (task.is_done) {
      audit.record(req.user.id, 'complete', 'student_task', task.id, null);
    }
    res.json({ ok: true, task });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const removed = tasks.deleteTask(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'student_task', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
