// AI ADMIN PORTAL ADD-ON (9/11) — AI Faculty Research Grant & Collab
// Finder. This environment has no live access to grant-agency
// databases (DST/SERB/NSF etc.), so results are AI-generated *leads*
// based on the model's knowledge of common schemes in the given
// research area — clearly labeled as leads requiring verification on
// the funder's own site, not a live grants-database query. Fully
// additive — own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS grant_search_results (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  research_area TEXT NOT NULL,
  grants_json TEXT,
  collaborators_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grantfinder_faculty ON grant_search_results(faculty_id);
`);

function uid() { return crypto.randomUUID(); }

async function findGrants({ apiKey, model, facultyId, researchArea }) {
  if (!researchArea || !String(researchArea).trim()) throw Object.assign(new Error('researchArea is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You help faculty discover research funding leads and potential collaborating institutes. Base this on well-known, real funding schemes/agencies relevant to the field (e.g. DST, SERB, ICSSR, NSF, Horizon Europe as applicable) but present them as leads to verify on the funder\'s own site, since you do not have live access to current call deadlines. Return JSON: {"grantLeads":[{"agency":"...","scheme":"...","fitReason":"..."}],"collaboratorInstitutes":[{"institute":"...","reason":"..."}]}.',
    prompt: `Faculty research area: ${researchArea}`,
    maxTokens: 900,
  });

  const result = ai.ok ? ai.data : { grantLeads: [], collaboratorInstitutes: [] };

  const id = uid();
  db.prepare(
    `INSERT INTO grant_search_results (id, faculty_id, research_area, grants_json, collaborators_json) VALUES (?, ?, ?, ?, ?)`
  ).run(id, facultyId, researchArea, JSON.stringify(result.grantLeads || []), JSON.stringify(result.collaboratorInstitutes || []));

  return getResult(id);
}

function getResult(id) {
  const row = db.prepare('SELECT * FROM grant_search_results WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, grantLeads: JSON.parse(row.grants_json || '[]'), collaboratorInstitutes: JSON.parse(row.collaborators_json || '[]') };
}

function listResults(facultyId) {
  return db.prepare('SELECT id, research_area, created_at FROM grant_search_results WHERE faculty_id = ? ORDER BY created_at DESC').all(facultyId);
}

module.exports = { findGrants, getResult, listResults };
