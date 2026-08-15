// /api/admissions/* — public application intake, admin review queue,
// seat matrix, auto-enrollment on approval.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const admissions = require('../admissions');
const audit = require('../audit');

const router = express.Router();

// Public — a prospective student has no account yet.
router.post('/apply', (req, res) => {
  try {
    const application = admissions.submitApplication(req.body || {});
    res.status(201).json({ ok: true, application });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/seats', (req, res) => {
  res.json({ ok: true, seats: admissions.listSeats({ academicYear: req.query.academicYear }) });
});

router.put('/seats', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const row = admissions.upsertSeatMatrix(req.body || {});
    audit.record(req.user.id, 'upsert', 'admission_seats', row.id, row);
    res.json({ ok: true, seat: row });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, applications: admissions.listApplications({ status: req.query.status }) });
});

router.get('/:id', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  const application = admissions.getById(req.params.id);
  if (!application) return res.status(404).json({ ok: false, error: 'Application not found' });
  res.json({ ok: true, application });
});

router.post('/:id/under-review', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    res.json({ ok: true, application: admissions.setUnderReview(req.params.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/review', requireAuth, requireRole('admin', 'ai-admin'), async (req, res) => {
  try {
    const result = await admissions.review(req.params.id, {
      status: req.body?.status,
      reviewedBy: req.user.id,
      reviewNote: req.body?.reviewNote,
      academicYear: req.body?.academicYear,
    });
    audit.record(req.user.id, 'review', 'admission_application', req.params.id, { status: result.application.status });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
