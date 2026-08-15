// /api/events/* — school calendar with per-role visibility and RSVP.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const events = require('../events');
const audit = require('../audit');
const notify = require('../notify'); // additive: notify targeted, currently-online users
const { db } = require('../db');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const event = events.createEvent({ ...req.body, createdBy: req.user.id });
    audit.record(req.user.id, 'create', 'event', event.id, { title: event.title });
    // Notify everyone in the target role (or everyone, if 'all') so it
    // shows up in their notifications list even if they're offline now,
    // and lands instantly for anyone currently connected.
    const targets = event.target_role && event.target_role !== 'all'
      ? db.prepare('SELECT id FROM users WHERE role = ?').all(event.target_role)
      : db.prepare('SELECT id FROM users').all();
    for (const u of targets) {
      notify.send(u.id, {
        title: `New event: ${event.title}`,
        body: `${event.event_date}${event.start_time ? ' at ' + event.start_time : ''}${event.location ? ' — ' + event.location : ''}`,
        type: 'event_created',
        meta: { eventId: event.id },
      });
    }
    res.status(201).json({ ok: true, event });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/upcoming', requireAuth, (req, res) => {
  res.json({ ok: true, events: events.upcomingForRole(req.user.role, { fromDate: req.query.from, limit: req.query.limit }) });
});

router.get('/range', requireAuth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ ok: false, error: 'start and end query params (YYYY-MM-DD) are required' });
  res.json({ ok: true, events: events.allInRange(start, end) });
});

router.get('/:id', requireAuth, (req, res) => {
  const event = events.getEvent(req.params.id);
  if (!event) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, event, rsvpSummary: events.rsvpSummary(req.params.id) });
});

router.patch('/:id', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const event = events.updateEvent(req.params.id, req.body || {});
    res.json({ ok: true, event });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  const removed = events.deleteEvent(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  audit.record(req.user.id, 'delete', 'event', req.params.id, null);
  res.json({ ok: true });
});

router.post('/:id/rsvp', requireAuth, (req, res) => {
  try {
    const rsvp = events.rsvp(req.params.id, req.user.id, req.body?.status);
    res.json({ ok: true, rsvp });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
