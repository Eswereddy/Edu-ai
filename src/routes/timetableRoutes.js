// /api/timetable/* — weekly class schedule, role-gated writes.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const timetable = require('../timetable');
const audit = require('../audit');

const router = express.Router();

router.get('/section/:classSection', requireAuth, (req, res) => {
  res.json({ ok: true, days: timetable.listForSection(req.params.classSection) });
});

router.get('/faculty/:facultyId', requireAuth, (req, res) => {
  if (req.user.role === 'faculty' && req.user.id !== req.params.facultyId) {
    return res.status(403).json({ ok: false, error: 'Faculty may only view their own timetable' });
  }
  res.json({ ok: true, days: timetable.listForFaculty(req.params.facultyId) });
});

router.get('/mine', requireAuth, requireRole('faculty'), (req, res) => {
  res.json({ ok: true, days: timetable.listForFaculty(req.user.id) });
});

router.get('/sections', requireAuth, (req, res) => {
  res.json({ ok: true, sections: timetable.listSections() });
});

router.post('/', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const slot = timetable.createSlot({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'timetable_slot', slot.id, { classSection: slot.class_section });
    res.status(201).json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const slot = timetable.updateSlot(req.params.id, req.body || {});
    audit.record(req.user.id, 'update', 'timetable_slot', req.params.id, null);
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const removed = timetable.deleteSlot(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'timetable_slot', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
