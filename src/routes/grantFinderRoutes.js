// /api/ai-admin/grant-finder/* — feature 9 of the AI Admin Portal
// add-on suite. AI-Admin/Admin only. Grant leads are AI-generated
// suggestions to verify on the funder's own site — see
// grantFinder.js header.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const finder = require('../grantFinder');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/results', async (req, res) => {
    try {
      const { facultyId, researchArea } = req.body || {};
      if (!facultyId) return res.status(400).json({ ok: false, error: 'facultyId is required' });
      const result = await finder.findGrants({ apiKey, model, facultyId, researchArea });
      audit.record(req.user.id, 'create', 'grant_search_result', result.id, { facultyId, researchArea });
      res.status(201).json({ ok: true, result, note: 'Grant leads are AI-generated suggestions — verify deadlines/eligibility on the funder\'s own site.' });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to find grants' });
    }
  });

  router.get('/results', (req, res) => {
    const facultyId = req.query.facultyId;
    if (!facultyId) return res.status(400).json({ ok: false, error: 'facultyId query param is required' });
    res.json({ ok: true, results: finder.listResults(facultyId) });
  });

  router.get('/results/:id', (req, res) => {
    const result = finder.getResult(req.params.id);
    if (!result) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, result });
  });

  return router;
};
