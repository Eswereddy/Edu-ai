// AI ADMIN PORTAL ADD-ON (6/11) — AI Academic Integrity & Proctoring
// Dashboard. Scans submitted essay/answer text and produces an
// estimated "AI-generated content" likelihood score (0-100%), plus a
// short rationale, so an AI-Admin can triage flagged submissions.
// IMPORTANT: this is a heuristic estimate from a language model, not a
// forensic tool — it is presented as a triage signal, never a verdict,
// and the UI/response always carries that caveat. Fully additive — own
// table, own file, own routes. Does not modify assignments.js/quiz.js;
// callers may optionally reference an existing submission by id for
// their own bookkeeping, but this module never writes to those tables.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS integrity_scans (
  id TEXT PRIMARY KEY,
  source_label TEXT,
  student_id TEXT,
  text_excerpt TEXT NOT NULL,
  ai_likelihood REAL,
  rationale TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  scanned_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_integrity_student ON integrity_scans(student_id);
`);

function uid() { return crypto.randomUUID(); }

const FLAG_THRESHOLD = 70;

async function scanText({ apiKey, model, text, sourceLabel, studentId, scannedBy }) {
  if (!text || String(text).trim().length < 20) {
    throw Object.assign(new Error('text must be at least 20 characters'), { status: 400 });
  }

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are an academic-integrity triage assistant. Estimate the likelihood a piece of student writing was substantially AI-generated, based on stylistic signals (uniform sentence rhythm, generic phrasing, lack of specific personal detail, unnatural polish for the stated context). This is a probabilistic estimate for human review, never a verdict. Return JSON: {"aiLikelihood":0-100,"rationale":"2-3 sentences citing specific stylistic signals you noticed"}.',
    prompt: String(text).slice(0, 6000),
    maxTokens: 400,
  });

  const result = ai.ok ? ai.data : { aiLikelihood: null, rationale: 'AI estimate unavailable right now — needs manual review.' };
  const flagged = typeof result.aiLikelihood === 'number' && result.aiLikelihood >= FLAG_THRESHOLD;

  const id = uid();
  db.prepare(
    `INSERT INTO integrity_scans (id, source_label, student_id, text_excerpt, ai_likelihood, rationale, flagged, scanned_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sourceLabel || null, studentId || null, String(text).slice(0, 2000), result.aiLikelihood ?? null, result.rationale || null, flagged ? 1 : 0, scannedBy || null);

  return getScan(id);
}

function getScan(id) {
  const row = db.prepare('SELECT * FROM integrity_scans WHERE id = ?').get(id);
  return row ? { ...row, flagged: Boolean(row.flagged) } : null;
}

function listScans({ flaggedOnly = false, limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = flaggedOnly
    ? db.prepare('SELECT * FROM integrity_scans WHERE flagged = 1 ORDER BY created_at DESC LIMIT ?').all(cap)
    : db.prepare('SELECT * FROM integrity_scans ORDER BY created_at DESC LIMIT ?').all(cap);
  return rows.map((r) => ({ ...r, flagged: Boolean(r.flagged) }));
}

function overview() {
  const total = db.prepare('SELECT COUNT(*) c FROM integrity_scans').get().c;
  const flagged = db.prepare('SELECT COUNT(*) c FROM integrity_scans WHERE flagged = 1').get().c;
  const avg = db.prepare('SELECT AVG(ai_likelihood) a FROM integrity_scans WHERE ai_likelihood IS NOT NULL').get().a;
  return {
    totalScans: total,
    flaggedCount: flagged,
    flaggedRate: total ? Math.round((flagged / total) * 1000) / 10 : 0,
    avgAiLikelihood: avg != null ? Math.round(avg * 10) / 10 : null,
    threshold: FLAG_THRESHOLD,
  };
}

module.exports = { scanText, getScan, listScans, overview, FLAG_THRESHOLD };
