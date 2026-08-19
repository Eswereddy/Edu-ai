// AI ADMIN PORTAL ADD-ON (13) — AI Live Interview Bot
// A genuinely LIVE, turn-by-turn interview, as close to a real interview
// as a text pipeline allows: no pre-generated question list. Each
// candidate answer is sent back to the model along with the FULL
// transcript so far, and the model — acting in-character as a live
// interviewer — decides in real time what a real interviewer would do
// next: ask a natural follow-up probing the same answer, push back on
// a vague point, transition to a new question, or wrap the round up.
// This is what distinguishes it from interviewLab.js (fixed batch of
// N questions, graded independently, no adaptive follow-ups) and from
// interviewMasteryCoach.js's round-strategy (a static prep plan, not a
// live session). Like interviewLab.js, this environment has no audio
// pipeline, so "live" means real-time turn-by-turn text/voice-script
// exchange rather than an actual phone/video call — each interviewer
// turn includes a spoken-style line for read-aloud/TTS use, same
// convention as interviewLab.js's voiceScript field.
//
// v3.0 ("EduAI Interviewer") behavior, layered in additively on top of
// the original module (columns added via addColumnIfMissing so an
// already-created table upgrades in place, no data loss):
//   1) ADAPTIVE DIFFICULTY — a hidden difficulty_score (1-10, starts at
//      4) drives how hard each next question is. A strong, detailed
//      answer nudges it up (+1); a hesitant/vague/wrong one nudges it
//      down (-2), on the theory that easing off rebuilds confidence
//      rather than punishing a bad moment.
//   2) MULTI-AXIS GRADING — every candidate turn is scored on
//      Technical_Accuracy, Clarity_Structure (STAR/SCR framework use)
//      and Verbal_Fluency (filler-word / hedging penalty), 0-100 each,
//      stored per-turn.
//   3) FEEDBACK RULE — the interviewer never bluntly says "wrong". When
//      an answer has real gaps, the model is instructed to redirect in
//      the "that's an interesting angle, however in production we
//      usually approach X because of Y — let's try something similar
//      but a little easier" register, then hands back an easier
//      follow-up (which the difficulty_score drop already biases for).
//   4) TIER UNLOCK — 5 CONSECUTIVE candidate turns scoring >80 on all
//      three axes flips interview_ready to true and the session
//      surfaces a one-time "Interview Ready" unlock event. There is no
//      "Startup Navigator" module in this codebase to unlock a tier
//      in, so this only sets the flag/timestamp on the session for any
//      future module to key off of — see the code comment near
//      maybeUnlockTier() for specifics.
// Fully additive — own tables, own file, own routes. Nothing existing
// was changed.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS live_interview_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  company TEXT,
  round_type TEXT NOT NULL DEFAULT 'mixed',
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  interviewer_persona TEXT,
  max_turns INTEGER NOT NULL DEFAULT 8,
  turn_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  overall_score REAL,
  overall_feedback TEXT,
  strengths TEXT,
  improvements TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_live_int_student ON live_interview_sessions(student_id);

CREATE TABLE IF NOT EXISTS live_interview_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_interview_sessions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK(speaker IN ('interviewer','candidate')),
  message TEXT NOT NULL,
  voice_script TEXT,
  topic_focus TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_int_turns_session ON live_interview_turns(session_id);
