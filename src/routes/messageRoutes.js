// /api/messages/* — direct messaging between any two accounts.
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const messaging = require('../messaging');
const notify = require('../notify'); // additive: instant push for new DMs
const { writeLimiter } = require('../rateLimiters'); // additive: throttle message spam

const router = express.Router();

router.get('/inbox', requireAuth, (req, res) => {
  const threads = messaging.inbox(req.user.id).map((t) => {
    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(t.withUserId);
    return { ...t, withUser: user || { id: t.withUserId, name: 'Unknown', role: null } };
  });
  res.json({ ok: true, threads, unreadCount: messaging.unreadCount(req.user.id) });
});

router.get('/with/:userId', requireAuth, (req, res) => {
  const thread = messaging.conversation(req.user.id, req.params.userId, { limit: req.query.limit });
  messaging.markRead(req.user.id, req.params.userId);
  res.json({ ok: true, messages: thread });
});

router.post('/with/:userId', requireAuth, writeLimiter, (req, res) => {
  try {
    const message = messaging.send(req.user.id, req.params.userId, req.body?.body);
    // Instant push if the recipient is online; falls back to the normal
    // unread-count-on-inbox flow (already existed) if they're not.
    notify.pushRaw(req.params.userId, {
      kind: 'direct_message',
      message,
      fromUserId: req.user.id,
      fromName: req.user.name,
    });
    res.status(201).json({ ok: true, message });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
