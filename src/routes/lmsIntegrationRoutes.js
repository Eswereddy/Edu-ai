// /api/lms/* — real "LMS Integration (Moodle/Canvas)" feature for the
// faculty portal. Faculty-only except the Canvas OAuth callback, which
// Canvas itself redirects the browser to (no Authorization header
// available there — the signed one-time state token carries the
// faculty identity instead, see lmsIntegration.js).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const lms = require('../lmsIntegration');
const audit = require('../audit');

const router = express.Router();

router.get('/status', requireAuth, requireRole('faculty'), (req, res) => {
  const connections = lms.listConnections(req.user.id);
  res.json({ ok: true, connections, canvasOAuthConfigured: Boolean(lms.envConfig().canvasClientId) });
});

router.get('/canvas/authorize-url', requireAuth, requireRole('faculty'), (req, res) => {
  try {
    const url = lms.buildCanvasAuthorizeUrl({ facultyId: req.user.id, instanceUrl: req.query.instanceUrl });
    res.json({ ok: true, url });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to build Canvas authorize URL' });
  }
});

// Canvas redirects the faculty member's browser here after they approve
// access on the Canvas side. We finish the token exchange server-side,
// then hand back a tiny page that messages the opener window (the app
// opens this in a popup) and closes itself.
router.get('/canvas/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const send = (payload) => {
    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
<script>
  try { window.opener && window.opener.postMessage(${JSON.stringify(payload)}, '*'); } catch (e) {}
  window.close();
</script>
${payload.ok ? 'Connected — you can close this window.' : `Connection failed: ${(payload.error || '').replace(/</g, '')}`}
</body></html>`);
  };

  if (error) return send({ type: 'lms-connected', provider: 'canvas', ok: false, error: String(error) });

  try {
    const connection = await lms.exchangeCanvasCode({ state, code });
    send({ type: 'lms-connected', provider: 'canvas', ok: true });
  } catch (e) {
    send({ type: 'lms-connected', provider: 'canvas', ok: false, error: e.message || 'Canvas connection failed' });
  }
});

router.post('/moodle/connect', requireAuth, requireRole('faculty'), async (req, res) => {
  try {
    const { instanceUrl, username, password, service } = req.body || {};
    const connection = await lms.connectMoodle({ facultyId: req.user.id, instanceUrl, username, password, service });
    audit.record(req.user.id, 'create', 'lms_connection', connection.id, { provider: 'moodle' });
    res.status(201).json({ ok: true, connection: { ...connection, ws_token: undefined, access_token: undefined } });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to connect to Moodle' });
  }
});

router.post('/:provider/disconnect', requireAuth, requireRole('faculty'), (req, res) => {
  const result = lms.disconnect(req.user.id, req.params.provider);
  res.json(result);
});

router.get('/:provider/courses', requireAuth, requireRole('faculty'), async (req, res) => {
  try {
    const courses = await lms.listExternalCourses(req.user.id, req.params.provider);
    res.json({ ok: true, courses });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to list courses' });
  }
});

router.post('/:provider/courses/link', requireAuth, requireRole('faculty'), (req, res) => {
  try {
    const { classSection, subject, externalCourseId, externalCourseName } = req.body || {};
    const link = lms.linkCourse({
      facultyId: req.user.id,
      provider: req.params.provider,
      classSection,
      subject,
      externalCourseId,
      externalCourseName,
    });
    res.status(201).json({ ok: true, link });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to link course' });
  }
});

router.get('/:provider/courses/links', requireAuth, requireRole('faculty'), (req, res) => {
  res.json({ ok: true, links: lms.listCourseLinks(req.user.id, req.params.provider) });
});

// Moodle only: list a linked course's existing assignments so faculty
// can map a local assignment onto one (Moodle's public API can grade an
// existing assignment but cannot create new assignment activities).
router.get('/moodle/courses/:courseId/assignments', requireAuth, requireRole('faculty'), async (req, res) => {
  try {
    const list = await lms.listMoodleAssignmentsForCourse(req.user.id, req.params.courseId);
    res.json({ ok: true, assignments: list });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to list Moodle assignments' });
  }
});

router.post('/moodle/assignments/link', requireAuth, requireRole('faculty'), (req, res) => {
  try {
    const { courseLinkId, localAssignmentId, externalAssignmentId, externalCmid, externalAssignmentName } = req.body || {};
    lms.linkAssignment({ courseLinkId, localAssignmentId, externalAssignmentId, externalCmid, externalAssignmentName });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to link assignment' });
  }
});

router.post('/:provider/sync', requireAuth, requireRole('faculty'), async (req, res) => {
  try {
    const { classSection, subject } = req.body || {};
    const fn = req.params.provider === 'canvas' ? lms.syncCanvas : req.params.provider === 'moodle' ? lms.syncMoodle : null;
    if (!fn) return res.status(400).json({ ok: false, error: 'Unknown provider' });
    const result = await fn({ facultyId: req.user.id, classSection, subject });
    audit.record(req.user.id, 'sync', 'lms_connection', req.params.provider, { classSection, ...result });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Sync failed' });
  }
});

router.get('/:provider/sync-logs', requireAuth, requireRole('faculty'), (req, res) => {
  res.json({ ok: true, logs: lms.listSyncLogs(req.user.id, req.params.provider, req.query.limit) });
});

module.exports = router;
