// /api/settings/* — feature flags & platform config, readable by anyone
// logged in, writable only by admin/ai-admin.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const settings = require('../settings');
const audit = require('../audit');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ ok: true, settings: settings.all() });
});

router.put('/:key', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const { value } = req.body || {};
  if (value == null) return res.status(400).json({ ok: false, error: 'value is required' });
  const updated = settings.set(req.params.key, value, req.user.id);
  audit.record(req.user.id, 'update', 'setting', req.params.key, { value: updated });
  res.json({ ok: true, key: req.params.key, value: updated });
});

module.exports = router;
