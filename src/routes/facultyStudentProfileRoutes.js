// /api/faculty/students — faculty-portal "Full Student Profile
// (Read-Only)" feature. GET / lists all students (with optional
// ?search=), GET /:studentId returns the full read-only aggregate
// profile. Faculty-portal only, read-only, additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const facultyStudentProfile = require('../facultyStudentProfile');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/', (req, res) => {
  res.json({ ok: true, students: facultyStudentProfile.listAllStudents({ search: req.query.search }) });
});

router.get('/:studentId', (req, res) => {
  try {
    res.json({ ok: true, profile: facultyStudentProfile.fullProfile(req.params.studentId) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build student profile' });
  }
});

module.exports = router;
