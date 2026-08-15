// /api/timetable-export/* — CSV export for timetable views. Separate
// file from timetableRoutes.js (untouched) so nothing existing changes.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const timetableCsv = require('../timetableCsv');

const router = express.Router();
router.use(requireAuth);

router.get('/section/:classSection.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="timetable-${req.params.classSection}.csv"`);
  res.send(timetableCsv.sectionCsv(req.params.classSection));
});

router.get('/mine.csv', requireRole('faculty'), (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="my-timetable.csv"');
  res.send(timetableCsv.facultyCsv(req.user.id));
});

module.exports = router;
