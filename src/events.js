// School events / calendar with RSVP tracking. Additive module.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  target_role TEXT NOT NULL DEFAULT 'all',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('going','maybe','declined')) DEFAULT 'going',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_rsvps_event ON event_rsvps(event_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createEvent({ title, description, eventDate, startTime, endTime, location, targetRole, createdBy }) {
  if (!title || !eventDate) {
    const err = new Error('title and eventDate are required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO events (id, title, description, event_date, start_time, end_time, location, target_role, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, description || null, eventDate, startTime || null, endTime || null, location || null, targetRole || 'all', createdBy || null);
  return getEvent(id);
}

function getEvent(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) || null;
}

function updateEvent(id, patch) {
  const existing = getEvent(id);
  if (!existing) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }
  const map = { title: 'title', description: 'description', eventDate: 'event_date', startTime: 'start_time', endTime: 'end_time', location: 'location', targetRole: 'target_role' };
  const sets = [];
  const params = [];
  for (const [jsKey, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, jsKey)) {
      sets.push(`${col} = ?`);
      params.push(patch[jsKey]);
    }
  }
  if (!sets.length) return existing;
  params.push(id);
  db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getEvent(id);
}

function deleteEvent(id) {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0;
}

function upcomingForRole(role, { fromDate, limit = 50 } = {}) {
  const from = fromDate || new Date().toISOString().slice(0, 10);
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  return db
    .prepare(
      `SELECT * FROM events WHERE event_date >= ? AND (target_role = 'all' OR target_role = ?)
       ORDER BY event_date ASC, start_time ASC LIMIT ?`
    )
    .all(from, role, cap);
}

function allInRange(startDate, endDate) {
  return db
    .prepare('SELECT * FROM events WHERE event_date BETWEEN ? AND ? ORDER BY event_date ASC')
    .all(startDate, endDate);
}

function rsvp(eventId, userId, status) {
  const event = getEvent(eventId);
  if (!event) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }
  const validStatuses = ['going', 'maybe', 'declined'];
  const s = validStatuses.includes(status) ? status : 'going';
  db.prepare(
    `INSERT INTO event_rsvps (id, event_id, user_id, status) VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`
  ).run(uid(), eventId, userId, s);
  return db.prepare('SELECT * FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(eventId, userId);
}

function rsvpSummary(eventId) {
  const rows = db.prepare('SELECT status, COUNT(*) c FROM event_rsvps WHERE event_id = ? GROUP BY status').all(eventId);
  const summary = { going: 0, maybe: 0, declined: 0 };
  for (const r of rows) summary[r.status] = r.c;
  return summary;
}

module.exports = { createEvent, getEvent, updateEvent, deleteEvent, upcomingForRole, allInRange, rsvp, rsvpSummary };
