// /api/faculty/classes — faculty-portal "Class Analytics Dashboard"
// feature. GET / lists the class-section + subject combos this faculty
// member teaches. GET /:classSection returns attendance, assignment,
// and quiz analytics for that section (optionally scoped further with
// ?subject=). Faculty-portal only, read-only, additive.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const classAnalytics = require('../facultyClassAnalytics');

const router = express.Router();
router.use(requireAuth, requireRole('faculty'));

router.get('/', (req, res) => {
  res.json({ ok: true, classes: classAnalytics.myClasses(req.user.id), sections: classAnalytics.distinctSections(req.user.id) });
});

router.get('/:classSection', (req, res) => {
  try {
    const analytics = classAnalytics.classAnalytics(req.user.id, req.params.classSection, { subject: req.query.subject || null });
    res.json({ ok: true, analytics });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build class analytics' });
  }
});

module.exports = router;
