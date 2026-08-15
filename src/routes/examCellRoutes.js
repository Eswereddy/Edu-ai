// /api/exam-cell/* — exam scheduling, seating, invigilation, results,
// revaluation. Additive-only; mounted on its own path so nothing about
// the existing /api/quiz routes (in-class quizzes) is touched.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const examCell = require('../examCell');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF = ['faculty', 'admin', 'ai-admin'];

// --------------------------------------------------------------- Exams

router.post('/exams', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const exam = examCell.createExam({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'exam', exam.id, { title: exam.title });
    res.status(201).json({ ok: true, exam });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/exams', requireAuth, (req, res) => {
  res.json({
    ok: true,
    exams: examCell.listExams({ classSection: req.query.classSection, upcomingOnly: req.query.upcoming === 'true' }),
  });
});

router.get('/exams/:id', requireAuth, (req, res) => {
  const exam = examCell.getExam(req.params.id);
  if (!exam) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, exam });
});

router.delete('/exams/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const exam = examCell.deleteExam(req.params.id);
  if (!exam) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'exam', req.params.id, null);
  res.json({ ok: true });
});

// --------------------------------------------------------------- Rooms

router.post('/exams/:id/rooms', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const room = examCell.addExamRoom({ examId: req.params.id, roomName: req.body?.roomName, capacity: req.body?.capacity });
    audit.record(req.user.id, 'create', 'exam_room', room.id, room);
    res.status(201).json({ ok: true, room });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/exams/:id/rooms', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, rooms: examCell.listExamRooms(req.params.id) });
});

// -------------------------------------------------------------- Seating

router.post('/exams/:id/seating/generate', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const seating = examCell.generateSeating({ examId: req.params.id, students: req.body?.students });
    audit.record(req.user.id, 'generate', 'exam_seating', req.params.id, { studentCount: (req.body?.students || []).length });
    res.status(201).json({ ok: true, seating });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/exams/:id/seating', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, seating: examCell.listSeatingByRoom(req.params.id) });
});

router.get('/exams/:id/seating/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, seat: examCell.getSeatForStudent(req.params.id, req.user.id) || null });
});

// --------------------------------------------------------- Invigilation

router.post('/exams/:id/invigilators', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const row = examCell.assignInvigilator({
      examId: req.params.id,
      roomName: req.body?.roomName,
      facultyId: req.body?.facultyId,
      assignedBy: req.user.id,
    });
    audit.record(req.user.id, 'assign', 'exam_invigilator', row.id, row);
    notify.send(row.faculty_id, {
      title: 'Invigilation duty assigned',
      body: `You've been assigned to invigilate room ${row.room_name}.`,
      type: 'exam_invigilation_assigned',
      meta: { examId: req.params.id, roomName: row.room_name },
    });
    res.status(201).json({ ok: true, invigilator: row });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/invigilators/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const row = examCell.removeInvigilator(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'remove', 'exam_invigilator', req.params.id, null);
  res.json({ ok: true });
});

router.get('/exams/:id/invigilators', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, invigilators: examCell.listInvigilators(req.params.id) });
});

router.get('/invigilators/mine', requireAuth, requireRole('faculty'), (req, res) => {
  res.json({ ok: true, invigilations: examCell.myInvigilations(req.user.id) });
});

// -------------------------------------------------------------- Results

router.post('/exams/:id/results', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const result = examCell.recordResult({
      examId: req.params.id,
      studentId: req.body?.studentId,
      marks: req.body?.marks,
      gradedBy: req.user.id,
    });
    audit.record(req.user.id, 'grade', 'exam_result', result.id, { marks: result.marks });
    notify.send(result.student_id, {
      title: 'Exam result published',
      body: `Your result is in: ${result.marks} marks.`,
      type: 'exam_result_published',
      meta: { examId: req.params.id, marks: result.marks },
    });
    res.status(201).json({ ok: true, result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/exams/:id/results', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, results: examCell.listResults(req.params.id) });
});

router.get('/exams/:id/results/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, result: examCell.getResult(req.params.id, req.user.id) || null });
});

router.get('/results/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, results: examCell.myResults(req.user.id) });
});

// --------------------------------------------------------- Revaluation

router.post('/exams/:id/revaluation', requireAuth, requireRole('student'), (req, res) => {
  try {
    const request = examCell.requestRevaluation({ examId: req.params.id, studentId: req.user.id, reason: req.body?.reason });
    audit.record(req.user.id, 'request', 'exam_revaluation', request.id, null);
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/revaluation/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, requests: examCell.myRevaluationRequests(req.user.id) });
});

router.get('/revaluation', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, requests: examCell.listRevaluationRequests({ status: req.query.status }) });
});

router.patch('/revaluation/:id', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const request = examCell.reviewRevaluation({
      id: req.params.id,
      status: req.body?.status,
      revisedMarks: req.body?.revisedMarks,
      remarks: req.body?.remarks,
      reviewedBy: req.user.id,
    });
    audit.record(req.user.id, 'review', 'exam_revaluation', request.id, { status: request.status });
    notify.send(request.student_id, {
      title: 'Revaluation update',
      body: `Your revaluation request is now "${request.status}".`,
      type: 'exam_revaluation_updated',
      meta: { requestId: request.id, status: request.status },
    });
    res.json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
