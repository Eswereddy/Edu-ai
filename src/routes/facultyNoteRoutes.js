// /api/faculty/notes/* — faculty's own private notes (lesson prep,
// per-student remarks, class-section notes). Faculty-portal only, same
// locked-down pattern as facultyTaskRoutes.js.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const notes = require('../facultyNotes');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/', (req, res) => {
  const { refType, refId, classSection, subject } = req.query;
  res.json({ ok: true, notes: notes.listNotes(req.user.id, { refType, refId, classSection, subject }) });
});

router.post('/', (req, res) => {
  try {
    const note = notes.createNote({ ...req.body, facultyId: req.user.id });
    audit.record(req.user.id, 'create', 'faculty_note', note.id, null);
    res.status(201).json({ ok: true, note });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const note = notes.updateNote(req.params.id, req.user.id, req.body || {});
    res.json({ ok: true, note });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const removed = notes.deleteNote(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'faculty_note', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
