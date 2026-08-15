// /api/push/* — mobile push device registration. A native/mobile app
// (or a future web-push service worker) obtains an FCM token via the
// Firebase client SDK and registers it here against the logged-in user;
// notify.js -> notificationDelivery.js -> push.js then fans every
// future notification out to it automatically. Available to any
// authenticated role, since every portal's users benefit — the student
// portal frontend is what currently calls it.
const express = require('express');
const { requireAuth } = require('../auth');
const push = require('../push');
const email = require('../email');
const notify = require('../notify');

const router = express.Router();
router.use(requireAuth);

router.post('/device-token', (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'token is required' });
    const row = push.registerToken(req.user.id, token, platform || 'unknown');
    res.status(201).json({ ok: true, device: row, pushConfigured: push.isConfigured() });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/device-token', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'token is required' });
  res.json({ ok: true, ...push.unregisterToken(req.user.id, token) });
});

router.get('/device-tokens', (req, res) => {
  res.json({ ok: true, devices: push.listTokens(req.user.id) });
});

// Delivery status — lets the frontend show "email delivery is live" /
// "push isn't configured on this server yet" instead of guessing.
router.get('/status', (req, res) => {
  res.json({ ok: true, pushConfigured: push.isConfigured(), emailConfigured: email.isConfigured() });
});

// Sends the caller a real end-to-end test notification through every
// channel (persisted + WebSocket + push + email) so they can verify
// delivery is actually working after configuring SMTP/Firebase.
router.post('/test', (req, res) => {
  const payload = notify.send(req.user.id, {
    title: '🔔 Test notification',
    body: 'If you are seeing this by email or on your phone, real-time delivery is working.',
    type: 'delivery_test',
  });
  res.json({ ok: true, notification: payload });
});

module.exports = router;
