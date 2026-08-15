// /api/canteen/* — menu management + order placement/tracking.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const canteen = require('../canteen');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/menu', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const item = canteen.addMenuItem(req.body || {});
    audit.record(req.user.id, 'create', 'canteen_menu', item.id, item);
    res.status(201).json({ ok: true, item });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/menu', requireAuth, (req, res) => {
  res.json({ ok: true, menu: canteen.listMenu({ availableOnly: req.query.availableOnly === 'true' }) });
});

router.patch('/menu/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const item = canteen.setAvailability(req.params.id, req.body?.available);
    res.json({ ok: true, item });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/orders', requireAuth, (req, res) => {
  try {
    const order = canteen.placeOrder({ userId: req.user.id, items: req.body?.items });
    audit.record(req.user.id, 'create', 'canteen_order', order.id, { total: order.total_amount });
    res.status(201).json({ ok: true, order });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/orders/mine', requireAuth, (req, res) => {
  res.json({ ok: true, orders: canteen.myOrders(req.user.id) });
});

router.get('/orders', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, orders: canteen.listOrders({ status: req.query.status }) });
});

router.patch('/orders/:id/status', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const order = canteen.updateStatus(req.params.id, req.body?.status);
    audit.record(req.user.id, 'update_status', 'canteen_order', order.id, { status: order.status });
    notify.send(order.user_id, {
      title: 'Canteen order update',
      body: `Your order is now "${order.status}".`,
      type: 'canteen_order_updated',
      meta: { orderId: order.id, status: order.status },
    });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
