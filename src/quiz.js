// Quiz / exam engine: MCQ quizzes with auto-grading, plus optional
// AI-assisted question generation (reuses anthropicClient — same model
// call the rest of the app already uses). Additive module.

const { db } = require('./db');
const crypto = require('crypto');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  class_section TEXT,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  time_limit_minutes INTEGER,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  marks REAL NOT NULL DEFAULT 1,
  ordinal INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  answers_json TEXT,
  score REAL,
  max_score REAL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  UNIQUE(quiz_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

function createQuiz({ createdBy, classSection, subject, title, description, timeLimitMinutes }) {
  if (!subject || !title) {
    const err = new Error('subject and title are required');
    err.status = 400;
    throw err;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO quizzes (id, created_by, class_section, subject, title, description, time_limit_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, createdBy, classSection || null, subject, title, description || null, timeLimitMinutes || null);
  return getQuiz(id);
}

function getQuiz(id) {
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id) || null;
}

function addQuestion(quizId, { question, options, correctIndex, marks }) {
  if (!question || !Array.isArray(options) || options.length < 2) {
    const err = new Error('question and at least 2 options are required');
    err.status = 400;
    throw err;
  }
  const ci = Number(correctIndex);
  if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) {
    const err = new Error('correctIndex must point at one of the options');
    err.status = 400;
    throw err;
  }
  const ordinal = db.prepare('SELECT COUNT(*) c FROM quiz_questions WHERE quiz_id = ?').get(quizId).c;
  const id = uid();
  db.prepare(
    `INSERT INTO quiz_questions (id, quiz_id, question, options_json, correct_index, marks, ordinal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, quizId, question, JSON.stringify(options), ci, Number(marks) || 1, ordinal);
  return getQuestion(id);
}

function getQuestion(id) {
  const row = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(id);
  return row ? { ...row, options: JSON.parse(row.options_json) } : null;
}

function listQuestions(quizId, { hideAnswers = false } = {}) {
  const rows = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY ordinal ASC').all(quizId);
  return rows.map((r) => {
    const parsed = { ...r, options: JSON.parse(r.options_json) };
    delete parsed.options_json;
    if (hideAnswers) delete parsed.correct_index;
    return parsed;
  });
}

function publishQuiz(id, published) {
  db.prepare('UPDATE quizzes SET is_published = ? WHERE id = ?').run(published ? 1 : 0, id);
  return getQuiz(id);
}

function listForSection(classSection) {
  return db
    .prepare('SELECT * FROM quizzes WHERE class_section = ? AND is_published = 1 ORDER BY created_at DESC')
    .all(classSection);
}

function listForCreator(createdBy) {
  return db.prepare('SELECT * FROM quizzes WHERE created_by = ? ORDER BY created_at DESC').all(createdBy);
}

function startAttempt(quizId, studentId) {
  const existing = db.prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?').get(quizId, studentId);
  if (existing) return existing;
  const id = uid();
  db.prepare('INSERT INTO quiz_attempts (id, quiz_id, student_id) VALUES (?, ?, ?)').run(id, quizId, studentId);
  return db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(id);
}

function submitAttempt(quizId, studentId, answers) {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?').get(quizId, studentId);
  if (!attempt) {
    const err = new Error('Attempt not started — call start first');
    err.status = 404;
    throw err;
  }
  if (attempt.submitted_at) {
    const err = new Error('Quiz already submitted');
    err.status = 409;
    throw err;
  }
  const questions = listQuestions(quizId);
  let score = 0;
  let maxScore = 0;
  const graded = {};
  for (const q of questions) {
    maxScore += q.marks;
    const given = answers ? answers[q.id] : undefined;
    graded[q.id] = given;
    if (given != null && Number(given) === q.correct_index) score += q.marks;
  }
  db.prepare(
    `UPDATE quiz_attempts SET answers_json = ?, score = ?, max_score = ?, submitted_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(graded), score, maxScore, attempt.id);
  return db.prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(attempt.id);
}

function listAttemptsForQuiz(quizId) {
  return db.prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? ORDER BY submitted_at IS NULL, submitted_at ASC').all(quizId);
}

function listAttemptsForStudent(studentId) {
  return db
    .prepare(
      `SELECT qa.*, q.title, q.subject FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.student_id = ? ORDER BY qa.started_at DESC`
    )
    .all(studentId);
}

/**
 * AI-assisted question generation. Falls back to a clear error the caller
 * can surface rather than crashing if no API key is configured — the rest
 * of the quiz feature (manual authoring, taking, grading) works with zero
 * dependency on the model.
 */
async function generateQuestionsWithAI({ apiKey, model, subject, topic, count, difficulty }) {
  const n = Math.max(1, Math.min(20, Number(count) || 5));
  const system = [
    'You are an exam-question generator for a school platform.',
    'Return ONLY strict JSON — no markdown fences, no commentary — matching this shape:',
    '{"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0}]}',
    'Each question must have exactly 4 options and exactly one correct answer.',
  ].join(' ');
  const userPrompt = `Generate ${n} multiple-choice questions for subject "${subject}"${topic ? `, topic "${topic}"` : ''} at ${difficulty || 'medium'} difficulty.`;

  const text = await callAnthropic({
    apiKey,
    model,
    system,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.5,
    maxTokens: 1500,
  });

  let parsed;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const err = new Error('AI response was not valid JSON — try again');
    err.status = 502;
    throw err;
  }
  if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
    const err = new Error('AI did not return any questions');
    err.status = 502;
    throw err;
  }
  return parsed.questions;
}

module.exports = {
  createQuiz,
  getQuiz,
  addQuestion,
  getQuestion,
  listQuestions,
  publishQuiz,
  listForSection,
  listForCreator,
  startAttempt,
  submitAttempt,
  listAttemptsForQuiz,
  listAttemptsForStudent,
  generateQuestionsWithAI,
};
