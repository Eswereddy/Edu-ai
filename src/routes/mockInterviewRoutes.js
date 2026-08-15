// /api/placements/mock-interviews/* — interview slot scheduling on top
// of the existing placements module. Own router, mounted at a sub-path
// of /api/placements so placementRoutes.js is untouched.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const interviews = require('../mockInterviews');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

function canInterview(req) {
  return ['faculty', 'admin', 'ai-admin'].includes(req.user.role) || interviews.isAlumni(req.user.id);
}

router.post('/slots', requireAuth, (req, res) => {
  if (!canInterview(req)) return res.status(403).json({ ok: false, error: 'Only faculty, admin, or registered alumni can offer interview slots' });
  try {
    const slot = interviews.offerSlot({ ...req.body, interviewerId: req.user.id });
    audit.record(req.user.id, 'create', 'interview_slot', slot.id, slot);
    res.status(201).json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/slots', requireAuth, (req, res) => {
  res.json({ ok: true, slots: interviews.listOpenSlots({ interviewType: req.query.interviewType, fromDate: req.query.fromDate }) });
});

router.get('/slots/mine', requireAuth, (req, res) => {
  if (!canInterview(req)) return res.status(403).json({ ok: false, error: 'Not authorized' });
  res.json({ ok: true, slots: interviews.myOfferedSlots(req.user.id) });
});

router.post('/slots/:id/book', requireAuth, requireRole('student'), (req, res) => {
  try {
    const slot = interviews.bookSlot({ slotId: req.params.id, studentId: req.user.id });
    audit.record(req.user.id, 'book', 'interview_slot', slot.id, {});
    notify.send(slot.interviewer_id, {
      title: 'Mock interview booked',
      body: `A student booked your ${slot.interview_type.replace('_', ' ')} slot on ${slot.slot_date}.`,
      type: 'interview_booked',
      meta: { slotId: slot.id },
    });
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/slots/:id/cancel', requireAuth, (req, res) => {
  try {
    const slot = req.user.role === 'student'
      ? interviews.cancelByStudent({ slotId: req.params.id, studentId: req.user.id })
      : interviews.cancelByInterviewer({ slotId: req.params.id, interviewerId: req.user.id });
    audit.record(req.user.id, 'cancel', 'interview_slot', slot.id, { status: slot.status });
    const notifyTarget = req.user.role === 'student' ? slot.interviewer_id : slot.student_id;
    if (notifyTarget) {
      notify.send(notifyTarget, {
        title: 'Mock interview cancelled',
        body: `The ${slot.interview_type.replace('_', ' ')} slot on ${slot.slot_date} was cancelled.`,
        type: 'interview_cancelled',
        meta: { slotId: slot.id },
      });
    }
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/slots/:id/complete', requireAuth, (req, res) => {
  if (!canInterview(req)) return res.status(403).json({ ok: false, error: 'Not authorized' });
  try {
    const slot = interviews.completeInterview({
      slotId: req.params.id, interviewerId: req.user.id, feedback: req.body?.feedback, rating: req.body?.rating,
    });
    audit.record(req.user.id, 'complete', 'interview_slot', slot.id, { rating: slot.rating });
    notify.send(slot.student_id, {
      title: 'Mock interview feedback ready',
      body: `Feedback is in for your ${slot.interview_type.replace('_', ' ')} mock interview.`,
      type: 'interview_feedback',
      meta: { slotId: slot.id },
    });
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/bookings/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, bookings: interviews.myBookings(req.user.id) });
});

module.exports = router;