`);

// --- v3.0 additive migration (safe on both a fresh table and an already
// -created one from before this pass — mirrors the addColumnIfMissing
// pattern already used in db.js for OAuth columns). ---
function addColumnIfMissing(table, column, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  } catch (e) {
    console.warn(`[liveInterviewBot] could not add column ${table}.${column}:`, e.message);
  }
}

addColumnIfMissing('live_interview_sessions', 'difficulty_score', 'difficulty_score REAL NOT NULL DEFAULT 4');
addColumnIfMissing('live_interview_sessions', 'consecutive_high_score_count', 'consecutive_high_score_count INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('live_interview_sessions', 'interview_ready', 'interview_ready INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('live_interview_sessions', 'interview_ready_at', 'interview_ready_at TEXT');
addColumnIfMissing('live_interview_turns', 'technical_accuracy', 'technical_accuracy REAL');
addColumnIfMissing('live_interview_turns', 'clarity_structure', 'clarity_structure REAL');
addColumnIfMissing('live_interview_turns', 'verbal_fluency', 'verbal_fluency REAL');
addColumnIfMissing('live_interview_turns', 'axis_feedback', 'axis_feedback TEXT');

// Same formatting contract as interviewMasteryCoach.js — applies only to
// the post-interview written report (finalizeSession), never to live
// interviewerMessage/voiceScript turns, which must stay short and spoken.
const FORMATTING_STANDARD = `
FORMATTING STANDARD for every field marked "(markdown)" below:
- Use markdown: ## short section headers, **bold** for key terms, bullet or numbered lists for anything sequential or enumerable.
- Go deep, not just wide: explain the reasoning behind each judgment (the "why"), with a specific moment from the transcript as evidence, not a generic statement.
- Structure before prose: clearly labeled sections over one long paragraph, so it can be scanned as well as read.
- Stay concrete and specific to this transcript — avoid advice generic enough to apply to any candidate.
- Keep it tight: thorough does not mean padded.`;

const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
const READY_STREAK_TARGET = 5;
const READY_AXIS_THRESHOLD = 80;

function uid() { return crypto.randomUUID(); }
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const j = (v) => JSON.stringify(arr(v));
const parseJ = (v) => { try { return JSON.parse(v || '[]'); } catch (_e) { return []; } };

function addTurn(sessionId, idx, speaker, message, extra = {}) {
  const { voiceScript, topicFocus, technicalAccuracy, clarityStructure, verbalFluency, axisFeedback } = extra;
  db.prepare(
    `INSERT INTO live_interview_turns (id, session_id, idx, speaker, message, voice_script, topic_focus, technical_accuracy, clarity_structure, verbal_fluency, axis_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(), sessionId, idx, speaker, message, voiceScript || null, topicFocus || null, technicalAccuracy ?? null, clarityStructure ?? null, verbalFluency ?? null, axisFeedback || null);
}

function buildTranscript(turns) {
  return turns.map((t) => `${t.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.message}`).join('\n');
}

function difficultyLabel(score) {
  if (score <= 3) return 'easy — warm, confidence-building, foundational questions';
  if (score <= 6) return 'medium — standard role-appropriate depth';
  if (score <= 8) return 'hard — probing, expects precise trade-off reasoning';
  return 'expert — staff/principal-level depth, edge cases and system-wide trade-offs';
}

const SYSTEM_PERSONA = (targetRole, company, roundType, difficultyScore) =>
  `You are conducting a LIVE, real-time interview for a "${targetRole}" position${company ? ` at ${company}` : ''}. Round type: ${roundType}. Current question difficulty (1-10 scale, adapts turn by turn): ${Math.round(difficultyScore)} — ${difficultyLabel(difficultyScore)}. Stay fully in character as a warm but rigorous human interviewer — never mention you are an AI, never show meta-commentary, never mention the numeric difficulty score itself. Behave exactly like a real interviewer: react naturally to what the candidate just said (brief acknowledgement, not a canned "Thank you for your answer" every time), ask ONE thing at a time, and dynamically choose between (a) a follow-up that digs deeper into their last answer if it was vague/incomplete/interesting, (b) a natural transition to a new question/topic pitched at the current difficulty level if the last answer was well covered, or (c) wrapping up the round if enough ground has been covered. Keep each of your turns to 1-3 sentences, like real spoken dialogue — not an essay.
FEEDBACK RULE: never bluntly tell the candidate they are "wrong" or "incorrect". If their answer has real gaps, redirect gently in this register: "That's an interesting angle. However, in a production environment, we usually approach X because of Y. Let's try a similar but slightly easier scenario." — substituting the real X/Y for this question — then follow through by actually asking something a little easier next.`;

