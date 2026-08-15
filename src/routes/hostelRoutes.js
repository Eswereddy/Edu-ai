// /api/hostel/* — room inventory + allocation workflow.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const hostel = require('../hostel');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/rooms', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const room = hostel.addRoom(req.body || {});
    audit.record(req.user.id, 'create', 'hostel_room', room.id, room);
    res.status(201).json({ ok: true, room });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/rooms', requireAuth, (req, res) => {
  res.json({ ok: true, rooms: hostel.listRooms({ hostelName: req.query.hostelName }) });
});

router.post('/allocate', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const allocation = hostel.allocate({
      roomId: req.body?.roomId,
      studentId: req.body?.studentId,
      allocatedBy: req.user.id,
    });
    audit.record(req.user.id, 'allocate', 'hostel_allocation', allocation.id, allocation);
    notify.send(allocation.student_id, {
      title: 'Hostel room allocated',
      body: 'A hostel room has been allocated to you. Check the hostel portal for details.',
      type: 'hostel_allocated',
      meta: { allocationId: allocation.id },
    });
    res.status(201).json({ ok: true, allocation });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/vacate/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const allocation = hostel.vacate(req.params.id);
    audit.record(req.user.id, 'vacate', 'hostel_allocation', allocation.id, {});
    res.json({ ok: true, allocation });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/mine', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, allocation: hostel.activeAllocationForStudent(req.user.id) || null });
});

router.get('/allocations', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, allocations: hostel.listAllocations({ status: req.query.status }) });
});

module.exports = router;
