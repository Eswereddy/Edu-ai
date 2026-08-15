// Real-time notification hub. Fully additive — new file, own table usage
// (reuses the existing `notifications` table created in db.js so nothing
// about that schema changes), and a thin in-memory WebSocket registry.
//
// Two things happen every time `notify.send()` is called:
//   1. The notification is persisted to the `notifications` table, so it
//      shows up via the existing GET /api/notifications route even for a
//      user who is offline right now.
//   2. If that user currently has a live WebSocket connection (see
//      src/ws.js), the same notification is pushed to them instantly —
//      no polling needed.
//
// Every other module (assignments, quiz, forum, events, messaging,
// gamification, library) calls `notify.send(userId, {...})` — they never
// touch WebSockets directly, so this stays the single place that knows
// about "how a user finds out something happened".

const crypto = require('crypto');
const { db } = require('./db');
// ADDED — real push (Firebase) + email (SMTP) delivery, on top of the
// persisted-row + live-WebSocket delivery this file already did. See
// notificationDelivery.js for what this actually does; it degrades to a
// safe no-op if push/email aren't configured, so nothing below changes.
const { deliverAcrossChannels } = require('./notificationDelivery');

// userId -> Set of live WebSocket connections (a user can have more than
// one tab/device open at once).
const sockets = new Map();

function registerSocket(userId, ws) {
  if (!sockets.has(userId)) sockets.set(userId, new Set());
  sockets.get(userId).add(ws);
}

function unregisterSocket(userId, ws) {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sockets.delete(userId);
}

function isOnline(userId) {
  return sockets.has(userId);
}

function onlineCount() {
  return sockets.size;
}

const insertStmt = db.prepare(
  'INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)'
);

/**
 * Create + persist + (if online) instantly push a notification.
 * `extra` is optional structured data (e.g. { type: 'assignment_graded',
 * assignmentId }) merged into the live WS push only — the notifications
 * table itself only ever stores title/body, so this never touches its
 * existing schema.
 */
function send(userId, { title, body, type, meta } = {}) {
  if (!userId || !title) return null;
  const id = crypto.randomUUID();
  try {
    insertStmt.run(id, userId, String(title).slice(0, 200), body ? String(body).slice(0, 2000) : null);
  } catch (e) {
    console.error('[notify] failed to persist notification', e?.message || e);
  }

  const payload = {
    kind: 'notification',
    id,
    title,
    body: body || null,
    type: type || 'general',
    meta: meta || null,
    createdAt: new Date().toISOString(),
  };
  pushRaw(userId, payload);
  // ADDED — best-effort, fire-and-forget push + email so this
  // notification also reaches a closed mobile app or an inbox, not only
  // a currently-open WebSocket tab. Never awaited, never throws, and
  // does not change what send() returns.
  deliverAcrossChannels(userId, payload).catch(() => {});
  return payload;
}

/** Push an arbitrary real-time event to a user without touching the
 * notifications table — used for things that already have their own
 * storage, like direct messages (messaging.js) or forum replies. */
function pushRaw(userId, payload) {
  const set = sockets.get(userId);
  if (!set || set.size === 0) return false;
  const text = JSON.stringify(payload);
  for (const ws of set) {
    try {
      if (ws.readyState === 1 /* OPEN */) ws.send(text);
    } catch (e) {
      console.error('[notify] failed to push to socket', e?.message || e);
    }
  }
  return true;
}

/** Broadcast the same notification to every currently-connected user with
 * a given role — used for role-targeted events/announcements. `roleOf` is
 * a lookup function (userId) => role, since sockets only key by userId. */
function sendToRole(role, roleOfFn, notification) {
  let count = 0;
  for (const userId of sockets.keys()) {
    if (roleOfFn(userId) === role || role === 'all') {
      send(userId, notification);
      count += 1;
    }
  }
  return count;
}

module.exports = { registerSocket, unregisterSocket, isOnline, onlineCount, send, pushRaw, sendToRole };
