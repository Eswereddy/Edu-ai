// /api/hostel-mess/* — weekly menu, meal attendance, complaints.
// Additive-only; own path so /api/hostel (rooms/allocation) is untouched.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const mess = require('../hostelMess');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF = ['admin', 'ai-admin'];

// ------------------------------------------------------------------ Menu

router.put('/menu', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const menu = mess.upsertMenu({ ...req.body, updatedBy: req.user.id });
    audit.record(req.user.id, 'upsert', 'mess_menu', menu.id, menu);
    res.json({ ok: true, menu });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/menu', requireAuth, (req, res) => {
  res.json({ ok: true, menu: mess.weeklyMenu() });
});

router.get('/menu/today', requireAuth, (req, res) => {
  res.json({ ok: true, menu: mess.todaysMenu() });
});

router.get('/menu/:dayOfWeek', requireAuth, (req, res) => {
  try {
    res.json({ ok: true, menu: mess.menuForDay(req.params.dayOfWeek) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------ Attendance

router.post('/attendance', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const record = mess.markMealAttendance({ ...req.body, markedBy: req.user.id });
    audit.record(req.user.id, 'mark', 'mess_attendance', record.id, record);
    res.status(201).json({ ok: true, record });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/attendance/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, history: mess.myMealHistory(req.user.id, { from: req.query.from, to: req.query.to }) });
});

router.get('/attendance/report', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    res.json({ ok: true, report: mess.attendanceReport({ mealDate: req.query.mealDate, mealType: req.query.mealType }) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------ Complaints

router.post('/complaints', requireAuth, requireRole('student'), (req, res) => {
  try {
    const complaint = mess.fileComplaint({ ...req.body, studentId: req.user.id });
    audit.record(req.user.id, 'file', 'hostel_complaint', complaint.id, { category: complaint.category, subject: complaint.subject });
    res.status(201).json({ ok: true, complaint });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/complaints/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, complaints: mess.myComplaints(req.user.id) });
});

router.get('/complaints', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, complaints: mess.listComplaints({ status: req.query.status, category: req.query.category }) });
});

router.get('/complaints/:id', requireAuth, (req, res) => {
  const complaint = mess.getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ ok: false, error: 'Not found' });
  if (complaint.student_id !== req.user.id && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }
  res.json({ ok: true, complaint });
});

router.post('/complaints/:id/assign', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const complaint = mess.assignComplaint({ id: req.params.id, assignedTo: req.body?.assignedTo, assignedBy: req.user.id });
    audit.record(req.user.id, 'assign', 'hostel_complaint', complaint.id, { assignedTo: complaint.assigned_to });
    notify.send(complaint.assigned_to, {
      title: 'Hostel complaint assigned to you',
      body: complaint.subject,
      type: 'hostel_complaint_assigned',
      meta: { complaintId: complaint.id },
    });
    res.json({ ok: true, complaint });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/complaints/:id', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const complaint = mess.updateComplaintStatus({
      id: req.params.id,
      status: req.body?.status,
      resolutionNotes: req.body?.resolutionNotes,
      updatedBy: req.user.id,
    });
    audit.record(req.user.id, 'update_status', 'hostel_complaint', complaint.id, { status: complaint.status });
    notify.send(complaint.student_id, {
      title: 'Your hostel complaint was updated',
      body: `"${complaint.subject}" is now ${complaint.status.replace('_', ' ')}.`,
      type: 'hostel_complaint_updated',
      meta: { complaintId: complaint.id, status: complaint.status },
    });
    res.json({ ok: true, complaint });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