const FALLBACK_OPENING = (targetRole) => ({
  interviewerMessage: `Hi, thanks for joining. I'll be interviewing you today for the ${targetRole} role. To start — could you walk me through your background and what draws you to this role?`,
  voiceScript: `Hi, thanks for joining today. Let's get started — could you walk me through your background and what draws you to this role?`,
  topicFocus: 'Introduction',
});

async function startSession({ apiKey, model, studentId, targetRole, company, roundType = 'mixed', difficulty = 'medium', maxTurns = 8 }) {
  if (!targetRole || !String(targetRole).trim()) throw Object.assign(new Error('targetRole is required'), { status: 400 });
  const n = Math.max(4, Math.min(20, Number(maxTurns) || 8));
  const startingDifficultyScore = 4;

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `${SYSTEM_PERSONA(targetRole, company, roundType, startingDifficultyScore)}\nThis is the OPENING of the interview. Greet the candidate briefly and ask your first question. Return JSON: {"interviewerMessage":"what you say, 1-3 sentences","voiceScript":"same, phrased for natural spoken read-aloud","topicFocus":"short label for what this question probes"}.`,
    prompt: `Begin the interview now.`,
    maxTokens: 400,
    temperature: 0.7,
  });

  const opening = ai.ok ? ai.data : FALLBACK_OPENING(targetRole);

  const sessionId = uid();
  db.prepare(
    `INSERT INTO live_interview_sessions (id, student_id, target_role, company, round_type, difficulty, max_turns, turn_count, difficulty_score, consecutive_high_score_count, interview_ready) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
  ).run(sessionId, studentId, targetRole, company || null, roundType, difficulty, n, 1, startingDifficultyScore);
  addTurn(sessionId, 0, 'interviewer', opening.interviewerMessage || `Let's begin — tell me about yourself.`, { voiceScript: opening.voiceScript, topicFocus: opening.topicFocus });

  return getSession(studentId, sessionId);
}

function getSession(studentId, sessionId) {
  const session = db.prepare('SELECT * FROM live_interview_sessions WHERE id = ? AND student_id = ?').get(sessionId, studentId);
  if (!session) return null;
  const turns = db.prepare('SELECT * FROM live_interview_turns WHERE session_id = ? ORDER BY idx ASC').all(sessionId);
  return {
    ...session,
    interviewReady: Boolean(session.interview_ready),
    strengths: parseJ(session.strengths),
    improvements: parseJ(session.improvements),
    turns,
  };
}

