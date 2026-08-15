// /api/placements/interview-scheduler/* — AI Interview Scheduler.
// Admin/faculty generate + send interview invitations for job
// applications; students view and respond to their own invites.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const scheduler = require('../interviewScheduler');
const notify = require('../notify');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth);

  // Admin/faculty: AI-draft an invite + create it as a 'draft' record.
  router.post('/', requireRole('faculty', 'admin', 'ai-admin'), async (req, res) => {
    try {
      const { applicationId, scheduledAt, mode, location } = req.body || {};
      if (!applicationId) return res.status(400).json({ ok: false, error: 'applicationId is required' });
      const interview = await scheduler.generateAndCreateInterview({
        apiKey, model, applicationId, scheduledAt, mode, location, createdBy: req.user.id,
      });
      audit.record(req.user.id, 'create', 'placement_interview', interview.id, { applicationId, scheduledAt });
      res.status(201).json({ ok: true, interview });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate invite' });
    }
  });

  // Admin/faculty: list/track all invites (optionally filtered).
  router.get('/', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
    const { jobId, studentId, status } = req.query;
    res.json({ ok: true, interviews: scheduler.listInterviews({ jobId, studentId, status }) });
  });

  // Student: my own invites.
  router.get('/mine', requireRole('student'), (req, res) => {
    res.json({ ok: true, interviews: scheduler.myInterviews(req.user.id) });
  });

  // Admin/faculty: actually send a drafted invite (notifies the student).
  router.post('/:id/send', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
    try {
      const interview = scheduler.sendInvite(req.params.id);
      notify.send(interview.student_id, {
        title: `Interview invitation: ${interview.job_title} at ${interview.company}`,
        body: interview.scheduled_at ? `Scheduled for ${interview.scheduled_at}. Check the placements portal to confirm.` : 'Check the placements portal to confirm your slot.',
        type: 'interview_invite',
        meta: { interviewId: interview.id, applicationId: interview.application_id },
      });
      audit.record(req.user.id, 'send', 'placement_interview', interview.id, { studentId: interview.student_id });
      res.json({ ok: true, interview });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Student: confirm/decline a sent invite.
  router.post('/:id/respond', requireRole('student'), (req, res) => {
    try {
      const { action } = req.body || {};
      const interview = scheduler.respond(req.params.id, req.user.id, action);
      res.json({ ok: true, interview });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Admin/faculty: reschedule / cancel / mark complete / edit.
  router.patch('/:id', requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
    try {
      const interview = scheduler.updateInterview(req.params.id, req.body || {});
      audit.record(req.user.id, 'update', 'placement_interview', interview.id, req.body || {});
      res.json({ ok: true, interview });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
