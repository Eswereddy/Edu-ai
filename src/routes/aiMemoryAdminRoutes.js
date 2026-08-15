// /api/ai-admin/memory/:userId/* — inspect or clear a specific user's
// AI memory, for compliance requests or issue investigation. Every
// access is written to the audit trail. AI-Admin portal only (admin
// also allowed).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const memoryAdmin = require('../aiUserMemoryAdmin');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/:userId', (req, res) => {
  try {
    res.json({ ok: true, memory: memoryAdmin.inspectUser(req.params.userId, req.user.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:userId/clear', (req, res) => {
  try {
    res.json({ ok: true, result: memoryAdmin.clearUserMemory(req.params.userId, req.body?.role, req.user.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:userId/facts/:factId', (req, res) => {
  try {
    res.json({ ok: true, result: memoryAdmin.deleteUserFact(req.params.userId, req.params.factId, req.user.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
