// /api/ai-admin/curriculum-mapper/* — feature 5 of the AI Admin
// Portal add-on suite. AI-Admin/Admin only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const mapper = require('../curriculumMapper');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/entries', async (req, res) => {
    try {
      const { subject, subjectDescription } = req.body || {};
      const entry = await mapper.mapSubject({ apiKey, model, subject, subjectDescription, createdBy: req.user.id });
      audit.record(req.user.id, 'create', 'curriculum_map_entry', entry.id, { subject });
      res.status(201).json({ ok: true, entry });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to map subject' });
    }
  });

  router.get('/entries', (req, res) => {
    res.json({ ok: true, entries: mapper.listEntries() });
  });

  router.delete('/entries/:id', (req, res) => {
    try {
      mapper.deleteEntry(req.params.id);
      audit.record(req.user.id, 'delete', 'curriculum_map_entry', req.params.id, {});
      res.json({ ok: true, deleted: true });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete entry' });
    }
  });

  return router;
};
