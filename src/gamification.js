// Gamification: points ledger, badges, and a per-role leaderboard. Meant to
// be called from other modules (assignments, quizzes) as well as exposed
// directly via routes/gamificationRoutes.js. Additive module.

const { db } = require('./db');
const crypto = require('crypto');
const notify = require('./notify'); // additive: instant badge-earned push

db.exec(`
CREATE TABLE IF NOT EXISTS points_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  threshold_points INTEGER
);

CREATE TABLE IF NOT EXISTS user_badges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
`);

function uid() {
  return crypto.randomUUID();
}

// Seed a small default badge set, once, without ever overwriting
// admin-edited badges on later restarts.
const DEFAULT_BADGES = [
  { code: 'first-steps', name: 'First Steps', description: 'Earned your first points', threshold_points: 1, icon: '🌱' },
  { code: 'rising-star', name: 'Rising Star', description: 'Reached 100 points', threshold_points: 100, icon: '⭐' },
  { code: 'high-achiever', name: 'High Achiever', description: 'Reached 500 points', threshold_points: 500, icon: '🏆' },
  { code: 'legend', name: 'Legend', description: 'Reached 1500 points', threshold_points: 1500, icon: '👑' },
];
for (const b of DEFAULT_BADGES) {
  const existing = db.prepare('SELECT id FROM badges WHERE code = ?').get(b.code);
  if (!existing) {
    db.prepare('INSERT INTO badges (id, code, name, description, icon, threshold_points) VALUES (?, ?, ?, ?, ?, ?)').run(
      uid(), b.code, b.name, b.description, b.icon, b.threshold_points
    );
  }
}

function totalPoints(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(points), 0) total FROM points_ledger WHERE user_id = ?').get(userId);
  return row.total;
}

function awardPoints(userId, points, reason) {
  const n = Math.round(Number(points));
  if (!userId || !n) return { userId, total: totalPoints(userId), newBadges: [] };
  db.prepare('INSERT INTO points_ledger (id, user_id, points, reason) VALUES (?, ?, ?, ?)').run(uid(), userId, n, reason || null);
  const total = totalPoints(userId);
  const newBadges = checkAndAwardBadges(userId, total);
  for (const badge of newBadges) {
    notify.send(userId, {
      title: `New badge: ${badge.name}`,
      body: badge.description || `You reached ${badge.threshold_points} points.`,
      type: 'badge_earned',
      meta: { badgeCode: badge.code, icon: badge.icon },
    });
  }
  return { userId, total, newBadges };
}

function checkAndAwardBadges(userId, total) {
  const eligible = db
    .prepare('SELECT * FROM badges WHERE threshold_points IS NOT NULL AND threshold_points <= ?')
    .all(total);
  const already = new Set(db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(userId).map((r) => r.badge_id));
  const awarded = [];
  for (const badge of eligible) {
    if (already.has(badge.id)) continue;
    db.prepare('INSERT INTO user_badges (id, user_id, badge_id) VALUES (?, ?, ?)').run(uid(), userId, badge.id);
    awarded.push(badge);
  }
  return awarded;
}

function history(userId, limit = 50) {
  return db.prepare('SELECT * FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, Math.min(200, Number(limit) || 50));
}

function badgesForUser(userId) {
  return db
    .prepare('SELECT b.* , ub.awarded_at FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC')
    .all(userId);
}

function allBadges() {
  return db.prepare('SELECT * FROM badges ORDER BY threshold_points ASC').all();
}

// Leaderboard across all users who have any points, optionally scoped to
// a set of user ids (e.g. a class section resolved by the caller).
function leaderboard({ userIds, limit = 20 } = {}) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 20));
  let rows;
  if (Array.isArray(userIds) && userIds.length) {
    const placeholders = userIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT user_id, COALESCE(SUM(points),0) total FROM points_ledger
         WHERE user_id IN (${placeholders}) GROUP BY user_id ORDER BY total DESC LIMIT ?`
      )
      .all(...userIds, cap);
  } else {
    rows = db
      .prepare('SELECT user_id, COALESCE(SUM(points),0) total FROM points_ledger GROUP BY user_id ORDER BY total DESC LIMIT ?')
      .all(cap);
  }
  return rows.map((r, i) => ({ rank: i + 1, userId: r.user_id, total: r.total }));
}

module.exports = { awardPoints, totalPoints, history, badgesForUser, allBadges, leaderboard };
