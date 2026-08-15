// /api/certificates/* — student certificate requests (Bonafide/Study/
// Character), admin approval workflow, and PDF generation once approved.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const certificates = require('../certificates');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/', requireAuth, requireRole('student'), (req, res) => {
  try {
    const request = certificates.requestCertificate({
      studentId: req.user.id,
      certType: req.body?.certType,
      purpose: req.body?.purpose,
    });
    audit.record(req.user.id, 'create', 'certificate_request', request.id, { certType: request.cert_type });
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/me', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, requests: certificates.listForStudent(req.user.id) });
});

router.get('/', requireAuth, requireRole('admin', 'faculty'), (req, res) => {
  res.json({ ok: true, requests: certificates.listAll({ status: req.query.status }) });
});

router.post('/:id/review', requireAuth, requireRole('admin', 'faculty'), (req, res) => {
  try {
    const request = certificates.review(req.params.id, {
      status: req.body?.status,
      reviewedBy: req.user.id,
      reviewNote: req.body?.reviewNote,
    });
    audit.record(req.user.id, 'review', 'certificate_request', request.id, { status: request.status });
    notify.send(request.student_id, {
      title: `Certificate request ${request.status}`,
      body: request.status === 'approved'
        ? `Your ${certificates.CERT_TITLES[request.cert_type]} is ready to download.`
        : (request.review_note || 'Your certificate request was rejected.'),
      type: 'certificate_reviewed',
      meta: { requestId: request.id, status: request.status },
    });
    res.json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/:id/download.pdf', requireAuth, async (req, res) => {
  try {
    const request = certificates.getById(req.params.id);
    if (!request) return res.status(404).json({ ok: false, error: 'Not found' });
    const isOwner = req.user.role === 'student' && req.user.id === request.student_id;
    const isStaff = ['admin', 'faculty', 'ai-admin'].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ ok: false, error: 'Not authorized' });

    const { buffer } = await certificates.generateCertificatePdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${request.id.slice(0, 8)}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate certificate' });
  }
});

module.exports = router;
