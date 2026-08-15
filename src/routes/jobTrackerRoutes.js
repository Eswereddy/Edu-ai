// /api/student/job-tracker/* — personal job application tracker
// (Applied -> Interview -> Offer/Rejected/Withdrawn).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const jobTracker = require('../jobTracker');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  res.json({ ok: true, entries: jobTracker.listEntries(req.user.id, { status: req.query.status }) });
});

router.get('/summary', (req, res) => {
  res.json({ ok: true, summary: jobTracker.summary(req.user.id) });
});

router.post('/', (req, res) => {
  try {
    const entry = jobTracker.addEntry(req.user.id, req.body || {});
    audit.record(req.user.id, 'create', 'job_tracker_entry', entry.id);
    res.status(201).json({ ok: true, entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add entry' });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const entry = jobTracker.updateStatus(req.user.id, req.params.id, req.body?.status);
    audit.record(req.user.id, 'update_status', 'job_tracker_entry', req.params.id, { status: req.body?.status });
    res.json({ ok: true, entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update status' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    jobTracker.deleteEntry(req.user.id, req.params.id);
    audit.record(req.user.id, 'delete', 'job_tracker_entry', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete entry' });
  }
});

module.exports = router;
