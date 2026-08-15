// Cross-portal language preference. student_profiles already has a
// per-student `language` column (see studentProfile.js), but that table
// only exists for the student role — this app also has faculty, parent,
// admin, and ai-admin logins with no equivalent. This is a small,
// separate, role-agnostic table so "multilingual in all portals" has one
// preference store that works for every account, without touching
// studentProfile.js. Fully additive.

const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS user_language_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'en',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function getLanguage(userId) {
  const row = db.prepare('SELECT language FROM user_language_prefs WHERE user_id = ?').get(userId);
  return row?.language || 'en';
}

function setLanguage(userId, language) {
  db.prepare(
    `INSERT INTO user_language_prefs (user_id, language, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, updated_at = datetime('now')`
  ).run(userId, language);
  return { userId, language };
}

module.exports = { getLanguage, setLanguage };
