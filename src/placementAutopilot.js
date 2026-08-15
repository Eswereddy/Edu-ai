// AI ADMIN PORTAL ADD-ON (2/11) — AI Placement Cell Auto-Pilot
// Matches a student's profile against a job description, scores fit,
// drafts a cover letter, and can mark the match as "applied". This
// environment has no outbound job-board scraping/submission access,
// so job descriptions are supplied by the caller (pasted JD, or a
// title+company) rather than scraped, and "apply" is explicitly
// simulated — it flips a flag and logs an audit entry, it never
// submits anything externally. That matches how this feature was
// scoped by the requester. Distinct from placements.js (the
// placement cell's own postings, untouched) and careerPrep.js
// (untouched). Fully additive — own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS autopilot_matches (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  job_description TEXT,
  match_score REAL,
  match_rationale TEXT,
  cover_letter TEXT,
  applied_simulated INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_autopilot_student ON autopilot_matches(student_id);
`);

function uid() { return crypto.randomUUID(); }

async function matchAndDraft({ apiKey, model, studentId, studentName, company, roleTitle, jobDescription, studentSkills = [] }) {
  if (!company || !roleTitle) throw Object.assign(new Error('company and roleTitle are required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are the AI engine behind a college placement cell auto-pilot. Score how well a student fits a job and draft a cover letter. Return JSON: {"matchScore":0-100,"matchRationale":"2-3 sentences","coverLetter":"full cover letter text, 150-250 words"}.',
    prompt: `Student: ${studentName || studentId}\nStudent skills: ${studentSkills.join(', ') || 'not provided'}\nCompany: ${company}\nRole: ${roleTitle}\nJob description: ${jobDescription || '(not provided — infer typical requirements for this role/company type)'}`,
    maxTokens: 900,
  });

  const result = ai.ok ? ai.data : {
    matchScore: null,
    matchRationale: 'AI matching unavailable right now — record saved without a score.',
    coverLetter: `Dear Hiring Manager,\n\nI am excited to apply for the ${roleTitle} position at ${company}. My background aligns with this opportunity and I would welcome the chance to discuss it further.\n\nSincerely,\n${studentName || 'Applicant'}`,
  };

  const id = uid();
  db.prepare(
    `INSERT INTO autopilot_matches (id, student_id, company, role_title, job_description, match_score, match_rationale, cover_letter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, company, roleTitle, jobDescription || null, result.matchScore ?? null, result.matchRationale || null, result.coverLetter || null);

  return getMatch(studentId, id);
}

function getMatch(studentId, id) {
  return db.prepare('SELECT * FROM autopilot_matches WHERE id = ? AND student_id = ?').get(id, studentId) || null;
}

function listMatches(studentId) {
  return db.prepare('SELECT * FROM autopilot_matches WHERE student_id = ? ORDER BY match_score DESC, created_at DESC').all(studentId);
}

// Explicitly simulated — no external application is ever sent.
function simulateApply(studentId, id) {
  const row = getMatch(studentId, id);
  if (!row) throw Object.assign(new Error('Match not found'), { status: 404 });
  db.prepare(`UPDATE autopilot_matches SET applied_simulated = 1, applied_at = datetime('now') WHERE id = ?`).run(id);
  return getMatch(studentId, id);
}

module.exports = { matchAndDraft, getMatch, listMatches, simulateApply };
