// Skills inventory (technical + soft skills, 0-100 proficiency) and an
// AI-assisted roadmap (current level -> target level -> generated steps).
// Fully additive — own tables, own file.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS student_skills (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'technical' CHECK(category IN ('technical','soft')),
  proficiency INTEGER NOT NULL DEFAULT 50 CHECK(proficiency BETWEEN 0 AND 100),
  target_proficiency INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_student_skills_student ON student_skills(student_id);

CREATE TABLE IF NOT EXISTS skill_roadmaps (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skill_roadmaps_student ON skill_roadmaps(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

function upsertSkill(studentId, { skillName, category, proficiency, targetProficiency }) {
  if (!skillName) throw Object.assign(new Error('skillName is required'), { status: 400 });
  const cat = category === 'soft' ? 'soft' : 'technical';
  const prof = Math.max(0, Math.min(100, Number(proficiency) || 0));
  const target = targetProficiency != null ? Math.max(0, Math.min(100, Number(targetProficiency))) : null;

  const existing = db.prepare('SELECT id FROM student_skills WHERE student_id = ? AND skill_name = ?').get(studentId, skillName);
  if (existing) {
    db.prepare(
      `UPDATE student_skills SET category = ?, proficiency = ?, target_proficiency = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(cat, prof, target, existing.id);
    return db.prepare('SELECT * FROM student_skills WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO student_skills (id, student_id, skill_name, category, proficiency, target_proficiency) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, skillName, cat, prof, target);
  return db.prepare('SELECT * FROM student_skills WHERE id = ?').get(id);
}

function listSkills(studentId) {
  return db.prepare('SELECT * FROM student_skills WHERE student_id = ? ORDER BY category ASC, skill_name ASC').all(studentId);
}

function deleteSkill(studentId, skillId) {
  const row = db.prepare('SELECT * FROM student_skills WHERE id = ? AND student_id = ?').get(skillId, studentId);
  if (!row) throw Object.assign(new Error('Skill not found'), { status: 404 });
  db.prepare('DELETE FROM student_skills WHERE id = ?').run(skillId);
  return { deleted: true };
}

// Radar-chart-ready shape: two axes (technical/soft), each an array of
// { skill, value } points a frontend charting lib can plot directly.
function radarData(studentId) {
  const rows = listSkills(studentId);
  const byCategory = { technical: [], soft: [] };
  for (const r of rows) {
    byCategory[r.category].push({ skill: r.skill_name, value: r.proficiency, target: r.target_proficiency });
  }
  return byCategory;
}

async function generateRoadmap({ apiKey, model, studentId, targetRole }) {
  if (!targetRole) throw Object.assign(new Error('targetRole is required'), { status: 400 });
  const skills = listSkills(studentId);

  const skillSummary = skills.length
    ? skills.map((s) => `${s.skill_name} (${s.category}): current ${s.proficiency}/100${s.target_proficiency != null ? `, target ${s.target_proficiency}/100` : ''}`).join('\n')
    : 'No skills logged yet.';

  let content;
  let aiGenerated = false;
  try {
    const text = await callAnthropic({
      apiKey,
      model,
      system: 'You are a career-roadmap assistant for a student portal. Given a target role and the student\'s current skills, respond ONLY with strict JSON (no markdown fences, no prose) of the shape {"summary": string, "steps": [{"title": string, "detail": string, "skillFocus": string}]}. Provide 4-8 concrete, ordered steps.',
      messages: [{ role: 'user', content: `Target role: ${targetRole}\n\nCurrent skills:\n${skillSummary}` }],
      temperature: 0.4,
      maxTokens: 900,
    });
    const cleaned = text.replace(/```json|```/g, '').trim();
    content = JSON.parse(cleaned);
    aiGenerated = true;
  } catch (e) {
    // Deterministic fallback so the feature never just breaks if the
    // model call fails or no API key is configured.
    const gaps = skills
      .filter((s) => s.target_proficiency != null && s.target_proficiency > s.proficiency)
      .sort((a, b) => (b.target_proficiency - b.proficiency) - (a.target_proficiency - a.proficiency));
    content = {
      summary: `Roadmap toward ${targetRole}, generated from your logged skill gaps (AI unavailable, deterministic fallback).`,
      steps: gaps.length
        ? gaps.map((g) => ({
            title: `Improve ${g.skill_name}`,
            detail: `Move from ${g.proficiency}/100 to your target of ${g.target_proficiency}/100 through focused practice, a project, or a course.`,
            skillFocus: g.skill_name,
          }))
        : [{ title: 'Log your skills', detail: 'Add current and target proficiency for the skills relevant to this role to get a tailored roadmap.', skillFocus: null }],
    };
  }

  const id = uid();
  db.prepare(
    `INSERT INTO skill_roadmaps (id, student_id, target_role, content_json, ai_generated) VALUES (?, ?, ?, ?, ?)`
  ).run(id, studentId, targetRole, JSON.stringify(content), aiGenerated ? 1 : 0);

  return { id, studentId, targetRole, aiGenerated, ...content };
}

function listRoadmaps(studentId) {
  return db
    .prepare('SELECT id, target_role, ai_generated, created_at FROM skill_roadmaps WHERE student_id = ? ORDER BY created_at DESC')
    .all(studentId);
}

function getRoadmap(studentId, id) {
  const row = db.prepare('SELECT * FROM skill_roadmaps WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  return { id: row.id, studentId, targetRole: row.target_role, aiGenerated: Boolean(row.ai_generated), createdAt: row.created_at, ...JSON.parse(row.content_json) };
}

module.exports = { upsertSkill, listSkills, deleteSkill, radarData, generateRoadmap, listRoadmaps, getRoadmap };
