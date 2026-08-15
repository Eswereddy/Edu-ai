// /api/ai-admin/award-recommender/* — feature 11 of the AI Admin
// Portal add-on suite. AI-Admin/Admin only. Produces recommendations
// for a human committee to confirm — see achievementRecommender.js.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const recommender = require('../achievementRecommender');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'ai-admin'));

  router.post('/run', async (req, res) => {
    try {
      const nominations = await recommender.recommend({ apiKey, model, createdBy: req.user.id });
      audit.record(req.user.id, 'run', 'award_nominations', null, { count: nominations.length });
      res.status(201).json({ ok: true, nominations, note: 'AI-generated shortlist for the awards committee to confirm.' });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate nominations' });
    }
  });

  router.get('/nominations', (req, res) => {
    res.json({ ok: true, nominations: recommender.listNominations({ category: req.query.category }) });
  });

  return router;
};
