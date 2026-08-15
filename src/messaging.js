// Direct messaging between any two accounts (student<->faculty,
// parent<->faculty, etc). Simple polling model — the frontend can refresh
// on an interval, or a future SSE/WebSocket layer can sit on top without
// changing this data layer. Additive module.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, recipient_id);
`);

function uid() {
  return crypto.randomUUID();
}

function send(senderId, recipientId, body) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Message body cannot be empty');
    err.status = 400;
    throw err;
  }
  if (senderId === recipientId) {
    const err = new Error('Cannot message yourself');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare('INSERT INTO direct_messages (id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)').run(id, senderId, recipientId, text.slice(0, 4000));
  return db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(id);
}

function conversation(userA, userB, { limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  return db
    .prepare(
      `SELECT * FROM direct_messages
       WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
       ORDER BY created_at ASC LIMIT ?`
    )
    .all(userA, userB, userB, userA, cap);
}

function markRead(userId, otherUserId) {
  db.prepare(`UPDATE direct_messages SET is_read = 1 WHERE recipient_id = ? AND sender_id = ? AND is_read = 0`).run(userId, otherUserId);
}

// List of conversation "threads" for a user — one row per counterpart,
// with the latest message and an unread count.
function inbox(userId) {
  const rows = db
    .prepare(
      `SELECT * FROM direct_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at DESC`
    )
    .all(userId, userId);

  const threads = new Map();
  for (const m of rows) {
    const other = m.sender_id === userId ? m.recipient_id : m.sender_id;
    if (!threads.has(other)) {
      threads.set(other, { withUserId: other, lastMessage: m, unreadCount: 0 });
    }
    if (m.recipient_id === userId && !m.is_read) {
      threads.get(other).unreadCount += 1;
    }
  }
  return [...threads.values()];
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) c FROM direct_messages WHERE recipient_id = ? AND is_read = 0').get(userId).c;
}

module.exports = { send, conversation, markRead, inbox, unreadCount };
