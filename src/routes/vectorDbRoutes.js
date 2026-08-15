// /api/ai-admin/vector-db/* — AI Admin Portal only. Manage and query the
// real embedding-backed vector store in src/vectorStore.js. This sits
// alongside the existing TF-IDF retriever (rag.js) used by
// /api/ai/instant — nothing about that call site is touched here.
// Purely additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const vectorStore = require('../vectorStore');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/stats', (req, res) => {
  res.json({ ok: true, ...vectorStore.stats() });
});

router.post('/reindex', async (req, res) => {
  try {
    const { sourceTypes, limit } = req.body || {};
    const result = await vectorStore.reindexAll({ sourceTypes, limit });
    audit.record(req.user.id, 'reindex', 'vector_store', null, result);
    res.json({ ok: true, indexed: result, ...vectorStore.stats() });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to reindex' });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query, role, userId, sourceTypes, topK } = req.body || {};
    if (!query) return res.status(400).json({ ok: false, error: 'query is required' });
    const result = await vectorStore.semanticSearch({ query, role, userId, sourceTypes, topK });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Search failed' });
  }
});

router.post('/index', async (req, res) => {
  try {
    const { sourceType, sourceId, role, userId, content } = req.body || {};
    if (!sourceType || !content) return res.status(400).json({ ok: false, error: 'sourceType and content are required' });
    const doc = await vectorStore.indexDocument({ sourceType, sourceId, role, userId, content });
    audit.record(req.user.id, 'index', 'vector_store', doc?.id, { sourceType, sourceId });
    res.status(201).json({ ok: true, document: doc });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to index document' });
  }
});

module.exports = router;
