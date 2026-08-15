// AI ADMIN PORTAL ADD-ON (10/11) — AI Campus Sentiment Heatmap (Live)
// Reads the platform's EXISTING mood check-ins (wellness.js's
// mood_checkins table) and a light recent sample of forum thread
// titles (forum.js's forum_threads table) — both read-only, nothing
// here writes to either — and rolls them into a live campus sentiment
// gauge (Happy/Neutral/Stressed) with an AI narrative. Computed
// snapshots are cached in their own additive table so the AI-admin
// dashboard doesn't need to re-run the model on every page load.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS sentiment_snapshots (
  id TEXT PRIMARY KEY,
  window_days INTEGER NOT NULL,
  avg_mood REAL,
  checkin_count INTEGER,
  gauge TEXT,
  narrative TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() { return crypto.randomUUID(); }

function gaugeFromAvg(avg) {
  if (avg == null) return 'Unknown';
  if (avg >= 3.7) return 'Happy';
  if (avg >= 2.6) return 'Neutral';
  return 'Stressed';
}

async function computeSnapshot({ apiKey, model, windowDays = 14, createdBy }) {
  const days = Math.max(1, Math.min(90, Number(windowDays) || 14));

  const moodRow = db.prepare(
    `SELECT AVG(mood_score) avg, COUNT(*) n FROM mood_checkins WHERE checkin_date >= date('now', '-' || ? || ' days')`
  ).get(days);

  const recentThreads = db.prepare(
    `SELECT title FROM forum_threads WHERE created_at >= datetime('now', '-' || ? || ' days') ORDER BY created_at DESC LIMIT 20`
  ).all(days).map((r) => r.title);

  const gauge = gaugeFromAvg(moodRow.avg);

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You summarize a campus wellbeing snapshot for an AI-admin dashboard in 2-3 sentences, plain and actionable — no alarmism. Return JSON: {"narrative":"..."}.',
    prompt: `Average mood check-in score (1=very low, 5=very high) over the last ${days} days: ${moodRow.avg != null ? moodRow.avg.toFixed(2) : 'no data'} from ${moodRow.n} check-ins. Gauge: ${gauge}. Recent forum thread titles (sample, for tone context only): ${recentThreads.slice(0, 10).join(' | ') || 'none'}`,
    maxTokens: 300,
  });
  const narrative = (ai.ok && ai.data?.narrative) || `Campus mood gauge is currently "${gauge}" based on ${moodRow.n} check-ins over the last ${days} days.`;

  const id = uid();
  db.prepare(
    `INSERT INTO sentiment_snapshots (id, window_days, avg_mood, checkin_count, gauge, narrative, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, days, moodRow.avg ?? null, moodRow.n, gauge, narrative, createdBy || null);

  return getSnapshot(id);
}

function getSnapshot(id) {
  return db.prepare('SELECT * FROM sentiment_snapshots WHERE id = ?').get(id) || null;
}

function latestSnapshot() {
  return db.prepare('SELECT * FROM sentiment_snapshots ORDER BY created_at DESC LIMIT 1').get() || null;
}

function history(limit = 30) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 30));
  return db.prepare('SELECT id, window_days, avg_mood, gauge, created_at FROM sentiment_snapshots ORDER BY created_at DESC LIMIT ?').all(cap);
}

module.exports = { computeSnapshot, getSnapshot, latestSnapshot, history };
