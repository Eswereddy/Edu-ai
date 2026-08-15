// /api/ai-admin/live-job-feed/* — real, server-side-proxied job listings
// for the admin portal's Job Center. See src/liveJobFeed.js for exactly
// which providers are real/live and why LinkedIn/Internshala/Naukri
// scraping isn't one of them. Admin / AI-Admin only. Purely additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const liveJobFeed = require('../liveJobFeed');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ai-admin'));

router.get('/', async (req, res) => {
  try {
    const { query = '', location = '', page = '1' } = req.query;
    const result = await liveJobFeed.getLiveJobs({ query, location, page: Number(page) || 1 });
    audit.record(req.user.id, 'fetch', 'live_job_feed', null, { query, location, page });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to fetch live job feed' });
  }
});

module.exports = router;
