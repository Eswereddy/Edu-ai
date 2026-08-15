// /api/transport/* — bus routes, stops, student subscriptions.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const transport = require('../transport');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/routes', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const route = transport.addRoute(req.body || {});
    audit.record(req.user.id, 'create', 'transport_route', route.id, route);
    res.status(201).json({ ok: true, route });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/routes', requireAuth, (req, res) => {
  res.json({ ok: true, routes: transport.listRoutes() });
});

router.post('/routes/:id/stops', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const stop = transport.addStop({ routeId: req.params.id, ...req.body });
    audit.record(req.user.id, 'create', 'transport_stop', stop.id, stop);
    res.status(201).json({ ok: true, stop });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/routes/:id/stops', requireAuth, (req, res) => {
  res.json({ ok: true, stops: transport.listStops(req.params.id) });
});

router.post('/subscribe', requireAuth, requireRole('student'), (req, res) => {
  try {
    const sub = transport.subscribe({ studentId: req.user.id, routeId: req.body?.routeId, stopId: req.body?.stopId });
    audit.record(req.user.id, 'subscribe', 'transport_subscription', sub.id, sub);
    notify.send(req.user.id, {
      title: 'Transport subscription confirmed',
      body: 'You are now subscribed to your selected bus route.',
      type: 'transport_subscribed',
      meta: { subscriptionId: sub.id },
    });
    res.status(201).json({ ok: true, subscription: sub });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/cancel/:id', requireAuth, (req, res) => {
  try {
    const isStaff = ['admin', 'ai-admin'].includes(req.user.role);
    const sub = transport.cancelSubscription(req.params.id, isStaff ? null : req.user.id);
    res.json({ ok: true, subscription: sub });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, subscription: transport.activeSubscriptionForStudent(req.user.id) || null });
});

router.get('/subscriptions', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, subscriptions: transport.listSubscriptions({ status: req.query.status, routeId: req.query.routeId }) });
});

module.exports = router;
