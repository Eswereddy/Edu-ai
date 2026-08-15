// AI ADMIN PORTAL ADD-ON (3/11) — AI Code Reviewer & Project Grader
// Students submit a GitHub repo URL or paste code; this scores code
// quality/complexity/comments 0-100 with improvement suggestions. If a
// repo URL is given, it best-effort fetches the repo's README via the
// public GitHub API (works when outbound network access is available;
// fails gracefully to a URL-only review otherwise). Fully additive —
// own table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS code_review_submissions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  repo_url TEXT,
  code_excerpt TEXT,
  score REAL,
  quality_notes TEXT,
  complexity_notes TEXT,
  comments_notes TEXT,
  suggestions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_codereview_student ON code_review_submissions(student_id);
`);

function uid() { return crypto.randomUUID(); }

function parseGithubUrl(url) {
  try {
    const m = String(url).match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  } catch (_e) {
    return null;
  }
}

// Best-effort — never throws; returns '' if unreachable.
async function fetchReadme(repoUrl) {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, {
      headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'eduai-code-reviewer' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return '';
    const text = await resp.text();
    return text.slice(0, 6000);
  } catch (_e) {
    return '';
  }
}

async function reviewSubmission({ apiKey, model, studentId, repoUrl, code }) {
  if (!repoUrl && !code) throw Object.assign(new Error('repoUrl or code is required'), { status: 400 });

  const readme = repoUrl ? await fetchReadme(repoUrl) : '';
  const material = code
    ? `Pasted code:\n${String(code).slice(0, 8000)}`
    : `Repo URL: ${repoUrl}\nREADME (if fetched): ${readme || '(could not fetch — review based on URL/description only)'}`;

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are an experienced code reviewer grading a student project for a placement-readiness dashboard. Return JSON: {"score":0-100,"qualityNotes":"...","complexityNotes":"...","commentsNotes":"... (about code documentation/comments)","suggestions":["...","..."]}.',
    prompt: material,
    maxTokens: 1000,
  });

  const result = ai.ok ? ai.data : {
    score: null,
    qualityNotes: 'AI review unavailable right now.',
    complexityNotes: null,
    commentsNotes: null,
    suggestions: [],
  };

  const id = uid();
  db.prepare(
    `INSERT INTO code_review_submissions (id, student_id, repo_url, code_excerpt, score, quality_notes, complexity_notes, comments_notes, suggestions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, studentId, repoUrl || null, code ? String(code).slice(0, 4000) : null,
    result.score ?? null, result.qualityNotes || null, result.complexityNotes || null, result.commentsNotes || null,
    JSON.stringify(result.suggestions || [])
  );

  return getSubmission(studentId, id);
}

function getSubmission(studentId, id) {
  const row = db.prepare('SELECT * FROM code_review_submissions WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  return { ...row, suggestions: JSON.parse(row.suggestions || '[]') };
}

function listSubmissions(studentId) {
  return db.prepare('SELECT id, repo_url, score, created_at FROM code_review_submissions WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

module.exports = { reviewSubmission, getSubmission, listSubmissions };
