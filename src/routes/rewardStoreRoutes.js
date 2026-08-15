// /api/rewards/* — reward catalog + redeem-with-points.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const rewardStore = require('../rewardStore');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ ok: true, rewards: rewardStore.listRewards() });
});

router.post('/', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const reward = rewardStore.addReward(req.body || {});
    audit.record(req.user.id, 'create', 'reward', reward.id);
    res.status(201).json({ ok: true, reward });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to add reward' });
  }
});

router.post('/:id/redeem', (req, res) => {
  try {
    const redemption = rewardStore.redeem(req.user.id, req.params.id);
    audit.record(req.user.id, 'redeem', 'reward', req.params.id, { costPoints: redemption.costPoints });
    res.status(201).json({ ok: true, redemption });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to redeem reward' });
  }
});

router.get('/redemptions/mine', (req, res) => {
  res.json({ ok: true, redemptions: rewardStore.myRedemptions(req.user.id) });
});

router.patch('/redemptions/:id', requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const redemption = rewardStore.updateRedemptionStatus(req.params.id, req.body?.status);
    audit.record(req.user.id, 'update_status', 'reward_redemption', req.params.id, { status: req.body?.status });
    res.json({ ok: true, redemption });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to update redemption' });
  }
});

module.exports = router;