function listSessions(studentId) {
  return db.prepare('SELECT id, target_role, company, round_type, difficulty, difficulty_score, status, turn_count, max_turns, overall_score, interview_ready, created_at, completed_at FROM live_interview_sessions WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

async function finalizeSession({ apiKey, model, studentId, sessionId, closingLine }) {
  const session = getSession(studentId, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  const transcript = buildTranscript(session.turns);
  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `You just finished conducting a live interview. Evaluate the CANDIDATE turns only (not your own). Return JSON: {"overallScore":0-100,"overallFeedback":"(markdown) a structured post-interview report with sections like '## Overall impression', '## Technical depth', '## Communication', '## Readiness verdict' — each grounded in specific moments from the transcript, not generic commentary","strengths":["specific strength, with a moment from the transcript as evidence","..."],"improvements":["specific, actionable improvement — not just 'be more confident' but what to actually change and why it matters","..."]}.${FORMATTING_STANDARD}`,
    prompt: `Full transcript:\n${transcript}`,
    maxTokens: 1500,
  });
  const evalData = ai.ok ? ai.data : { overallScore: null, overallFeedback: 'AI evaluation unavailable right now. Review the transcript above manually.', strengths: [], improvements: [] };

  const nextIdx = session.turns.length;
  addTurn(sessionId, nextIdx, 'interviewer', closingLine || 'That covers everything I wanted to ask — thanks for your time today, we\'ll be in touch soon.', { topicFocus: 'Closing' });

  db.prepare(
    `UPDATE live_interview_sessions SET status='completed', turn_count = turn_count + 1, overall_score=?, overall_feedback=?, strengths=?, improvements=?, completed_at=datetime('now') WHERE id = ?`
  ).run(evalData.overallScore ?? null, evalData.overallFeedback || null, j(evalData.strengths), j(evalData.improvements), sessionId);

  return getSession(studentId, sessionId);
}

// Adjusts the hidden difficulty score off the three axis scores for the
// answer just graded: a strong, detailed answer (avg >= 75) nudges it up;
// a hesitant/vague/wrong one (avg < 50) eases it back down by 2 so the
// next question rebuilds confidence rather than compounding a bad moment.
function nextDifficultyScore(current, technicalAccuracy, clarityStructure, verbalFluency) {
  const scores = [technicalAccuracy, clarityStructure, verbalFluency].filter((s) => typeof s === 'number');
  if (!scores.length) return current;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  let next = current;
  if (avg >= 75) next = current + 1;
  else if (avg < 50) next = current - 2;
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, next));
}

// TIER UNLOCK: 5 consecutive candidate turns scoring >80 on ALL three axes.
// This codebase has no "Startup Navigator" module to unlock a tier inside
// of, so unlocking here just means: flip interview_ready + stamp
// interview_ready_at on the session. Any future module (career simulator,
// placement autopilot, etc.) can read that flag via listSessions/getSession
// to gate its own next tier — wiring an actual consumer is a separate,
// explicit step since nothing in this codebase currently reads it.
function updateReadinessStreak(sessionId, currentStreak, technicalAccuracy, clarityStructure, verbalFluency) {
  const allAboveThreshold = [technicalAccuracy, clarityStructure, verbalFluency]
    .every((s) => typeof s === 'number' && s > READY_AXIS_THRESHOLD);
  const newStreak = allAboveThreshold ? currentStreak + 1 : 0;
  const justUnlocked = newStreak >= READY_STREAK_TARGET;
  if (justUnlocked) {
    db.prepare(`UPDATE live_interview_sessions SET consecutive_high_score_count = ?, interview_ready = 1, interview_ready_at = datetime('now') WHERE id = ? AND interview_ready = 0`).run(newStreak, sessionId);
  } else {
    db.prepare(`UPDATE live_interview_sessions SET consecutive_high_score_count = ? WHERE id = ?`).run(newStreak, sessionId);
  }
  return { newStreak, justUnlocked };
}

