// /api/ai-admin/blockchain-verify/*  — admin-only: trigger/inspect anchors
// /api/verify/certificate/:id        — PUBLIC: anyone can verify a cert
// See src/certificateBlockchainAnchor.js for how the on-chain write
// actually works and what env vars it needs. Purely additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const anchor = require('../certificateBlockchainAnchor');
const audit = require('../audit');

const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('admin', 'ai-admin'));

adminRouter.post('/:certificateId/anchor', async (req, res) => {
  try {
    const record = await anchor.anchorCertificate(req.params.certificateId);
    audit.record(req.user.id, 'anchor', 'certificate_blockchain_anchor', record.id, { certificateId: req.params.certificateId, status: record.status });
    res.status(201).json({ ok: true, anchor: record, configured: anchor.isConfigured() });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to anchor certificate' });
  }
});

adminRouter.get('/:certificateId', (req, res) => {
  const record = anchor.latestAnchor(req.params.certificateId);
  res.json({ ok: true, anchor: record, configured: anchor.isConfigured() });
});

adminRouter.get('/', (req, res) => {
  res.json({ ok: true, anchors: anchor.listAnchors({ status: req.query.status }), configured: anchor.isConfigured() });
});

// ---------------------------------------------------------------- Public
const publicRouter = express.Router();

publicRouter.get('/:certificateId', async (req, res) => {
  try {
    const result = await anchor.verifyCertificate(req.params.certificateId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to verify certificate' });
  }
});

module.exports = { adminRouter, publicRouter };
