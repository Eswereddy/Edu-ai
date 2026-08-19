// AI ADMIN PORTAL ADD-ON (12) — AI Interview & Career Mastery Coach
// Three linked capabilities, requested as a follow-up to the existing
// AI Interview Orchestrator (interviewLab.js, untouched):
//   1) DSA Practice — generates a DSA problem at a chosen topic/
//      difficulty, explains the underlying PATTERN/logic to reach it
//      (not just the answer), and grades a student's own approach or
//      code against that logic with hints for what's missing.
//   2) Presentation Skills Coach — student submits a talk/presentation
//      topic + outline (or a script draft); AI returns a structured
//      review (clarity, structure, delivery, timing) plus a suggested
//      slide-by-slide outline and speaker-note tips.
//   3) Interview Round Strategy — given a target company/role and a
//      round type (HR, technical, system design, group discussion,
//      managerial), generates a concrete round-wise game plan: what
//      to expect, how to prepare this week, and a sample answer
//      structure to lean on during the round.
// Distinct from interviewLab.js (Q&A mock interviews), codeReviewer.js
// (reviews finished projects/repos, not problem-solving logic), and
// careerPrep.js (cover letters). Fully additive — own tables, own
// file, own routes, mounted the same way as every other AI Admin
// Portal add-on (admin/ai-admin only). Nothing existing was changed.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS dsa_practice_problems (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy','medium','hard')),
  title TEXT,
  problem_statement TEXT,
  pattern TEXT,
  approach_logic TEXT,
  complexity_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dsa_student ON dsa_practice_problems(student_id);

