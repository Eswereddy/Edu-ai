// Simple key/value platform settings store — feature flags, banner
// messages, configurable limits the AI Admin portal can toggle without a
// redeploy. Additive module.

const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
`);

const DEFAULTS = {
  'feature.forum': 'true',
  'feature.library': 'true',
  'feature.quizzes': 'true',
  'feature.messaging': 'true',
  'feature.gamification': 'true',
  'announcement.banner': '',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getBool(key, fallback = false) {
  const v = get(key);
  if (v == null) return fallback;
  return v === 'true' || v === '1';
}

function set(key, value, updatedBy) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(key, String(value), updatedBy || null);
  return get(key);
}

function all() {
  const rows = db.prepare('SELECT * FROM settings ORDER BY key').all();
  return rows.reduce((acc, r) => {
    acc[r.key] = r.value;
    return acc;
  }, {});
}

module.exports = { get, getBool, set, all };
