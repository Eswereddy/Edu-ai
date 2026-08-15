// Reward store: a small catalog of redeemable rewards, backed by the
// existing gamification points ledger (src/gamification.js, untouched —
// this reads totalPoints() and calls the existing awardPoints() with a
// negative amount to deduct, exactly like any other points event).
// Fully additive — own tables, own file.

const crypto = require('crypto');
const { db } = require('./db');
const gamification = require('./gamification');

db.exec(`
CREATE TABLE IF NOT EXISTS reward_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cost_points INTEGER NOT NULL CHECK(cost_points > 0),
  stock INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reward_id TEXT NOT NULL REFERENCES reward_catalog(id),
  cost_points INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'redeemed' CHECK(status IN ('redeemed','fulfilled','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON reward_redemptions(user_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addReward({ name, description, costPoints, stock }) {
  if (!name || !costPoints) throw Object.assign(new Error('name and costPoints are required'), { status: 400 });
  const id = uid();
  db.prepare('INSERT INTO reward_catalog (id, name, description, cost_points, stock) VALUES (?, ?, ?, ?, ?)').run(
    id, name, description || null, Number(costPoints), stock != null ? Number(stock) : null
  );
  return db.prepare('SELECT * FROM reward_catalog WHERE id = ?').get(id);
}

function listRewards({ activeOnly = true } = {}) {
  return activeOnly
    ? db.prepare('SELECT * FROM reward_catalog WHERE active = 1 ORDER BY cost_points ASC').all()
    : db.prepare('SELECT * FROM reward_catalog ORDER BY cost_points ASC').all();
}

function redeem(userId, rewardId) {
  const reward = db.prepare('SELECT * FROM reward_catalog WHERE id = ? AND active = 1').get(rewardId);
  if (!reward) throw Object.assign(new Error('Reward not found or inactive'), { status: 404 });
  if (reward.stock != null && reward.stock <= 0) throw Object.assign(new Error('Reward is out of stock'), { status: 409 });

  const balance = gamification.totalPoints(userId);
  if (balance < reward.cost_points) throw Object.assign(new Error('Not enough points'), { status: 409 });

  gamification.awardPoints(userId, -reward.cost_points, `Redeemed reward: ${reward.name}`);
  if (reward.stock != null) {
    db.prepare('UPDATE reward_catalog SET stock = stock - 1 WHERE id = ?').run(rewardId);
  }

  const id = uid();
  db.prepare('INSERT INTO reward_redemptions (id, user_id, reward_id, cost_points) VALUES (?, ?, ?, ?)').run(id, userId, rewardId, reward.cost_points);
  return { id, userId, rewardId, rewardName: reward.name, costPoints: reward.cost_points, remainingBalance: balance - reward.cost_points };
}

function myRedemptions(userId) {
  return db
    .prepare(`SELECT rr.*, rc.name AS reward_name FROM reward_redemptions rr JOIN reward_catalog rc ON rc.id = rr.reward_id WHERE rr.user_id = ? ORDER BY rr.created_at DESC`)
    .all(userId);
}

function updateRedemptionStatus(id, status) {
  if (!['redeemed', 'fulfilled', 'cancelled'].includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
  const row = db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  if (status === 'cancelled' && row.status !== 'cancelled') {
    // Refund points on cancellation.
    gamification.awardPoints(row.user_id, row.cost_points, 'Reward redemption cancelled — refund');
  }
  db.prepare('UPDATE reward_redemptions SET status = ? WHERE id = ?').run(status, id);
  return db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(id);
}

module.exports = { addReward, listRewards, redeem, myRedemptions, updateRedemptionStatus };
