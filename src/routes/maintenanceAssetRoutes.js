// /api/maintenance/* — fixed-asset register with depreciation, and
// work orders anyone can raise for staff to assign/resolve.
// Additive-only; new path, doesn't touch inventory.js.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const maint = require('../maintenanceAssets');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF = ['admin', 'ai-admin'];

// ----------------------------------------------------------------- Assets

router.post('/assets', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const asset = maint.addAsset(req.body);
    audit.record(req.user.id, 'add', 'fixed_asset', asset.id, { name: asset.name, cost: asset.purchase_cost });
    res.status(201).json({ ok: true, asset });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/assets', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, assets: maint.listAssets({ status: req.query.status, category: req.query.category }) });
});

router.get('/assets/:id', requireAuth, requireRole(...STAFF), (req, res) => {
  const asset = maint.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, asset });
});

router.patch('/assets/:id', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const asset = maint.updateAssetStatus({ id: req.params.id, status: req.body?.status });
    audit.record(req.user.id, 'update_status', 'fixed_asset', asset.id, { status: asset.status });
    res.json({ ok: true, asset });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/assets/:id/depreciation', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    res.json({ ok: true, depreciation: maint.calculateDepreciation(req.params.id, req.query.asOf) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------- Work orders

router.post('/work-orders', requireAuth, (req, res) => {
  try {
    const workOrder = maint.raiseWorkOrder({ ...req.body, raisedBy: req.user.id });
    audit.record(req.user.id, 'raise', 'work_order', workOrder.id, { title: workOrder.title, priority: workOrder.priority });
    res.status(201).json({ ok: true, workOrder });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/work-orders/mine', requireAuth, (req, res) => {
  res.json({ ok: true, workOrders: maint.myWorkOrders(req.user.id) });
});

router.get('/work-orders', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({
    ok: true,
    workOrders: maint.listWorkOrders({
      status: req.query.status,
      priority: req.query.priority,
      category: req.query.category,
      assetId: req.query.assetId,
    }),
  });
});

router.get('/work-orders/:id', requireAuth, (req, res) => {
  const workOrder = maint.getWorkOrder(req.params.id);
  if (!workOrder) return res.status(404).json({ ok: false, error: 'Not found' });
  if (workOrder.raised_by !== req.user.id && workOrder.assigned_to !== req.user.id && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }
  res.json({ ok: true, workOrder });
});

router.post('/work-orders/:id/assign', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const workOrder = maint.assignWorkOrder({ id: req.params.id, assignedTo: req.body?.assignedTo });
    audit.record(req.user.id, 'assign', 'work_order', workOrder.id, { assignedTo: workOrder.assigned_to });
    notify.send(workOrder.assigned_to, {
      title: 'Work order assigned to you',
      body: workOrder.title,
      type: 'work_order_assigned',
      meta: { workOrderId: workOrder.id },
    });
    res.json({ ok: true, workOrder });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/work-orders/:id', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const workOrder = maint.updateWorkOrderStatus({
      id: req.params.id,
      status: req.body?.status,
      resolutionNotes: req.body?.resolutionNotes,
      cost: req.body?.cost,
    });
    audit.record(req.user.id, 'update_status', 'work_order', workOrder.id, { status: workOrder.status });
    notify.send(workOrder.raised_by, {
      title: 'Your maintenance request was updated',
      body: `"${workOrder.title}" is now ${workOrder.status.replace('_', ' ')}.`,
      type: 'work_order_updated',
      meta: { workOrderId: workOrder.id, status: workOrder.status },
    });
    res.json({ ok: true, workOrder });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
