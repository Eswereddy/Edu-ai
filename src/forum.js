// Discussion forum: threads + replies + upvotes, scoped by role/subject
// tags so a "Doubts" or "General Discussion" section can filter easily.
// Additive module.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS forum_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT,
  title TEXT NOT NULL,
  body TEXT,
  tags TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forum_replies (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forum_votes (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK(value IN (-1, 1)),
  UNIQUE(thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_thread ON forum_votes(thread_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createThread({ userId, role, title, body, tags }) {
  if (!title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  const tagStr = Array.isArray(tags) ? tags.join(',') : tags || null;
  db.prepare('INSERT INTO forum_threads (id, user_id, role, title, body, tags) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, role || null, title, body || null, tagStr);
  return getThread(id);
}

function getThread(id) {
  const row = db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, tags: row.tags ? row.tags.split(',') : [], score: threadScore(id), replyCount: replyCount(id) };
}

function threadScore(threadId) {
  const row = db.prepare('SELECT COALESCE(SUM(value), 0) score FROM forum_votes WHERE thread_id = ?').get(threadId);
  return row.score;
}

function replyCount(threadId) {
  return db.prepare('SELECT COUNT(*) c FROM forum_replies WHERE thread_id = ?').get(threadId).c;
}

function listThreads({ tag, limit = 50, sort = 'recent' } = {}) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  let rows = db.prepare('SELECT * FROM forum_threads ORDER BY created_at DESC').all();
  if (tag) rows = rows.filter((r) => (r.tags || '').split(',').includes(tag));
  const enriched = rows.map((r) => ({ ...r, tags: r.tags ? r.tags.split(',') : [], score: threadScore(r.id), replyCount: replyCount(r.id) }));
  if (sort === 'top') enriched.sort((a, b) => b.score - a.score);
  return enriched.slice(0, cap);
}

function addReply(threadId, userId, body) {
  const thread = db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(threadId);
  if (!thread) {
    const err = new Error('Thread not found');
    err.status = 404;
    throw err;
  }
  if (thread.is_locked) {
    const err = new Error('Thread is locked');
    err.status = 403;
    throw err;
  }
  if (!body || !String(body).trim()) {
    const err = new Error('Reply body cannot be empty');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare('INSERT INTO forum_replies (id, thread_id, user_id, body) VALUES (?, ?, ?, ?)').run(id, threadId, userId, String(body).trim());
  return db.prepare('SELECT * FROM forum_replies WHERE id = ?').get(id);
}

function listReplies(threadId) {
  return db.prepare('SELECT * FROM forum_replies WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);
}

function vote(threadId, userId, value) {
  const v = Number(value) === -1 ? -1 : 1;
  db.prepare(
    `INSERT INTO forum_votes (id, thread_id, user_id, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(thread_id, user_id) DO UPDATE SET value = excluded.value`
  ).run(uid(), threadId, userId, v);
  return threadScore(threadId);
}

function lockThread(threadId, locked) {
  db.prepare('UPDATE forum_threads SET is_locked = ? WHERE id = ?').run(locked ? 1 : 0, threadId);
  return getThread(threadId);
}

function deleteThread(threadId, userId, isModerator) {
  const thread = db.prepare('SELECT * FROM forum_threads WHERE id = ?').get(threadId);
  if (!thread) return false;
  if (!isModerator && thread.user_id !== userId) {
    const err = new Error('Not your thread');
    err.status = 403;
    throw err;
  }
  db.prepare('DELETE FROM forum_threads WHERE id = ?').run(threadId);
  return true;
}

module.exports = { createThread, getThread, listThreads, addReply, listReplies, vote, lockThread, deleteThread };
