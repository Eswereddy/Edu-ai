// Student profile: bio, social links, avatar (reuses the existing uploads
// module for the actual file), and per-user UI preferences (theme,
// language, accessibility). Fully additive — own table, own file, does
// not touch `users` or `uploads.js`.

const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id TEXT PRIMARY KEY,
  bio TEXT,
  social_links_json TEXT,
  avatar_upload_id TEXT,
  theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system')),
  language TEXT NOT NULL DEFAULT 'en',
  font_size TEXT NOT NULL DEFAULT 'medium' CHECK(font_size IN ('small','medium','large','x-large')),
  high_contrast INTEGER NOT NULL DEFAULT 0,
  reduce_motion INTEGER NOT NULL DEFAULT 0,
  screen_reader_hints INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const ALLOWED_SOCIAL_KEYS = ['linkedin', 'github', 'twitter', 'instagram', 'portfolio', 'leetcode'];

function serialize(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    bio: row.bio || '',
    socialLinks: row.social_links_json ? JSON.parse(row.social_links_json) : {},
    avatarUploadId: row.avatar_upload_id || null,
    preferences: {
      theme: row.theme,
      language: row.language,
      fontSize: row.font_size,
      highContrast: Boolean(row.high_contrast),
      reduceMotion: Boolean(row.reduce_motion),
      screenReaderHints: Boolean(row.screen_reader_hints),
    },
    updatedAt: row.updated_at,
  };
}

function getProfile(userId) {
  const row = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(userId);
  return serialize(row) || serialize({ user_id: userId, theme: 'system', language: 'en', font_size: 'medium', high_contrast: 0, reduce_motion: 0, screen_reader_hints: 0 });
}

function upsertProfile(userId, patch) {
  const existing = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(userId);
  const base = existing || {
    user_id: userId, bio: null, social_links_json: null, avatar_upload_id: null,
    theme: 'system', language: 'en', font_size: 'medium', high_contrast: 0, reduce_motion: 0, screen_reader_hints: 0,
  };

  let socialLinksJson = base.social_links_json;
  if (patch.socialLinks && typeof patch.socialLinks === 'object') {
    const clean = {};
    for (const key of ALLOWED_SOCIAL_KEYS) {
      if (patch.socialLinks[key]) clean[key] = String(patch.socialLinks[key]).slice(0, 300);
    }
    socialLinksJson = JSON.stringify(clean);
  }

  const merged = {
    bio: patch.bio != null ? String(patch.bio).slice(0, 2000) : base.bio,
    social_links_json: socialLinksJson,
    avatar_upload_id: patch.avatarUploadId != null ? patch.avatarUploadId : base.avatar_upload_id,
    theme: ['light', 'dark', 'system'].includes(patch.theme) ? patch.theme : base.theme,
    language: patch.language ? String(patch.language).slice(0, 10) : base.language,
    font_size: ['small', 'medium', 'large', 'x-large'].includes(patch.fontSize) ? patch.fontSize : base.font_size,
    high_contrast: patch.highContrast != null ? (patch.highContrast ? 1 : 0) : base.high_contrast,
    reduce_motion: patch.reduceMotion != null ? (patch.reduceMotion ? 1 : 0) : base.reduce_motion,
    screen_reader_hints: patch.screenReaderHints != null ? (patch.screenReaderHints ? 1 : 0) : base.screen_reader_hints,
  };

  db.prepare(
    `INSERT INTO student_profiles (user_id, bio, social_links_json, avatar_upload_id, theme, language, font_size, high_contrast, reduce_motion, screen_reader_hints, updated_at)
     VALUES (@user_id, @bio, @social_links_json, @avatar_upload_id, @theme, @language, @font_size, @high_contrast, @reduce_motion, @screen_reader_hints, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       bio = excluded.bio, social_links_json = excluded.social_links_json, avatar_upload_id = excluded.avatar_upload_id,
       theme = excluded.theme, language = excluded.language, font_size = excluded.font_size,
       high_contrast = excluded.high_contrast, reduce_motion = excluded.reduce_motion,
       screen_reader_hints = excluded.screen_reader_hints, updated_at = datetime('now')`
  ).run({ user_id: userId, ...merged });

  return getProfile(userId);
}

module.exports = { getProfile, upsertProfile };
