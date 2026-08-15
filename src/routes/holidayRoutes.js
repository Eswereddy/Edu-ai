// /api/holidays/* — holiday calendar + ICS export.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const holidays = require('../holidays');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ ok: true, holidays: holidays.listHolidays({ year: req.query.year }) });
});

router.get('/ics', (req, res) => {
  const ics = holidays.holidaysIcs({ year: req.query.year });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="holidays.ics"');
  res.send(ics);
});

router.post('/', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const holiday = holidays.addHoliday({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'holiday', holiday.id);
    res.status(201).json({ ok: true, holiday });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add holiday' });
  }
});

router.delete('/:id', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    holidays.deleteHoliday(req.params.id);
    audit.record(req.user.id, 'delete', 'holiday', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete' });
  }
});

module.exports = router;
