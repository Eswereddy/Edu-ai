// AI ADMIN PORTAL ADD-ON (4/11) — AI Career Path Monte Carlo Simulator
// Runs a real Monte Carlo simulation: given a student's self-rated
// skill scores, each trial adds randomized noise (interview variance,
// market conditions) to a derived base probability and lands the
// trial in an outcome tier. Aggregating N trials gives a probability
// distribution, which an AI pass then narrates in plain language.
// Fully additive — own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS career_sim_runs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  trials INTEGER NOT NULL,
  results_json TEXT NOT NULL,
  narrative TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_careersim_student ON career_sim_runs(student_id);
`);

function uid() { return crypto.randomUUID(); }

const TIERS = ['top_tier_offer', 'mid_tier_offer', 'internship_only', 'no_offer'];

// Box-Muller for approx-normal noise
function gaussianNoise(sd = 12) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sd;
}

function runSimulation({ skills = {}, cgpa = 7.5, projectsCount = 2, internshipsCount = 0, trials = 200 }) {
  const n = Math.max(100, Math.min(2000, Number(trials) || 200));
  const skillValues = Object.values(skills).filter((v) => typeof v === 'number');
  const avgSkill = skillValues.length ? skillValues.reduce((a, b) => a + b, 0) / skillValues.length : 55;

  // Base score (0-100) blended from inputs, then each trial perturbs it.
  const base = Math.max(0, Math.min(100,
    avgSkill * 0.5 + (Number(cgpa) / 10) * 100 * 0.25 + Math.min(projectsCount, 6) * 3 + Math.min(internshipsCount, 3) * 5
  ));

  const tally = { top_tier_offer: 0, mid_tier_offer: 0, internship_only: 0, no_offer: 0 };
  for (let i = 0; i < n; i++) {
    const trialScore = base + gaussianNoise(13);
    if (trialScore >= 80) tally.top_tier_offer++;
    else if (trialScore >= 60) tally.mid_tier_offer++;
    else if (trialScore >= 40) tally.internship_only++;
    else tally.no_offer++;
  }

  const probabilities = Object.fromEntries(TIERS.map((t) => [t, Math.round((tally[t] / n) * 1000) / 10]));
  return { trials: n, baseScore: Math.round(base * 10) / 10, tally, probabilities };
}

async function simulateAndSave({ apiKey, model, studentId, skills, cgpa, projectsCount, internshipsCount, trials }) {
  const results = runSimulation({ skills, cgpa, projectsCount, internshipsCount, trials });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'Explain Monte Carlo career-outcome simulation results to a student in plain, encouraging language, 3-4 sentences, ending with one concrete improvement suggestion. Return JSON: {"narrative":"..."}.',
    prompt: `Simulation results (${results.trials} trials): ${JSON.stringify(results.probabilities)}. Base composite score: ${results.baseScore}/100.`,
    maxTokens: 400,
  });
  const narrative = (ai.ok && ai.data?.narrative) || `Across ${results.trials} simulated trials, your top-tier offer probability is ${results.probabilities.top_tier_offer}%. Keep building projects and interview practice to shift the odds further.`;

  const id = uid();
  db.prepare(
    `INSERT INTO career_sim_runs (id, student_id, inputs_json, trials, results_json, narrative) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, JSON.stringify({ skills, cgpa, projectsCount, internshipsCount }), results.trials, JSON.stringify(results), narrative);

  return getRun(studentId, id);
}

function getRun(studentId, id) {
  const row = db.prepare('SELECT * FROM career_sim_runs WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  return { ...row, inputs: JSON.parse(row.inputs_json), results: JSON.parse(row.results_json) };
}

function listRuns(studentId) {
  return db.prepare('SELECT id, trials, narrative, created_at FROM career_sim_runs WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

module.exports = { simulateAndSave, getRun, listRuns, runSimulation };
