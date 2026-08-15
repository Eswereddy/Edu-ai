// /api/student/backlog/* — add/clear/delete backlog (arrear) subjects.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const backlog = require('../backlogManager');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  res.json({ ok: true, backlogs: backlog.listBacklogs(req.user.id) });
});

router.post('/', (req, res) => {
  try {
    const entry = backlog.addBacklog(req.user.id, req.body || {});
    audit.record(req.user.id, 'create', 'student_backlog', entry.id);
    res.status(201).json({ ok: true, backlog: entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add backlog' });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const entry = backlog.updateBacklog(req.user.id, req.params.id, req.body || {});
    audit.record(req.user.id, 'update', 'student_backlog', req.params.id, { status: entry.status });
    res.json({ ok: true, backlog: entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update backlog' });
  }
});

router.post('/:id/clear', (req, res) => {
  try {
    const entry = backlog.clearBacklog(req.user.id, req.params.id);
    audit.record(req.user.id, 'clear', 'student_backlog', req.params.id);
    res.json({ ok: true, backlog: entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to clear backlog' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    backlog.deleteBacklog(req.user.id, req.params.id);
    audit.record(req.user.id, 'delete', 'student_backlog', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete backlog' });
  }
});

module.exports = router;
