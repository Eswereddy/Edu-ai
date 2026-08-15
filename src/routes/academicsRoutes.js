// /api/academics/* — semester-wise subjects and results, with SGPA/CGPA.
// Additive: does not touch the existing flat /api/grades endpoints.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const academics = require('../academics');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

function canSeeStudent(user, studentId) {
  if (['admin', 'ai-admin', 'faculty'].includes(user.role)) return true;
  if (user.role === 'student') return user.id === studentId;
  if (user.role === 'parent') return user.linkedStudentId === studentId;
  return false;
}

// ------------------------------------------------------------ Semesters
router.post('/semesters', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const semester = academics.createSemester({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'semester', semester.id, { name: semester.name });
    res.status(201).json({ ok: true, semester });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/semesters', requireAuth, (req, res) => {
  res.json({ ok: true, semesters: academics.listSemesters({ classSection: req.query.classSection }) });
});

router.get('/semesters/:id', requireAuth, (req, res) => {
  const semester = academics.getSemester(req.params.id);
  if (!semester) return res.status(404).json({ ok: false, error: 'Semester not found' });
  res.json({ ok: true, semester });
});

// -------------------------------------------------------------- Subjects
router.post('/semesters/:id/subjects', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const subject = academics.addSubject(req.params.id, req.body || {});
    audit.record(req.user.id, 'create', 'semester_subject', subject.id, { subjectName: subject.subject_name });
    res.status(201).json({ ok: true, subject });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/semesters/:id/subjects', requireAuth, (req, res) => {
  res.json({ ok: true, subjects: academics.listSubjects(req.params.id) });
});

// -------------------------------------------------------------- Results
router.post('/results', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const { studentId, semesterId, subjectId, marksObtained, maxMarks } = req.body || {};
    const result = academics.upsertResult({
      studentId,
      semesterId,
      subjectId,
      marksObtained,
      maxMarks,
      enteredBy: req.user.id,
    });
    audit.record(req.user.id, 'grade', 'result', result.id, {
      studentId,
      subject: result.subject_name,
      gradeLetter: result.grade_letter,
    });
    notify.send(studentId, {
      title: `Result published: ${result.subject_name}`,
      body: `You scored ${result.marks_obtained}/${result.max_marks} — grade ${result.grade_letter} (${result.grade_point} points).`,
      type: 'result_published',
      meta: { resultId: result.id, semesterId, subjectId, gradeLetter: result.grade_letter },
    });
    res.status(201).json({ ok: true, result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/results/:studentId/:semesterId', requireAuth, (req, res) => {
  if (!canSeeStudent(req.user, req.params.studentId)) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
  }
  const results = academics.listResultsForStudentInSemester(req.params.studentId, req.params.semesterId);
  const sgpa = academics.sgpaFor(req.params.studentId, req.params.semesterId);
  res.json({ ok: true, results, sgpa });
});

router.get('/semesters/:id/results', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  res.json({ ok: true, results: academics.listResultsForSemester(req.params.id) });
});

// ------------------------------------------------------------ Transcript
router.get('/transcript/me', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, transcript: academics.transcriptFor(req.user.id) });
});

router.get('/transcript/:studentId', requireAuth, (req, res) => {
  if (!canSeeStudent(req.user, req.params.studentId)) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
  }
  res.json({ ok: true, transcript: academics.transcriptFor(req.params.studentId) });
});

router.get('/transcript/me', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, transcript: academics.transcriptFor(req.user.id) });
});

module.exports = router;
