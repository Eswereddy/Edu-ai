// /api/transport/* — additive companion to transportRoutes.js and
// busTrackingRoutes.js (same layering pattern already used for
// payrollRoutes + payrollTaxRoutes). Adds real GPS ingestion + a
// WebSocket-aware "enhanced" live view. Nothing in the two files above
// is modified.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const bus = require('../busTracking');
const live = require('../busTrackingLive');

const router = express.Router();

// Driver/admin/faculty device posts a real GPS fix here, repeatedly
// (e.g. every 5-10s via navigator.geolocation.watchPosition on the
// driver's phone — see the frontend gpsWatch helpers). Unlike the
// existing POST /api/transport/live/:routeId (busTrackingRoutes.js),
// which only stores the position, this also pushes it live to every
// subscribed parent/student over WebSocket.
router.post('/gps/:routeId', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const location = live.reportRealGps(req.params.routeId, { ...req.body, reportedBy: req.user.id });
    res.json({ ok: true, location });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Same payload as GET /api/transport/live/:routeId, plus a client-safe
// Google Maps JS API key (if the server has one configured) and the WS
// event name to listen for, so the frontend can render a real Google
// Map with live marker updates instead of a static embedded iframe.
// Google Maps JS API keys are meant to be used client-side and are
// locked down by HTTP-referrer restriction in the Google Cloud
// Console, not by keeping them secret — so exposing it here is normal
// practice, the same way it's normal in any Maps-embedding webpage.
router.get('/live-enhanced/:routeId', requireAuth, (req, res) => {
  try {
    const liveData = bus.liveForRoute(req.params.routeId);
    res.json({
      ok: true,
      live: liveData,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
      wsEvent: 'bus_location',
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
