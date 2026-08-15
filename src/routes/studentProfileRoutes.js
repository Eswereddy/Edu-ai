// /api/student/profile/* — bio, social links, avatar, theme/lang/accessibility.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const profile = require('../studentProfile');

const router = express.Router();
router.use(requireAuth, requireRole('student'));

router.get('/', (req, res) => {
  res.json({ ok: true, profile: profile.getProfile(req.user.id) });
});

router.put('/', (req, res) => {
  try {
    const updated = profile.upsertProfile(req.user.id, req.body || {});
    res.json({ ok: true, profile: updated });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update profile' });
  }
});

// Convenience sub-route so the frontend can PATCH just the accessibility/
// theme block without resending bio/social links.
router.patch('/preferences', (req, res) => {
  try {
    const updated = profile.upsertProfile(req.user.id, req.body || {});
    res.json({ ok: true, profile: updated });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update preferences' });
  }
});

module.exports = router;
