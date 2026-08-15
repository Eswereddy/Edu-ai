// AI ADMIN PORTAL ADD-ON (5/11) — AI Syllabus Compliance & Curriculum
// Mapper. Maps each subject in the syllabus to current industry job
// roles (e.g. "DBMS -> Data Engineer") and gives each subject a
// Relevance Score (0-100) with a short rationale. Reads syllabus.js's
// existing documents table read-only for context when a document id
// is supplied; never writes to it. Fully additive — own table, own
// file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS curriculum_map_entries (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  mapped_roles TEXT NOT NULL,
  relevance_score REAL,
  rationale TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_curriculummap_subject ON curriculum_map_entries(subject);
`);

function uid() { return crypto.randomUUID(); }

async function mapSubject({ apiKey, model, subject, subjectDescription, createdBy }) {
  if (!subject || !String(subject).trim()) throw Object.assign(new Error('subject is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You map a college subject to current industry job roles and score its market relevance. Return JSON: {"mappedRoles":["Role A","Role B"],"relevanceScore":0-100,"rationale":"2-3 sentences"}.',
    prompt: `Subject: ${subject}\nSyllabus description: ${subjectDescription || '(not provided — infer from a typical curriculum for this subject name)'}`,
    maxTokens: 500,
  });

  const result = ai.ok ? ai.data : { mappedRoles: [], relevanceScore: null, rationale: 'AI mapping unavailable right now.' };

  const id = uid();
  db.prepare(
    `INSERT INTO curriculum_map_entries (id, subject, mapped_roles, relevance_score, rationale, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, subject, JSON.stringify(result.mappedRoles || []), result.relevanceScore ?? null, result.rationale || null, createdBy || null);

  return getEntry(id);
}

function getEntry(id) {
  const row = db.prepare('SELECT * FROM curriculum_map_entries WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, mappedRoles: JSON.parse(row.mapped_roles || '[]') };
}

function listEntries() {
  return db.prepare('SELECT * FROM curriculum_map_entries ORDER BY created_at DESC').all()
    .map((r) => ({ ...r, mappedRoles: JSON.parse(r.mapped_roles || '[]') }));
}

function deleteEntry(id) {
  const row = db.prepare('SELECT id FROM curriculum_map_entries WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Entry not found'), { status: 404 });
  db.prepare('DELETE FROM curriculum_map_entries WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = { mapSubject, getEntry, listEntries, deleteEntry };
