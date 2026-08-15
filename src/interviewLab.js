// AI ADMIN PORTAL ADD-ON (1/11) — AI Interview Orchestrator
// A full "AI Interview Lab": generates a role/difficulty-targeted
// question set, produces a per-question "voice script" (stage
// directions + spoken text — a text-based simulation of a voice
// interviewer, since this environment has no audio pipeline), grades
// each submitted answer, and rolls everything up into a session
// report. Distinct from mockInterviews.js (human-panel slot
// booking, untouched) and quiz.js (untouched). Fully additive — own
// tables, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS interview_lab_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  voice_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  overall_score REAL,
  overall_feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ilab_student ON interview_lab_sessions(student_id);

CREATE TABLE IF NOT EXISTS interview_lab_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_lab_sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  question TEXT NOT NULL,
  focus_area TEXT,
  ideal_points TEXT,
  voice_script TEXT
);
CREATE INDEX IF NOT EXISTS idx_ilabq_session ON interview_lab_questions(session_id);

CREATE TABLE IF NOT EXISTS interview_lab_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES interview_lab_questions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  score REAL,
  feedback TEXT,
  strengths TEXT,
  improvements TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() { return crypto.randomUUID(); }

const FALLBACK_QUESTIONS = (targetRole) => [
  { question: `Walk me through a project relevant to ${targetRole} that you're proud of.`, focusArea: 'Experience', idealPoints: 'Clear problem, your specific contribution, measurable outcome.' },
  { question: `What is the biggest technical challenge you'd expect in a ${targetRole} role, and how would you approach it?`, focusArea: 'Problem solving', idealPoints: 'Structured approach, trade-offs, communication.' },
  { question: `Tell me about a time you disagreed with a teammate. How did you resolve it?`, focusArea: 'Collaboration', idealPoints: 'Empathy, concrete resolution, outcome.' },
  { question: `Why are you interested in this ${targetRole} position specifically?`, focusArea: 'Motivation', idealPoints: 'Specific, researched, aligned with candidate background.' },
  { question: `Where do you see yourself professionally in 3 years?`, focusArea: 'Career direction', idealPoints: 'Realistic, growth-oriented, aligned with the role.' },
];

async function createSession({ apiKey, model, studentId, targetRole, difficulty = 'medium', voiceMode = false, questionCount = 5 }) {
  if (!targetRole || !String(targetRole).trim()) throw Object.assign(new Error('targetRole is required'), { status: 400 });
  const n = Math.max(3, Math.min(10, Number(questionCount) || 5));

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are an expert technical + behavioral interviewer designing a mock interview for a student. Return JSON: {"questions":[{"question":"...","focusArea":"...","idealPoints":"...","voiceScript":"..."}]}. voiceScript is how a warm, professional voice interviewer would SAY the question aloud, including a short natural lead-in (e.g. "Great, next up -- ...").',
    prompt: `Target role: ${targetRole}\nDifficulty: ${difficulty}\nGenerate exactly ${n} interview questions (mix of technical + behavioral appropriate to the role and difficulty).`,
    maxTokens: 1600,
  });

  let questions = ai.ok && Array.isArray(ai.data?.questions) ? ai.data.questions.slice(0, n) : null;
  if (!questions || !questions.length) {
    questions = FALLBACK_QUESTIONS(targetRole).slice(0, n).map((q) => ({ ...q, voiceScript: `Let's talk about this: ${q.question}` }));
  }

  const sessionId = uid();
  db.prepare(
    `INSERT INTO interview_lab_sessions (id, student_id, target_role, difficulty, voice_mode) VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, studentId, targetRole, difficulty, voiceMode ? 1 : 0);

  const insertQ = db.prepare(
    `INSERT INTO interview_lab_questions (id, session_id, idx, question, focus_area, ideal_points, voice_script) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  questions.forEach((q, i) => {
    insertQ.run(uid(), sessionId, i, q.question || `Question ${i + 1}`, q.focusArea || null, q.idealPoints || null, q.voiceScript || q.question || null);
  });

  return getSession(studentId, sessionId);
}

function getSession(studentId, sessionId) {
  const session = db.prepare('SELECT * FROM interview_lab_sessions WHERE id = ? AND student_id = ?').get(sessionId, studentId);
  if (!session) return null;
  const questions = db.prepare('SELECT * FROM interview_lab_questions WHERE session_id = ? ORDER BY idx ASC').all(sessionId);
  const answers = db.prepare('SELECT * FROM interview_lab_answers WHERE session_id = ?').all(sessionId);
  const byQ = Object.fromEntries(answers.map((a) => [a.question_id, a]));
  return {
    ...session,
    voiceMode: Boolean(session.voice_mode),
    questions: questions.map((q) => ({ ...q, answer: byQ[q.id] || null })),
  };
}

function listSessions(studentId) {
  return db.prepare('SELECT id, target_role, difficulty, status, overall_score, created_at, completed_at FROM interview_lab_sessions WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

async function submitAnswer({ apiKey, model, studentId, sessionId, questionId, answerText }) {
  const session = db.prepare('SELECT * FROM interview_lab_sessions WHERE id = ? AND student_id = ?').get(sessionId, studentId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  const question = db.prepare('SELECT * FROM interview_lab_questions WHERE id = ? AND session_id = ?').get(questionId, sessionId);
  if (!question) throw Object.assign(new Error('Question not found'), { status: 404 });
  if (!answerText || !String(answerText).trim()) throw Object.assign(new Error('answerText is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are grading one interview answer. Return JSON: {"score":0-100,"feedback":"2-3 sentences","strengths":"short phrase","improvements":"short phrase"}.',
    prompt: `Question: ${question.question}\nWhat a strong answer covers: ${question.ideal_points || 'n/a'}\nCandidate answer: ${answerText}`,
    maxTokens: 500,
  });

  const graded = ai.ok ? ai.data : { score: null, feedback: 'AI grading unavailable right now — answer recorded ungraded.', strengths: null, improvements: null };

  const id = uid();
  db.prepare(
    `INSERT INTO interview_lab_answers (id, question_id, session_id, answer_text, score, feedback, strengths, improvements) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, questionId, sessionId, answerText, graded.score ?? null, graded.feedback || null, graded.strengths || null, graded.improvements || null);

  return getSession(studentId, sessionId);
}

async function completeSession({ apiKey, model, studentId, sessionId }) {
  const session = getSession(studentId, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  const scored = session.questions.map((q) => q.answer?.score).filter((s) => typeof s === 'number');
  const overallScore = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'Summarize an interview session in 3-4 sentences of actionable feedback. Return JSON: {"summary":"..."}.',
    prompt: `Role: ${session.target_role}\nPer-question feedback: ${session.questions.map((q) => `- ${q.question}: ${q.answer?.feedback || 'no answer'}`).join('\n')}`,
    maxTokens: 400,
  });
  const overallFeedback = (ai.ok && ai.data?.summary) || 'Session completed. Review per-question feedback above for details.';

  db.prepare(
    `UPDATE interview_lab_sessions SET status='completed', overall_score=?, overall_feedback=?, completed_at=datetime('now') WHERE id = ?`
  ).run(overallScore, overallFeedback, sessionId);

  return getSession(studentId, sessionId);
}

module.exports = { createSession, getSession, listSessions, submitAnswer, completeSession };
