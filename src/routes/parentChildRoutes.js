// /api/parent/children/* — request/approve links between a parent
// account and one or more student accounts. Requesting is parent-only;
// reviewing is faculty/admin-only (mirrors the leave-request approval
// pattern in leaveRoutes.js). A parent can only ever see/cancel their
// own requests.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const parentChildren = require('../parentChildren');
const notify = require('../notify');
const audit = require('../audit');
const { db } = require('../db');

const router = express.Router();

router.post('/', requireAuth, requireRole('parent'), (req, res) => {
  try {
    const link = parentChildren.requestLink({ parentId: req.user.id, studentId: req.body?.studentId, note: req.body?.note });
    audit.record(req.user.id, 'create', 'parent_child_link', link.id, { studentId: link.student_id });
    const staff = db.prepare("SELECT id FROM users WHERE role IN ('admin','faculty')").all();
    for (const s of staff) {
      notify.send(s.id, {
        title: 'New parent-child link request',
        body: `${req.user.name} requested to be linked to a student account.`,
        type: 'parent_link_requested',
        meta: { linkId: link.id, parentId: req.user.id, studentId: link.student_id },
      });
    }
    res.status(201).json({ ok: true, link });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/', requireAuth, requireRole('parent'), (req, res) => {
  res.json({ ok: true, links: parentChildren.listForParent(req.user.id, { status: req.query.status }) });
});

router.get('/pending', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  res.json({ ok: true, links: parentChildren.listPending() });
});

router.post('/:id/review', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const link = parentChildren.review(req.params.id, {
      status: req.body?.status,
      reviewedBy: req.user.id,
      reviewNote: req.body?.reviewNote,
    });
    audit.record(req.user.id, 'review', 'parent_child_link', link.id, { status: link.status });
    notify.send(link.parent_id, {
      title: `Child link request ${link.status}`,
      body: link.review_note || `Your request was ${link.status}.`,
      type: 'parent_link_reviewed',
      meta: { linkId: link.id, status: link.status },
    });
    res.json({ ok: true, link });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', requireAuth, requireRole('parent'), (req, res) => {
  const removed = parentChildren.removeLink(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'parent_child_link', req.params.id, null);
  res.json({ ok: true });
});

module.exports = router;
