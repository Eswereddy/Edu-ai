// /api/document-services/* — document requests with SLA + medical letter generator.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const docSvc = require('../documentServices');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth);

  router.post('/requests', requireRole('student'), (req, res) => {
    try {
      const request = docSvc.createRequest({ studentId: req.user.id, docType: req.body?.docType, details: req.body?.details });
      audit.record(req.user.id, 'create', 'document_service_request', request.id);
      res.status(201).json({ ok: true, request });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to create request' });
    }
  });

  router.get('/requests/mine', requireRole('student'), (req, res) => {
    res.json({ ok: true, requests: docSvc.listForStudent(req.user.id) });
  });

  router.get('/requests', requireRole('admin', 'ai-admin'), (req, res) => {
    res.json({ ok: true, requests: docSvc.listAll({ status: req.query.status }) });
  });

  router.patch('/requests/:id', requireRole('admin', 'ai-admin'), (req, res) => {
    try {
      const request = docSvc.updateStatus(req.params.id, { status: req.body?.status, reviewedBy: req.user.id, reviewNote: req.body?.reviewNote });
      audit.record(req.user.id, 'update_status', 'document_service_request', req.params.id, { status: req.body?.status });
      res.json({ ok: true, request });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update request' });
    }
  });

  router.post('/medical-letter', requireRole('student'), async (req, res) => {
    try {
      const letter = await docSvc.generateMedicalLetter({
        apiKey, model, studentId: req.user.id, studentName: req.user.name,
        reason: req.body?.reason, fromDate: req.body?.fromDate, toDate: req.body?.toDate,
      });
      audit.record(req.user.id, 'generate', 'medical_letter', letter.id, { aiGenerated: letter.aiGenerated });
      res.status(201).json({ ok: true, letter });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate letter' });
    }
  });

  router.get('/medical-letter/:id/pdf', requireRole('student'), async (req, res) => {
    const letter = docSvc.getMedicalLetter(req.params.id, req.user.id);
    if (!letter) return res.status(404).json({ ok: false, error: 'Not found' });
    try {
      const buffer = await docSvc.medicalLetterPdf(letter);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="medical-letter-${letter.id.slice(0, 8)}.pdf"`);
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Failed to render PDF' });
    }
  });

  return router;
};
