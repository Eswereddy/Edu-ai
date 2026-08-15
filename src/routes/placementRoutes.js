// /api/placements/* — job postings + applications, alumni registry.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const placements = require('../placements');
const notify = require('../notify');
const audit = require('../audit');
const { db } = require('../db');

const router = express.Router();

router.post('/jobs', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  try {
    const job = placements.postJob({ ...req.body, postedBy: req.user.id });
    audit.record(req.user.id, 'create', 'job_posting', job.id, { title: job.title, company: job.company });
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
    for (const s of students) {
      notify.send(s.id, {
        title: `New placement opportunity: ${job.title}`,
        body: `${job.company} is hiring — check the placements portal.`,
        type: 'job_posted',
        meta: { jobId: job.id },
      });
    }
    res.status(201).json({ ok: true, job });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/jobs', requireAuth, (req, res) => {
  res.json({ ok: true, jobs: placements.listJobs({ status: req.query.status }) });
});

router.get('/jobs/:id', requireAuth, (req, res) => {
  const job = placements.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job posting not found' });
  res.json({ ok: true, job });
});

router.post('/jobs/:id/close', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  try {
    res.json({ ok: true, job: placements.closeJob(req.params.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/jobs/:id/apply', requireAuth, requireRole('student'), (req, res) => {
  try {
    const application = placements.applyToJob({ jobId: req.params.id, studentId: req.user.id });
    audit.record(req.user.id, 'apply', 'job_application', application.id, {});
    res.status(201).json({ ok: true, application });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/jobs/:id/applications', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, applications: placements.listApplicationsForJob(req.params.id) });
});

router.get('/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, applications: placements.myApplications(req.user.id) });
});

router.patch('/applications/:id', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  try {
    const application = placements.updateApplicationStatus(req.params.id, req.body?.status);
    audit.record(req.user.id, 'update_status', 'job_application', application.id, { status: application.status });
    notify.send(application.student_id, {
      title: 'Placement application update',
      body: `Your application status changed to "${application.status}".`,
      type: 'job_application_updated',
      meta: { applicationId: application.id, status: application.status },
    });
    res.json({ ok: true, application });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/alumni', requireAuth, (req, res) => {
  try {
    const isSelf = !req.body?.userId || req.body.userId === req.user.id;
    if (!isSelf && !['admin', 'ai-admin'].includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }
    const alumni = placements.registerAlumni({ ...req.body, userId: req.body?.userId || req.user.id });
    audit.record(req.user.id, 'upsert', 'alumni', alumni.id, {});
    res.json({ ok: true, alumni });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/alumni', requireAuth, (req, res) => {
  res.json({ ok: true, alumni: placements.listAlumni({ graduationYear: req.query.graduationYear, company: req.query.company }) });
});

module.exports = router;
