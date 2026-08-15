// /api/security/* — visitor QR passes + check-in/out, CCTV camera
// registry, and parking slot allocation + entry/exit logs.
// Additive-only; new path, doesn't touch any existing module.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const security = require('../security');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF = ['admin', 'ai-admin'];

// ------------------------------------------------------------ Visitors

router.post('/visitors', requireAuth, (req, res) => {
  try {
    const visitor = security.createVisitorPass({
      ...req.body,
      hostUserId: req.body?.hostUserId || req.user.id,
      createdBy: req.user.id,
    });
    audit.record(req.user.id, 'create', 'visitor', visitor.id, { name: visitor.name });
    res.status(201).json({ ok: true, visitor });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/visitors/mine', requireAuth, (req, res) => {
  res.json({ ok: true, visitors: security.myVisitors(req.user.id) });
});

router.get('/visitors', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({
    ok: true,
    visitors: security.listVisitors({ status: req.query.status, hostUserId: req.query.hostUserId, from: req.query.from, to: req.query.to }),
  });
});

router.get('/visitors/:id', requireAuth, (req, res) => {
  const visitor = security.getVisitor(req.params.id);
  if (!visitor) return res.status(404).json({ ok: false, error: 'Not found' });
  if (visitor.host_user_id !== req.user.id && !STAFF.includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }
  res.json({ ok: true, visitor });
});

router.post('/visitors/check-in', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const visitor = security.checkInVisitor({ id: req.body?.id, qrCode: req.body?.qrCode, checkedInBy: req.user.id });
    audit.record(req.user.id, 'check_in', 'visitor', visitor.id, {});
    if (visitor.host_user_id) {
      notify.send(visitor.host_user_id, {
        title: 'Your visitor has arrived',
        body: `${visitor.name} has checked in at the gate.`,
        type: 'visitor_checked_in',
        meta: { visitorId: visitor.id },
      });
    }
    res.json({ ok: true, visitor });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/visitors/:id/check-out', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const visitor = security.checkOutVisitor({ id: req.params.id, checkedOutBy: req.user.id });
    audit.record(req.user.id, 'check_out', 'visitor', visitor.id, {});
    res.json({ ok: true, visitor });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/visitors/:id/cancel', requireAuth, (req, res) => {
  try {
    const visitor = security.getVisitor(req.params.id);
    if (!visitor) return res.status(404).json({ ok: false, error: 'Not found' });
    if (visitor.host_user_id !== req.user.id && !STAFF.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }
    const cancelled = security.cancelVisitorPass(req.params.id);
    audit.record(req.user.id, 'cancel', 'visitor', cancelled.id, {});
    res.json({ ok: true, visitor: cancelled });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// --------------------------------------------------------------- CCTV

router.post('/cameras', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const camera = security.addCamera(req.body);
    audit.record(req.user.id, 'add', 'cctv_camera', camera.id, { location: camera.location });
    res.status(201).json({ ok: true, camera });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/cameras', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, cameras: security.listCameras({ status: req.query.status, location: req.query.location }) });
});

router.patch('/cameras/:id', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const camera = security.updateCameraStatus({ id: req.params.id, status: req.body?.status });
    audit.record(req.user.id, 'update_status', 'cctv_camera', camera.id, { status: camera.status });
    res.json({ ok: true, camera });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ------------------------------------------------------------- Parking

router.post('/parking/slots', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const slot = security.addParkingSlot(req.body);
    audit.record(req.user.id, 'add', 'parking_slot', slot.id, { slotNumber: slot.slot_number });
    res.status(201).json({ ok: true, slot });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/parking/slots', requireAuth, (req, res) => {
  res.json({ ok: true, slots: security.listParkingSlots({ status: req.query.status, vehicleType: req.query.vehicleType }) });
});

router.post('/parking/entry', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const log = security.logEntry({ ...req.body, loggedBy: req.user.id });
    audit.record(req.user.id, 'log_entry', 'parking_log', log.id, { vehicleNumber: log.vehicle_number });
    res.status(201).json({ ok: true, log });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/parking/logs/:id/exit', requireAuth, requireRole(...STAFF), (req, res) => {
  try {
    const log = security.logExit(req.params.id);
    audit.record(req.user.id, 'log_exit', 'parking_log', log.id, {});
    res.json({ ok: true, log });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/parking/logs', requireAuth, requireRole(...STAFF), (req, res) => {
  res.json({ ok: true, logs: security.listParkingLogs({ slotId: req.query.slotId, active: req.query.active === 'true' }) });
});

module.exports = router;
