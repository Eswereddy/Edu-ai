// Lightweight audit trail shared by every new feature module added in this
// pass (timetable, assignments, quizzes, library, events, messaging, forum,
// gamification, uploads, settings). Fully additive — its own table, own
// file, nothing here is imported by any pre-existing file.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
`);

const insertStmt = db.prepare(
  'INSERT INTO audit_log (id, user_id, action, entity, entity_id, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
);

/**
 * Record an audit event. Never throws — a logging failure should never
 * break the caller's actual request.
 */
function record(userId, action, entity, entityId, meta) {
  try {
    insertStmt.run(
      crypto.randomUUID(),
      userId || null,
      String(action),
      String(entity),
      entityId != null ? String(entityId) : null,
      meta ? JSON.stringify(meta) : null
    );
  } catch (e) {
    console.error('[audit] failed to record event', e?.message || e);
  }
}

function recent({ entity, userId, limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (entity) {
    sql += ' AND entity = ?';
    params.push(entity);
  }
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(cap);
  return db.prepare(sql).all(...params).map((r) => ({
    ...r,
    meta: r.meta_json ? JSON.parse(r.meta_json) : null,
  }));
}

module.exports = { record, recent };
