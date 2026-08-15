// /api/meetings/* — meeting requests with suggest-slot / confirm / cancel.
const express = require('express');
const { requireAuth } = require('../auth');
const meetings = require('../meetings');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  try {
    const meeting = meetings.requestMeeting({
      requesterId: req.user.id,
      recipientId: req.body?.recipientId,
      topic: req.body?.topic,
      requestedDate: req.body?.requestedDate,
      requestedTime: req.body?.requestedTime,
    });
    audit.record(req.user.id, 'create', 'meeting_request', meeting.id);
    notify.send(meeting.recipient_id, {
      title: 'New meeting request',
      body: `${req.user.name} requested a meeting: ${meeting.topic}`,
      type: 'meeting_requested',
      meta: { meetingId: meeting.id },
    });
    res.status(201).json({ ok: true, meeting });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to request meeting' });
  }
});

router.get('/mine', (req, res) => {
  res.json({ ok: true, meetings: meetings.listForUser(req.user.id) });
});

router.post('/:id/suggest-slot', (req, res) => {
  try {
    const meeting = meetings.suggestSlot(req.params.id, req.user.id, { date: req.body?.date, time: req.body?.time });
    audit.record(req.user.id, 'suggest_slot', 'meeting_request', req.params.id);
    notify.send(meeting.requester_id, {
      title: 'Alternate meeting slot suggested',
      body: `A new slot was suggested: ${meeting.suggested_date} ${meeting.suggested_time}`,
      type: 'meeting_slot_suggested',
      meta: { meetingId: meeting.id },
    });
    res.json({ ok: true, meeting });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to suggest slot' });
  }
});

router.post('/:id/confirm', (req, res) => {
  try {
    const meeting = meetings.confirm(req.params.id, req.user.id);
    audit.record(req.user.id, 'confirm', 'meeting_request', req.params.id);
    res.json({ ok: true, meeting });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to confirm meeting' });
  }
});

router.post('/:id/decline', (req, res) => {
  try {
    const meeting = meetings.decline(req.params.id, req.user.id);
    audit.record(req.user.id, 'decline', 'meeting_request', req.params.id);
    res.json({ ok: true, meeting });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to decline meeting' });
  }
});

router.post('/:id/cancel', (req, res) => {
  try {
    const meeting = meetings.cancel(req.params.id, req.user.id);
    audit.record(req.user.id, 'cancel', 'meeting_request', req.params.id);
    res.json({ ok: true, meeting });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to cancel meeting' });
  }
});

module.exports = router;
