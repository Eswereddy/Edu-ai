// /api/admin/audit — query the platform's audit trail. The underlying
// audit.recent() function (src/audit.js) already existed and was
// already called internally by many routes to *record* events; it just
// had no route exposing it for *reading*. This is that route — no
// change to audit.js itself. Admin-portal only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/', (req, res) => {
  const { entity, userId, limit } = req.query;
  res.json({ ok: true, events: audit.recent({ entity, userId, limit }) });
});

module.exports = router;
