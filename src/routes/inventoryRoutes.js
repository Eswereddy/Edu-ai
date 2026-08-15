// /api/inventory/* — asset/stock items and issue-return tracking.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const inventory = require('../inventory');
const audit = require('../audit');

const router = express.Router();

router.post('/items', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const item = inventory.addItem(req.body || {});
    audit.record(req.user.id, 'create', 'inventory_item', item.id, item);
    res.status(201).json({ ok: true, item });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/items/:id/restock', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const item = inventory.restock(req.params.id, req.body?.qty);
    audit.record(req.user.id, 'restock', 'inventory_item', item.id, { qty: req.body?.qty });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/items', requireAuth, (req, res) => {
  res.json({ ok: true, items: inventory.listItems() });
});

router.post('/issue', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const issue = inventory.issueItem({ ...req.body, issuedBy: req.user.id });
    audit.record(req.user.id, 'issue', 'inventory_issue', issue.id, issue);
    res.status(201).json({ ok: true, issue });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/return/:id', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const issue = inventory.returnItem(req.params.id);
    audit.record(req.user.id, 'return', 'inventory_issue', issue.id, {});
    res.json({ ok: true, issue });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/issues', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, issues: inventory.listIssues({ status: req.query.status }) });
});

router.get('/mine', requireAuth, (req, res) => {
  res.json({ ok: true, issues: inventory.myIssues(req.user.id) });
});

module.exports = router;
