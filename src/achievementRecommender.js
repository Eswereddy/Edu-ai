// AI ADMIN PORTAL ADD-ON (11/11) — AI Auto-Achievement & Award
// Recommender. Reads EXISTING platform data read-only — the
// gamification points ledger (gamification.js) and grades (db.js) —
// ranks top performers, and asks the model to write a short rationale
// for nominating each as "Best Student", "Best Faculty", or
// "Innovation Award". Nothing here writes to points_ledger/grades;
// nominations are stored in their own additive table and are
// recommendations for a human committee to confirm, not automatic
// awards. Fully additive — own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS award_nominations (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  nominee_id TEXT NOT NULL,
  nominee_name TEXT,
  nominee_role TEXT,
  score REAL,
  rationale TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_award_category ON award_nominations(category);
`);

function uid() { return crypto.randomUUID(); }

function topStudentsByGrades(limit = 5) {
  return db.prepare(
    `SELECT u.id, u.name, AVG(g.marks * 100.0 / g.max_marks) avgPercent, COUNT(g.id) gradeCount
     FROM grades g JOIN users u ON u.id = g.student_id
     WHERE u.role = 'student'
     GROUP BY u.id
     HAVING gradeCount >= 1
     ORDER BY avgPercent DESC LIMIT ?`
  ).all(limit);
}

function topByPoints(role, limit = 5) {
  return db.prepare(
    `SELECT u.id, u.name, u.role, SUM(p.points) totalPoints
     FROM points_ledger p JOIN users u ON u.id = p.user_id
     WHERE u.role = ?
     GROUP BY u.id
     ORDER BY totalPoints DESC LIMIT ?`
  ).all(role, limit);
}

async function recommend({ apiKey, model, createdBy }) {
  const topStudentsGrades = topStudentsByGrades(5);
  const topStudentsPoints = topByPoints('student', 5);
  const topFaculty = topByPoints('faculty', 5);

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You help an academic awards committee shortlist nominees. Given ranked performance data, pick ONE top nominee per category and write a short rationale. These are recommendations for the committee to confirm, not final decisions. Return JSON: {"bestStudent":{"id":"...","name":"...","rationale":"..."},"bestFaculty":{"id":"...","name":"...","rationale":"..."},"innovationAward":{"id":"...","name":"...","rationale":"..."}}. If a category has no data, set it to null.',
    prompt: `Top students by average grade %: ${JSON.stringify(topStudentsGrades)}\nTop students by gamification points (participation/engagement proxy): ${JSON.stringify(topStudentsPoints)}\nTop faculty by gamification points: ${JSON.stringify(topFaculty)}\nFor "innovationAward", pick whichever student or faculty member shows the strongest combined engagement + performance signal.`,
    maxTokens: 800,
  });

  const picks = ai.ok ? ai.data : { bestStudent: null, bestFaculty: null, innovationAward: null };
  const insert = db.prepare(
    `INSERT INTO award_nominations (id, category, nominee_id, nominee_name, nominee_role, score, rationale, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const saved = [];
  for (const [category, roleGuess] of [['best_student', 'student'], ['best_faculty', 'faculty'], ['innovation_award', null]]) {
    const key = category === 'best_student' ? 'bestStudent' : category === 'best_faculty' ? 'bestFaculty' : 'innovationAward';
    const pick = picks[key];
    if (!pick || !pick.id) continue;
    const id = uid();
    insert.run(id, category, pick.id, pick.name || null, roleGuess, null, pick.rationale || null, createdBy || null);
    saved.push(getNomination(id));
  }
  return saved;
}

function getNomination(id) {
  return db.prepare('SELECT * FROM award_nominations WHERE id = ?').get(id) || null;
}

function listNominations({ category } = {}) {
  return category
    ? db.prepare('SELECT * FROM award_nominations WHERE category = ? ORDER BY created_at DESC').all(category)
    : db.prepare('SELECT * FROM award_nominations ORDER BY created_at DESC').all();
}

module.exports = { recommend, getNomination, listNominations };