CREATE TABLE IF NOT EXISTS dsa_practice_attempts (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES dsa_practice_problems(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  approach_text TEXT NOT NULL,
  code TEXT,
  verdict TEXT,
  score REAL,
  logic_feedback TEXT,
  missing_cases TEXT,
  hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dsa_attempt_problem ON dsa_practice_attempts(problem_id);

CREATE TABLE IF NOT EXISTS presentation_reviews (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  audience TEXT,
  duration_minutes INTEGER,
  draft_text TEXT,
  clarity_score REAL,
  structure_score REAL,
  delivery_score REAL,
  overall_feedback TEXT,
  slide_outline TEXT,
  speaker_tips TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pres_student ON presentation_reviews(student_id);

CREATE TABLE IF NOT EXISTS interview_round_strategies (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  company TEXT,
  target_role TEXT NOT NULL,
  round_type TEXT NOT NULL,
  experience_level TEXT,
  what_to_expect TEXT,
  weekly_prep_plan TEXT,
  answer_structure TEXT,
  common_mistakes TEXT,
  confidence_tips TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_round_student ON interview_round_strategies(student_id);
`);

function uid() { return crypto.randomUUID(); }
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const j = (v) => JSON.stringify(arr(v));
const parseJ = (v) => { try { return JSON.parse(v || '[]'); } catch (_e) { return []; } };

// Shared formatting contract, appended to every system prompt below so
// every long-form text field the AI writes — not just the JSON shape —
// comes back well-structured, readable, and genuinely explanatory
// rather than a dense one-paragraph blob. Applies to any string field
// described as "markdown" in a schema below.
const FORMATTING_STANDARD = `
FORMATTING STANDARD for every long-form text field marked "(markdown)" below:
- Use markdown: ## short section headers, **bold** for key terms, bullet or numbered lists for anything sequential or enumerable.
- Go deep, not just wide: don't just state a conclusion — explain the reasoning behind it (the "why", not just the "what"), with a concrete example or analogy where it helps.
- Structure before prose: break the explanation into clearly labeled sections rather than one long paragraph, so it can be scanned as well as read.
- Stay concrete: prefer specific, situation-relevant detail over generic advice that could apply to anything.
- Keep it tight: thorough does not mean padded — every sentence should add information, not restate the previous one.`;

// ---------------------------------------------------------------- DSA ----

const FALLBACK_DSA = (topic, difficulty) => ({
  title: `${topic} warm-up (${difficulty})`,
  problemStatement: `Given the topic "${topic}", solve a representative ${difficulty} problem: describe the input, the goal, and constraints in your own words, then implement it. (AI generation was unavailable, so this is a generic placeholder — try again shortly for a tailored problem.)`,
  pattern: topic,
  approachLogic: `Think about which core ${topic} technique applies, identify the invariant it maintains, then map that invariant onto the input.`,
  complexityHint: 'Aim for the standard optimal complexity for this pattern; state your target Big-O before coding.',
});

async function generateDsaProblem({ apiKey, model, studentId, topic, difficulty = 'medium' }) {
  if (!topic || !String(topic).trim()) throw Object.assign(new Error('topic is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `You are a DSA (Data Structures & Algorithms) interview coach. Generate ONE practice problem for the given topic/difficulty, and — crucially — explain the underlying PATTERN and step-by-step REASONING a candidate should use to arrive at the solution (not just the final answer). Return JSON: {"title":"...","problemStatement":"full problem text with constraints and 1-2 worked examples (markdown)","pattern":"e.g. sliding window / two pointers / DP on subsets / etc","approachLogic":"(markdown) a deep walkthrough with sections like '## Recognizing the pattern', '## The key invariant', '## Building up the solution step by step' — each with real reasoning, not just labels","complexityHint":"(markdown) expected time/space complexity, WHY it's optimal, and what a worse but tempting approach would cost instead"}.${FORMATTING_STANDARD}`,
    prompt: `Topic: ${topic}\nDifficulty: ${difficulty}\nGenerate one interview-style DSA problem with its solving logic explained in depth (do NOT give final code, only the reasoning/approach).`,
    maxTokens: 2000,
  });

  const data = ai.ok ? ai.data : FALLBACK_DSA(topic, difficulty);

  const id = uid();
  db.prepare(
    `INSERT INTO dsa_practice_problems (id, student_id, topic, difficulty, title, problem_statement, pattern, approach_logic, complexity_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, topic, difficulty, data.title || null, data.problemStatement || null, data.pattern || null, data.approachLogic || null, data.complexityHint || null);

  return getDsaProblem(studentId, id);
}

function getDsaProblem(studentId, id) {
  const row = db.prepare('SELECT * FROM dsa_practice_problems WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  const attempts = db.prepare('SELECT * FROM dsa_practice_attempts WHERE problem_id = ? ORDER BY created_at ASC').all(id);
  return { ...row, attempts: attempts.map((a) => ({ ...a, missingCases: parseJ(a.missing_cases) })) };
}

function listDsaProblems(studentId) {
  return db.prepare('SELECT id, topic, difficulty, title, created_at FROM dsa_practice_problems WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

async function gradeDsaAttempt({ apiKey, model, studentId, problemId, approachText, code }) {
  const problem = db.prepare('SELECT * FROM dsa_practice_problems WHERE id = ? AND student_id = ?').get(problemId, studentId);
  if (!problem) throw Object.assign(new Error('Problem not found'), { status: 404 });
  if (!approachText || !String(approachText).trim()) throw Object.assign(new Error('approachText is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `You are grading a candidate's DSA problem-solving LOGIC (approach first, code optional/secondary). Judge whether their reasoning correctly identifies the pattern, handles edge cases, and reaches the right complexity — do not just check if code compiles. Return JSON: {"verdict":"correct|partially_correct|incorrect","score":0-100,"logicFeedback":"(markdown) a structured breakdown: what they got right and why it works, what's missing or wrong and why it matters, framed so they understand the reasoning gap — not just told the verdict","missingCases":["edge case or gap 1","..."],"hint":"one nudging hint toward the right pattern, without giving the full solution"}.${FORMATTING_STANDARD}`,
    prompt: `Problem: ${problem.problem_statement}\nExpected pattern/logic: ${problem.approach_logic || problem.pattern || 'n/a'}\nCandidate's approach: ${approachText}\n${code ? `Candidate's code:\n${String(code).slice(0, 4000)}` : '(no code submitted, approach only)'}`,
    maxTokens: 1400,
  });

  const graded = ai.ok ? ai.data : { verdict: 'incorrect', score: null, logicFeedback: 'AI grading unavailable right now — attempt recorded ungraded.', missingCases: [], hint: null };

  const id = uid();
  db.prepare(
    `INSERT INTO dsa_practice_attempts (id, problem_id, student_id, approach_text, code, verdict, score, logic_feedback, missing_cases, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, problemId, studentId, approachText, code || null, graded.verdict || null, graded.score ?? null, graded.logicFeedback || null, j(graded.missingCases), graded.hint || null);

  return getDsaProblem(studentId, problemId);
}

// --------------------------------------------------------- Presentation --

async function reviewPresentation({ apiKey, model, studentId, topic, audience, durationMinutes, draftText }) {
  if (!topic || !String(topic).trim()) throw Object.assign(new Error('topic is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `You are a presentation-skills coach preparing a student for interview presentations, campus talks, or viva/defense presentations. Score 0-100 on three axes and give a slide-by-slide outline + speaker tips. Return JSON: {"clarityScore":0-100,"structureScore":0-100,"deliveryScore":0-100,"overallFeedback":"(markdown) organized under '## Clarity', '## Structure', '## Delivery' sub-sections — for each, say what's working, what isn't, and WHY it lands or doesn't for this audience/duration, with a concrete fix","slideOutline":["Slide 1: ...","Slide 2: ...","..."],"speakerTips":["tip 1 — concrete and situation-specific, not generic public-speaking advice","tip 2","..."]}. If no draft text was given, base slideOutline/speakerTips on the topic/audience/duration alone and note in overallFeedback that scores are provisional until a draft is shared.${FORMATTING_STANDARD}`,
    prompt: `Topic: ${topic}\nAudience: ${audience || 'general/interview panel'}\nTarget duration: ${durationMinutes || 5} minutes\nDraft/outline provided by student: ${draftText || '(none provided — build a suggested structure from scratch)'}`,
    maxTokens: 1800,
  });

  const data = ai.ok ? ai.data : {
    clarityScore: null, structureScore: null, deliveryScore: null,
    overallFeedback: 'AI review unavailable right now.',
    slideOutline: [], speakerTips: [],
  };

  const id = uid();
  db.prepare(
    `INSERT INTO presentation_reviews (id, student_id, topic, audience, duration_minutes, draft_text, clarity_score, structure_score, delivery_score, overall_feedback, slide_outline, speaker_tips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, studentId, topic, audience || null, durationMinutes || null, draftText || null,
    data.clarityScore ?? null, data.structureScore ?? null, data.deliveryScore ?? null,
    data.overallFeedback || null, j(data.slideOutline), j(data.speakerTips)
  );

  return getPresentationReview(studentId, id);
}

function getPresentationReview(studentId, id) {
  const row = db.prepare('SELECT * FROM presentation_reviews WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  return { ...row, slideOutline: parseJ(row.slide_outline), speakerTips: parseJ(row.speaker_tips) };
}

function listPresentationReviews(studentId) {
  return db.prepare('SELECT id, topic, audience, clarity_score, structure_score, delivery_score, created_at FROM presentation_reviews WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

// ------------------------------------------------------- Round strategy --

async function generateRoundStrategy({ apiKey, model, studentId, company, targetRole, roundType, experienceLevel }) {
  if (!targetRole || !String(targetRole).trim()) throw Object.assign(new Error('targetRole is required'), { status: 400 });
  if (!roundType || !String(roundType).trim()) throw Object.assign(new Error('roundType is required'), { status: 400 });

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: `You are an interview strategy coach. Given a target role, round type (e.g. HR, technical/DSA, system design, group discussion, managerial), and optional company/experience level, produce a concrete, honest game plan for FACING that specific round — what actually happens in it, how to prepare over the next week, a reusable answer structure, common mistakes to avoid, and how to stay calm/confident. Return JSON: {"whatToExpect":"(markdown) a detailed, realistic walkthrough of the round's format, pacing, and who's evaluating what — enough that nothing in the room should feel unfamiliar","weeklyPrepPlan":["Day 1-2: ...","Day 3-4: ...","..."],"answerStructure":"(markdown) a reusable framework to structure responses in this round (e.g. STAR, or a technical-round framework), explained with a short worked example so it's clear how to actually apply it, not just named","commonMistakes":["mistake 1 — and why it backfires specifically in this round","mistake 2","..."],"confidenceTips":["tip 1","tip 2","..."]}.${FORMATTING_STANDARD}`,
    prompt: `Target role: ${targetRole}\nCompany (if known): ${company || 'not specified — keep it general but realistic'}\nRound type: ${roundType}\nExperience level: ${experienceLevel || 'entry-level / campus placement'}`,
    maxTokens: 2200,
  });

  const data = ai.ok ? ai.data : {
    whatToExpect: 'AI generation unavailable right now — try again shortly.',
    weeklyPrepPlan: [], answerStructure: null, commonMistakes: [], confidenceTips: [],
  };

  const id = uid();
  db.prepare(
    `INSERT INTO interview_round_strategies (id, student_id, company, target_role, round_type, experience_level, what_to_expect, weekly_prep_plan, answer_structure, common_mistakes, confidence_tips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, studentId, company || null, targetRole, roundType, experienceLevel || null,
    data.whatToExpect || null, j(data.weeklyPrepPlan), data.answerStructure || null,
    j(data.commonMistakes), j(data.confidenceTips)
  );

  return getRoundStrategy(studentId, id);
}

function getRoundStrategy(studentId, id) {
  const row = db.prepare('SELECT * FROM interview_round_strategies WHERE id = ? AND student_id = ?').get(id, studentId);
  if (!row) return null;
  return { ...row, weeklyPrepPlan: parseJ(row.weekly_prep_plan), commonMistakes: parseJ(row.common_mistakes), confidenceTips: parseJ(row.confidence_tips) };
}

function listRoundStrategies(studentId) {
  return db.prepare('SELECT id, company, target_role, round_type, created_at FROM interview_round_strategies WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

module.exports = {
  generateDsaProblem, getDsaProblem, listDsaProblems, gradeDsaAttempt,
  reviewPresentation, getPresentationReview, listPresentationReviews,
  generateRoundStrategy, getRoundStrategy, listRoundStrategies,
};
