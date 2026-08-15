// AI Study Planner: turns a student's real grades + attendance + upcoming
// timetable/assignments/events into a personalized weekly study schedule.
// Additive module, own table, same call pattern as quiz.js's
// generateQuestionsWithAI (strict-JSON prompt, deterministic fallback if
// the model call fails or no API key is set — the feature never just
// breaks, same philosophy as resumeBuilder.js).

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS study_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_study_plans_user ON study_plans(user_id);
`);

function uid() {
  return crypto.randomUUID();
}

// Pulls together everything already in the DB about this student so the
// plan is grounded in real data rather than generic advice.
function gatherContext(studentId, classSection) {
  const grades = db
    .prepare('SELECT subject, exam_type, marks, max_marks FROM grades WHERE student_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(studentId);

  const attendance = db
    .prepare(
      `SELECT subject, COUNT(*) total, SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) present
       FROM attendance WHERE student_id = ? GROUP BY subject`
    )
    .all(studentId);

  let upcomingAssignments = [];
  let upcomingQuizzes = [];
  let timetable = [];
  try {
    if (classSection) {
      upcomingAssignments = db
        .prepare(`SELECT title, subject, due_date FROM assignments WHERE class_section = ? AND due_date >= date('now') ORDER BY due_date ASC LIMIT 10`)
        .all(classSection);
    }
  } catch (_e) { /* assignments table may not exist yet on a very first boot race — ignore */ }
  try {
    if (classSection) {
      upcomingQuizzes = db
        .prepare(`SELECT title, subject FROM quizzes WHERE class_section = ? AND is_published = 1 ORDER BY created_at DESC LIMIT 10`)
        .all(classSection);
    }
  } catch (_e) { /* ignore */ }
  try {
    if (classSection) {
      timetable = db
        .prepare(`SELECT day_of_week, period_no, subject FROM timetable_slots WHERE class_section = ? ORDER BY day_of_week, period_no`)
        .all(classSection);
    }
  } catch (_e) { /* ignore */ }

  const weakSubjects = grades
    .filter((g) => g.max_marks > 0 && g.marks / g.max_marks < 0.6)
    .map((g) => g.subject);

  return { grades, attendance, upcomingAssignments, upcomingQuizzes, timetable, weakSubjects: [...new Set(weakSubjects)] };
}

function deterministicFallback(context) {
  const { weakSubjects, upcomingAssignments, upcomingQuizzes } = context;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const focusSubjects = weakSubjects.length ? weakSubjects : ['Revision', 'Reading'];
  const schedule = days.map((day, i) => ({
    day,
    blocks: [
      {
        subject: focusSubjects[i % focusSubjects.length],
        durationMinutes: 45,
        focus: weakSubjects.length ? 'Targeted practice on recent low scores' : 'General revision',
      },
    ],
  }));
  return {
    summary: weakSubjects.length
      ? `Focused on strengthening ${weakSubjects.join(', ')}, based on recent grades below 60%.`
      : 'A steady general-revision schedule — no subject currently below 60% in recent grades.',
    schedule,
    priorities: [
      ...upcomingAssignments.map((a) => `Assignment due ${a.due_date}: ${a.title} (${a.subject})`),
      ...upcomingQuizzes.map((q) => `Published quiz available: ${q.title} (${q.subject})`),
    ].slice(0, 8),
    aiGenerated: false,
  };
}

async function generatePlan({ apiKey, model, studentId, classSection, preferences }) {
  const context = gatherContext(studentId, classSection);

  let plan;
  if (apiKey) {
    try {
      const system = [
        'You are an academic study-planning assistant for a school platform.',
        'Return ONLY strict JSON, no markdown fences, no commentary, matching this shape:',
        '{"summary":"...", "schedule":[{"day":"Monday","blocks":[{"subject":"...","durationMinutes":45,"focus":"..."}]}], "priorities":["..."]}',
        'Base the plan on the real grades/attendance/deadlines given. Prioritize subjects with lower scores or attendance. Keep total daily study time reasonable (60-120 min/day unless the student says otherwise). Cover all 7 days, but weekends can be lighter.',
      ].join(' ');
      const userPrompt = JSON.stringify({
        recentGrades: context.grades,
        attendanceBySubject: context.attendance,
        upcomingAssignments: context.upcomingAssignments,
        upcomingQuizzes: context.upcomingQuizzes,
        studentPreferences: preferences || null,
      });

      const text = await callAnthropic({
        apiKey,
        model,
        system,
        messages: [{ role: 'user', content: `Build my study plan from this data:\n${userPrompt}` }],
        temperature: 0.4,
        maxTokens: 1400,
      });

      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed.schedule || !Array.isArray(parsed.schedule)) throw new Error('malformed plan');
      plan = { ...parsed, aiGenerated: true };
    } catch (e) {
      console.error('[studyPlanner] AI generation failed, using deterministic fallback:', e?.message || e);
      plan = deterministicFallback(context);
    }
  } else {
    plan = deterministicFallback(context);
  }

  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  const id = uid();
  db.prepare('INSERT INTO study_plans (id, user_id, week_start, plan_json, ai_generated) VALUES (?, ?, ?, ?, ?)').run(
    id,
    studentId,
    weekStart.toISOString().slice(0, 10),
    JSON.stringify(plan),
    plan.aiGenerated ? 1 : 0
  );

  return { id, weekStart: weekStart.toISOString().slice(0, 10), ...plan };
}

function listPlans(studentId, limit = 10) {
  const rows = db
    .prepare('SELECT * FROM study_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(studentId, Math.max(1, Math.min(50, Number(limit) || 10)));
  return rows.map((r) => ({ id: r.id, weekStart: r.week_start, aiGenerated: Boolean(r.ai_generated), createdAt: r.created_at, ...JSON.parse(r.plan_json) }));
}

function getPlan(id, studentId) {
  const row = db.prepare('SELECT * FROM study_plans WHERE id = ? AND user_id = ?').get(id, studentId);
  if (!row) return null;
  return { id: row.id, weekStart: row.week_start, aiGenerated: Boolean(row.ai_generated), createdAt: row.created_at, ...JSON.parse(row.plan_json) };
}

module.exports = { generatePlan, listPlans, getPlan };