async function respond({ apiKey, model, studentId, sessionId, answerText }) {
  const session = getSession(studentId, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.status !== 'in_progress') throw Object.assign(new Error('Session already completed'), { status: 400 });
  if (!answerText || !String(answerText).trim()) throw Object.assign(new Error('answerText is required'), { status: 400 });

  // Grade the candidate's answer on the three axes BEFORE recording it, so
  // the row is written once with scores attached rather than patched after.
  const priorTranscript = buildTranscript(session.turns);
  const gradeAi = await callAnthropicJson({
    apiKey,
    model,
    system: `You are grading ONE candidate answer in a live interview on three axes, each 0-100: Technical_Accuracy (correctness/depth for the question asked), Clarity_Structure (did they structure the answer well — e.g. STAR for behavioral, or a clear problem->approach->result shape for technical), and Verbal_Fluency (penalize filler words like "um", "uh", "like", excessive hedging, and rambling — reward confident, concise delivery). Return JSON: {"technicalAccuracy":0-100,"clarityStructure":0-100,"verbalFluency":0-100,"axisFeedback":"(markdown, brief) 2-4 short bullet points, one per axis that scored notably high or low, naming specifically what drove that score in this answer"}.${FORMATTING_STANDARD}`,
    prompt: `Interview so far:\n${priorTranscript}\n\nCandidate's latest answer to grade: ${answerText}`,
    maxTokens: 600,
  });
  const grades = gradeAi.ok ? gradeAi.data : { technicalAccuracy: null, clarityStructure: null, verbalFluency: null, axisFeedback: null };

  const candidateIdx = session.turns.length;
  addTurn(sessionId, candidateIdx, 'candidate', answerText, {
    technicalAccuracy: grades.technicalAccuracy,
    clarityStructure: grades.clarityStructure,
    verbalFluency: grades.verbalFluency,
    axisFeedback: grades.axisFeedback,
  });

  const newDifficultyScore = nextDifficultyScore(session.difficulty_score, grades.technicalAccuracy, grades.clarityStructure, grades.verbalFluency);
  const { newStreak, justUnlocked } = updateReadinessStreak(sessionId, session.consecutive_high_score_count, grades.technicalAccuracy, grades.clarityStructure, grades.verbalFluency);
  db.prepare(`UPDATE live_interview_sessions SET turn_count = turn_count + 1, difficulty_score = ? WHERE id = ?`).run(newDifficultyScore, sessionId);

  const refreshed = getSession(studentId, sessionId);
  const nearingEnd = refreshed.turn_count >= refreshed.max_turns - 1;
  const transcript = buildTranscript(refreshed.turns);

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `${SYSTEM_PERSONA(refreshed.target_role, refreshed.company, refreshed.round_type, refreshed.difficulty_score)}\nHere is the transcript so far. Respond with your NEXT turn only — either a follow-up on the candidate's last answer, a transition to a new question at the current difficulty level, or (only if the round has genuinely covered enough ground${nearingEnd ? ', which it now has — start wrapping up' : ''}) signal you're ready to close. Return JSON: {"interviewerMessage":"your next line, 1-3 sentences, following the FEEDBACK RULE above","voiceScript":"same, phrased for natural spoken read-aloud","topicFocus":"short label for what this turn probes","shouldEnd":true|false}. Set shouldEnd true only if this is your closing line thanking the candidate and ending the round.`,
    prompt: transcript,
    maxTokens: 500,
    temperature: 0.7,
  });

  const turnData = ai.ok ? ai.data : {
    interviewerMessage: nearingEnd ? `That's helpful, thank you. I think that covers what I needed — we'll wrap up here.` : `Could you expand a bit more on that?`,
    voiceScript: null,
    topicFocus: null,
    shouldEnd: nearingEnd,
  };

  if (turnData.shouldEnd || refreshed.turn_count >= refreshed.max_turns) {
    const finalized = await finalizeSession({ apiKey, model, studentId, sessionId, closingLine: turnData.interviewerMessage });
    return { ...finalized, justUnlockedInterviewReady: justUnlocked };
  }

  const nextIdx = refreshed.turns.length;
  addTurn(sessionId, nextIdx, 'interviewer', turnData.interviewerMessage || 'Could you tell me more?', { voiceScript: turnData.voiceScript, topicFocus: turnData.topicFocus });
  db.prepare(`UPDATE live_interview_sessions SET turn_count = turn_count + 1 WHERE id = ?`).run(sessionId);

  const finalState = getSession(studentId, sessionId);
  return { ...finalState, justUnlockedInterviewReady: justUnlocked };
}

async function endSessionEarly({ apiKey, model, studentId, sessionId }) {
  const session = getSession(studentId, sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.status !== 'in_progress') return session;
  return finalizeSession({ apiKey, model, studentId, sessionId, closingLine: 'We\'ll stop the round here — thanks for your time today.' });
}

module.exports = { startSession, getSession, listSessions, respond, endSessionEarly };
