// /api/syllabus/* — syllabus docs (view/download) + exam schedule with ICS.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const syllabus = require('../syllabus');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth);

router.get('/documents', (req, res) => {
  res.json({ ok: true, documents: syllabus.listSyllabusDocs({ classSection: req.query.classSection, semesterId: req.query.semesterId }) });
});

router.post('/documents', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  try {
    const doc = syllabus.addSyllabusDoc({ ...req.body, uploadedBy: req.user.id });
    audit.record(req.user.id, 'create', 'syllabus_document', doc.id);
    res.status(201).json({ ok: true, document: doc });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add syllabus document' });
  }
});

router.delete('/documents/:id', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  try {
    syllabus.deleteSyllabusDoc(req.params.id);
    audit.record(req.user.id, 'delete', 'syllabus_document', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete' });
  }
});

router.get('/exam-schedule/:classSection', (req, res) => {
  res.json({ ok: true, schedule: syllabus.listExamSchedule(req.params.classSection) });
});

router.get('/exam-schedule/:classSection/ics', (req, res) => {
  const ics = syllabus.examScheduleIcs(req.params.classSection);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="exam-schedule-${req.params.classSection}.ics"`);
  res.send(ics);
});

router.post('/exam-schedule', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const entry = syllabus.addExamScheduleEntry({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'exam_schedule_entry', entry.id);
    res.status(201).json({ ok: true, entry });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add exam schedule entry' });
  }
});

router.delete('/exam-schedule/:id', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    syllabus.deleteExamScheduleEntry(req.params.id);
    audit.record(req.user.id, 'delete', 'exam_schedule_entry', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete' });
  }
});

module.exports = router;
