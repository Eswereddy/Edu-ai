// /api/student/data-sync/* — pull/push the student portal's local data
// blob so it follows the student across devices instead of being
// trapped in one browser's IndexedDB. Student-only.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const sync = require('../studentDataSync');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  const row = sync.getSync(req.user.id);
  res.json({ ok: true, sync: row });
});

router.put('/', (req, res) => {
  try {
    const { data, deviceLabel } = req.body || {};
    const row = sync.putSync(req.user.id, data, deviceLabel);
    audit.record(req.user.id, 'sync', 'student_local_data', req.user.id, { deviceLabel: deviceLabel || null });
    res.json({ ok: true, sync: row });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/', (req, res) => {
  res.json({ ok: true, ...sync.clearSync(req.user.id) });
});

module.exports = router;
