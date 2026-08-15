// /api/ai-admin/governance/* — read-only AI usage analytics, KB
// coverage, and a live RAG-retrieval preview. AI-Admin portal only
// (admin also allowed, matching the pattern used for KB routes
// elsewhere in the app). No model call is ever made here.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const governance = require('../aiGovernance');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/', (req, res) => {
  res.json({ ok: true, governance: governance.overview() });
});

router.get('/role-prompts', (req, res) => {
  res.json({ ok: true, rolePrompts: governance.rolePromptsOverview() });
});

router.post('/rag-preview', (req, res) => {
  try {
    const { role, query, topK } = req.body || {};
    res.json({ ok: true, preview: governance.previewRetrieval(role || 'student', query, topK) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
