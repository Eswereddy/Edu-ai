// /api/ai-admin/integrity/* — feature 6 of the AI Admin Portal add-on
// suite. AI-Admin/Admin only. Estimates are triage signals for human
// review, never a verdict — see integrityDashboard.js header.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const integrity = require('../integrityDashboard');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/scans', async (req, res) => {
    try {
      const { text, sourceLabel, studentId } = req.body || {};
      const scan = await integrity.scanText({ apiKey, model, text, sourceLabel, studentId, scannedBy: req.user.id });
      audit.record(req.user.id, 'scan', 'integrity_scan', scan.id, { flagged: scan.flagged, studentId: studentId || null });
      res.status(201).json({ ok: true, scan, caveat: 'This is a probabilistic AI estimate for human review, not a verdict.' });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to scan text' });
    }
  });

  router.get('/scans', (req, res) => {
    res.json({ ok: true, scans: integrity.listScans({ flaggedOnly: req.query.flaggedOnly === 'true', limit: req.query.limit }) });
  });

  router.get('/overview', (req, res) => {
    res.json({ ok: true, overview: integrity.overview() });
  });

  return router;
};
