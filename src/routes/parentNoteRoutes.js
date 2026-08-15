// /api/parent/reminders/* — parent's own personal reminders (fee due
// dates, PTM dates, etc). Parent-portal only, scoped to the caller's own
// records.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const reminders = require('../parentNotes');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('parent'));

router.get('/', (req, res) => {
  const includeDone = req.query.includeDone !== 'false';
  res.json({ ok: true, reminders: reminders.listReminders(req.user.id, { includeDone }) });
});

router.post('/', (req, res) => {
  try {
    const reminder = reminders.createReminder({ ...req.body, parentId: req.user.id });
    audit.record(req.user.id, 'create', 'parent_reminder', reminder.id, { title: reminder.title });
    res.status(201).json({ ok: true, reminder });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/toggle', (req, res) => {
  try {
    const reminder = reminders.toggleDone(req.params.id, req.user.id, req.body?.isDone);
    res.json({ ok: true, reminder });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const removed = reminders.deleteReminder(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'parent_reminder', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
