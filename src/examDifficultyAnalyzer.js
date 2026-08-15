// AI ADMIN PORTAL ADD-ON (7/11) — AI "Exam Paper Difficulty" Analyzer
// Analyzes a set of exam questions (pasted in, or referencing an
// existing exam via examCell.js — read-only, never modified) and
// calculates a per-question and overall Difficulty Index
// (Easy/Medium/Hard) with a numeric score and a fairness note (e.g.
// mismatch between marks allotted and difficulty). Fully additive —
// own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS exam_difficulty_reports (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  exam_ref TEXT,
  questions_json TEXT NOT NULL,
  difficulty_index TEXT,
  difficulty_score REAL,
  fairness_note TEXT,
  breakdown_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_examdiff_subject ON exam_difficulty_reports(subject);
`);

function uid() { return crypto.randomUUID(); }

async function analyzePaper({ apiKey, model, subject, examRef, questions, createdBy }) {
  if (!subject) throw Object.assign(new Error('subject is required'), { status: 400 });
  if (!Array.isArray(questions) || !questions.length) throw Object.assign(new Error('questions array is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are an exam-quality reviewer for a college exam cell. Rate each question Easy/Medium/Hard, give an overall paper Difficulty Index (Easy/Medium/Hard) with a 0-100 score, and a fairness note (e.g. marks-vs-difficulty mismatch, syllabus coverage gaps). Return JSON: {"overallIndex":"Easy|Medium|Hard","overallScore":0-100,"fairnessNote":"2-3 sentences","perQuestion":[{"question":"...","difficulty":"Easy|Medium|Hard"}]}.',
    prompt: `Subject: ${subject}\nQuestions:\n${questions.map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : q.text} ${q.marks ? `[${q.marks} marks]` : ''}`).join('\n')}`,
    maxTokens: 1200,
  });

  const result = ai.ok ? ai.data : { overallIndex: null, overallScore: null, fairnessNote: 'AI analysis unavailable right now.', perQuestion: [] };

  const id = uid();
  db.prepare(
    `INSERT INTO exam_difficulty_reports (id, subject, exam_ref, questions_json, difficulty_index, difficulty_score, fairness_note, breakdown_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, subject, examRef || null, JSON.stringify(questions),
    result.overallIndex || null, result.overallScore ?? null, result.fairnessNote || null,
    JSON.stringify(result.perQuestion || []), createdBy || null
  );

  return getReport(id);
}

function getReport(id) {
  const row = db.prepare('SELECT * FROM exam_difficulty_reports WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, questions: JSON.parse(row.questions_json), perQuestion: JSON.parse(row.breakdown_json || '[]') };
}

function listReports({ subject } = {}) {
  const rows = subject
    ? db.prepare('SELECT id, subject, exam_ref, difficulty_index, difficulty_score, created_at FROM exam_difficulty_reports WHERE subject = ? ORDER BY created_at DESC').all(subject)
    : db.prepare('SELECT id, subject, exam_ref, difficulty_index, difficulty_score, created_at FROM exam_difficulty_reports ORDER BY created_at DESC').all();
  return rows;
}

module.exports = { analyzePaper, getReport, listReports };
