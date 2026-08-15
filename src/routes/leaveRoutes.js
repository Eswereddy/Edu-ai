// /api/leave/* — student & faculty leave applications with approval workflow.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const leave = require('../leave');
const notify = require('../notify');
const audit = require('../audit');
const { db } = require('../db');

const router = express.Router();

router.post('/', requireAuth, requireRole('student', 'faculty'), (req, res) => {
  try {
    const request = leave.apply({
      userId: req.user.id,
      userRole: req.user.role,
      leaveType: req.body?.leaveType,
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      reason: req.body?.reason,
    });
    audit.record(req.user.id, 'create', 'leave_request', request.id, { fromDate: request.from_date, toDate: request.to_date });

    // Notify every admin so someone actually sees it to review.
    const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin','faculty')").all();
    for (const a of admins) {
      if (a.id === req.user.id) continue;
      notify.send(a.id, {
        title: 'New leave request',
        body: `${req.user.name} requested leave ${request.from_date} to ${request.to_date}.`,
        type: 'leave_requested',
        meta: { leaveId: request.id, userId: req.user.id },
      });
    }
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, requests: leave.listForUser(req.user.id) });
});

router.get('/pending', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  res.json({ ok: true, requests: leave.listPending() });
});

router.get('/', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  res.json({ ok: true, requests: leave.listAll({ status: req.query.status }) });
});

router.post('/:id/review', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  try {
    const request = leave.review(req.params.id, {
      status: req.body?.status,
      reviewedBy: req.user.id,
      reviewNote: req.body?.reviewNote,
    });
    audit.record(req.user.id, 'review', 'leave_request', request.id, { status: request.status });
    notify.send(request.user_id, {
      title: `Leave request ${request.status}`,
      body: request.review_note || `Your leave request for ${request.from_date} to ${request.to_date} was ${request.status}.`,
      type: 'leave_reviewed',
      meta: { leaveId: request.id, status: request.status },
    });
    res.json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/cancel', requireAuth, (req, res) => {
  try {
    const request = leave.cancel(req.params.id, req.user.id);
    res.json({ ok: true, request });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
