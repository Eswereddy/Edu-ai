// /api/student/notes/* — student's own personal notes & bookmarks.
// Student-portal only, same locked-down pattern as studentTaskRoutes.js.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const notes = require('../studentNotes');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  const { refType, subject, bookmarkedOnly } = req.query;
  res.json({
    ok: true,
    notes: notes.listNotes(req.user.id, { refType, subject, bookmarkedOnly: bookmarkedOnly === 'true' }),
  });
});

router.post('/', (req, res) => {
  try {
    const note = notes.createNote({ ...req.body, studentId: req.user.id });
    audit.record(req.user.id, 'create', 'student_note', note.id, null);
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
  audit.record(req.user.id, 'delete', 'student_note', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
