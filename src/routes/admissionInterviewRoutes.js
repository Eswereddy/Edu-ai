// /api/admissions/interviews/* — panel interview scheduling for
// admission applications, plus panelist feedback/recommendations.
// Additive-only; own path so /api/admissions (applications/seats) is
// untouched.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const interviews = require('../admissionInterviews');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF = ['admin', 'ai-admin'];
const PANEL = ['faculty', 'admin', 'ai-admin'];

router.post('/', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const interview = interviews.scheduleInterview({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'schedule', 'admission_interview', interview.id, { applicationId: interview.application_id });
    notify.send(interview.panelist_id, {
      title: 'New admission interview assigned',
      body: `You've been scheduled to interview an applicant on ${interview.scheduled_at}.`,
      type: 'admission_interview_scheduled',
      meta: { interviewId: interview.id },
    });
    res.status(201).json({ ok: true, interview });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/mine', requireAuth, requireRole(...PANEL), (req, res) => {
  res.json({ ok: true, interviews: interviews.myInterviews(req.user.id) });
});

router.get('/', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({
    ok: true,
    interviews: interviews.listInterviews({
      applicationId: req.query.applicationId,
      panelistId: req.query.panelistId,
      status: req.query.status,
    }),
  });
});

router.get('/:id', requireAuth, requireRole(...PANEL), (req, res) => {
  const interview = interviews.getInterview(req.params.id);
  if (!interview) return res.status(404).json({ ok: false, error: 'Not found' });
  if (interview.panelist_id !== req.user.id && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }
  res.json({ ok: true, interview });
});

router.patch('/:id/reschedule', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const interview = interviews.rescheduleInterview({ id: req.params.id, ...req.body });
    audit.record(req.user.id, 'reschedule', 'admission_interview', interview.id, { scheduledAt: interview.scheduled_at });
    notify.send(interview.panelist_id, {
      title: 'Admission interview rescheduled',
      body: `The interview is now at ${interview.scheduled_at}.`,
      type: 'admission_interview_rescheduled',
      meta: { interviewId: interview.id },
    });
    res.json({ ok: true, interview });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/cancel', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const interview = interviews.cancelInterview(req.params.id);
    audit.record(req.user.id, 'cancel', 'admission_interview', interview.id, {});
    notify.send(interview.panelist_id, {
      title: 'Admission interview cancelled',
      body: 'A scheduled interview on your calendar was cancelled.',
      type: 'admission_interview_cancelled',
      meta: { interviewId: interview.id },
    });
    res.json({ ok: true, interview });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/:id/status', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const interview = interviews.markStatus({ id: req.params.id, status: req.body?.status });
    audit.record(req.user.id, 'update_status', 'admission_interview', interview.id, { status: interview.status });
    res.json({ ok: true, interview });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/feedback', requireAuth, requireRole(...PANEL), (req, res) => {
  try {
    const feedback = interviews.submitFeedback({
      interviewId: req.params.id,
      panelistId: req.user.id,
      rating: req.body?.rating,
      recommendation: req.body?.recommendation,
      notes: req.body?.notes,
    });
    audit.record(req.user.id, 'submit_feedback', 'admission_interview', req.params.id, { recommendation: feedback.recommendation });
    res.status(201).json({ ok: true, feedback });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/:id/feedback', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, feedback: interviews.getFeedback(req.params.id) });
});

module.exports = router;
