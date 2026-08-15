require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { callAnthropic, UpstreamAIError } = require('./anthropicClient');
const { getRolePrompt } = require('./rolePrompts');
const { retrieve } = require('./rag'); // upgraded TF-IDF retrieval (drop-in, same contract as knowledgeBase.retrieve)
const { attachUserIfPresent } = require('./auth');
const memory = require('./memory');
const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');
const createResumeRouter = require('./routes/resumeRoutes');

// New in this pass: timetable, assignments, quizzes, library, events,
// messaging, forum, gamification, uploads, settings, search, reports.
// Every one of these is a self-contained module with its own DB tables
// (created via CREATE TABLE IF NOT EXISTS in its own file) — nothing
// above this line changes behavior for routes that don't use them.
const timetableRoutes = require('./routes/timetableRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const createQuizRouter = require('./routes/quizRoutes');
const libraryRoutes = require('./routes/libraryRoutes');
const eventRoutes = require('./routes/eventRoutes');
const messageRoutes = require('./routes/messageRoutes');
const forumRoutes = require('./routes/forumRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const searchRoutes = require('./routes/searchRoutes');
const reportRoutes = require('./routes/reportRoutes');

// New in this pass: real-time WebSocket push, an AI study planner, and a
// background scheduler for overdue-library reminders. Same additive
// contract as everything above — new files, new mounts only.
const createStudyPlanRouter = require('./routes/studyPlanRoutes');
const academicsRoutes = require('./routes/academicsRoutes'); // additive: semester subjects + results + SGPA/CGPA
const leaveRoutes = require('./routes/leaveRoutes'); // additive: student/faculty leave applications + approval
const feeReceiptRoutes = require('./routes/feeReceiptRoutes'); // additive: PDF receipts for existing paid fees
const certificateRoutes = require('./routes/certificateRoutes'); // additive: Bonafide/Study/Character certificate requests + PDFs
const admissionRoutes = require('./routes/admissionRoutes'); // additive: admissions & enrollment (applications, seat matrix, auto-enroll)
const hostelRoutes = require('./routes/hostelRoutes'); // additive: hostel room inventory + allocation
const hostelMessRoutes = require('./routes/hostelMessRoutes'); // additive: mess menu, meal attendance, hostel complaints
const transportRoutes = require('./routes/transportRoutes'); // additive: bus routes/stops + student subscriptions
const busTrackingRoutes = require('./routes/busTrackingRoutes'); // additive: live bus GPS tracking
const busTrackingLiveRoutes = require('./routes/busTrackingLiveRoutes'); // additive: real GPS ingestion + WebSocket broadcast + Google Maps key
const ttsRoutes = require('./routes/ttsRoutes'); // additive: server-side Text-to-Speech (Google Cloud TTS) for the parent voice assistant
const payrollRoutes = require('./routes/payrollRoutes'); // additive: staff profiles + payroll runs + payslip PDFs
const payrollTaxRoutes = require('./routes/payrollTaxRoutes'); // additive: faculty self-service, tax-aware payroll, Form-16 summary
const placementRoutes = require('./routes/placementRoutes'); // additive: job postings/applications + alumni registry
const liveJobFeedRoutes = require('./routes/liveJobFeedRoutes'); // additive: real server-side-proxied live job listings (Adzuna/Arbeitnow)
const blockchainVerifyRoutes = require('./routes/blockchainVerifyRoutes'); // additive: on-chain certificate hash anchoring + public verification
const vectorDbRoutes = require('./routes/vectorDbRoutes'); // additive: embedding-backed vector DB (RAG) over chats/grades/syllabus, sits alongside rag.js
const mockInterviewRoutes = require('./routes/mockInterviewRoutes'); // additive: mock interview slot scheduling
const studentDataSyncRoutes = require('./routes/studentDataSyncRoutes'); // additive: multi-device sync for the student portal's local data blob
const pushRoutes = require('./routes/pushRoutes'); // additive: FCM device-token registration + delivery status/test
const inventoryRoutes = require('./routes/inventoryRoutes'); // additive: asset/stock inventory + issue-return
const canteenRoutes = require('./routes/canteenRoutes'); // additive: canteen menu + orders
const examCellRoutes = require('./routes/examCellRoutes'); // additive: exam scheduling, seating, invigilation, results, revaluation
const admissionInterviewRoutes = require('./routes/admissionInterviewRoutes'); // additive: admissions panel interview scheduling + feedback
const securityRoutes = require('./routes/securityRoutes'); // additive: visitor QR passes/check-in, CCTV registry, parking
const maintenanceAssetRoutes = require('./routes/maintenanceAssetRoutes'); // additive: fixed-asset register + depreciation, work orders

// New in this pass: filling out the remaining student-portal feature list
// (profile, skills/roadmap, syllabus+exam ICS, holidays ICS, document
// services + medical letter, backlog manager, attendance deficit/PDF/
// recovery, grade engine (batch comparison + risk), reward store, goals +
// mood wellness, personal job tracker, cover letter, AI study
// summarizer/diagram, meetings, timetable CSV export). Same additive
// contract as everything above — new files, new mounts only, nothing
// existing changed.
const studentProfileRoutes = require('./routes/studentProfileRoutes'); // additive: bio, social links, avatar, theme/lang/accessibility
const createSkillsRouter = require('./routes/skillsRoutes'); // additive: technical/soft skills, radar data, AI roadmap
const syllabusRoutes = require('./routes/syllabusRoutes'); // additive: syllabus docs + exam schedule with ICS export
const holidayRoutes = require('./routes/holidayRoutes'); // additive: holiday calendar + ICS export
const createDocumentServiceRouter = require('./routes/documentServiceRoutes'); // additive: document requests w/ SLA + AI medical letter
const createI18nRouter = require('./routes/i18nRoutes'); // additive: multilingual support for every portal — languages, per-user preference, translate, UI strings
const backlogRoutes = require('./routes/backlogRoutes'); // additive: backlog (arrear) manager
const createAttendanceToolsRouter = require('./routes/attendanceToolsRoutes'); // additive: deficit calculator, PDF report, AI recovery plan
const gradeEngineRoutes = require('./routes/gradeEngineRoutes'); // additive: batch comparison + risk assessment
const rewardStoreRoutes = require('./routes/rewardStoreRoutes'); // additive: reward catalog + redeem via points ledger
const wellnessRoutes = require('./routes/wellnessRoutes'); // additive: goals with progress bars + mood check-ins
const jobTrackerRoutes = require('./routes/jobTrackerRoutes'); // additive: personal job application tracker
const createCareerPrepRouter = require('./routes/careerPrepRoutes'); // additive: AI cover letter generator
const createStudyToolRouter = require('./routes/studyToolRoutes'); // additive: AI summarizer + Mermaid diagram
const meetingRoutes = require('./routes/meetingRoutes'); // additive: meeting requests w/ suggest-slot/confirm/decline
const timetableCsvRoutes = require('./routes/timetableCsvRoutes'); // additive: CSV export for timetable views

// New in this pass: Student Portal-only additions. Personal planner
// (to-do list), personal notes/bookmarks, a daily study-streak tracker,
// and a single aggregated dashboard endpoint that reads across existing
// modules (attendance, assignments, quizzes, library, fees, academics,
// notifications, gamification, events) without changing any of them.
// Every route below is locked to role 'student' and to the caller's own
// records — no other portal is touched in this pass.
const studentTaskRoutes = require('./routes/studentTaskRoutes'); // additive: personal to-do/planner items
const studentNoteRoutes = require('./routes/studentNoteRoutes'); // additive: personal notes & bookmarks
const studentStreakRoutes = require('./routes/studentStreakRoutes'); // additive: daily check-in / study streak
const studentDashboardRoutes = require('./routes/studentDashboardRoutes'); // additive: one-call dashboard summary

// New in this pass: Faculty Portal-only additions. Personal planner
// (to-do list), private notes (lesson prep / per-student remarks), a
// read-only gradebook analytics rollup across the faculty member's own
// assignments and quizzes, and a single aggregated dashboard endpoint.
// Every route below is locked to role 'faculty' and to the caller's own
// records — no other portal is touched in this pass.
const facultyTaskRoutes = require('./routes/facultyTaskRoutes'); // additive: personal to-do/planner items
const facultyNoteRoutes = require('./routes/facultyNoteRoutes'); // additive: private lesson/student notes
const facultyGradebookRoutes = require('./routes/facultyGradebookRoutes'); // additive: read-only grading analytics
const facultyDashboardRoutes = require('./routes/facultyDashboardRoutes'); // additive: one-call dashboard summary
const facultyStudentProfileRoutes = require('./routes/facultyStudentProfileRoutes'); // additive: full read-only student profile for faculty
const facultyClassAnalyticsRoutes = require('./routes/facultyClassAnalyticsRoutes'); // additive: class analytics dashboard for faculty

// New in this pass: Parent Portal-only additions. Verified multi-child
// linking (layered on top of the existing linked_student_id column —
// that field and every route that already reads it are untouched),
// personal reminders, and a read-only dashboard (all-children overview
// + per-child detail). Every route below is locked to role 'parent' and
// to children the parent is actually authorized to see — no other
// portal is touched in this pass.
const parentChildRoutes = require('./routes/parentChildRoutes'); // additive: request/approve parent<->child links
const parentNoteRoutes = require('./routes/parentNoteRoutes'); // additive: personal reminders
const parentDashboardRoutes = require('./routes/parentDashboardRoutes'); // additive: children overview + per-child detail
const parentWellnessRoutes = require('./routes/parentWellnessRoutes'); // additive: wellness & mental health alerts for parents
const paymentGatewayRoutes = require('./routes/paymentGatewayRoutes'); // additive: demo UPI/Card payment gateway

// New in this pass: Admin Portal-only additions. A unified pending-
// approvals inbox (reads across the leave/certificate/admission/
// parent-link workflows that already exist — reviewing still happens
// through each item's own existing route), a platform-wide KPI
// dashboard, a broadcast endpoint that pairs the existing announcements
// table with a real-time push, and a read route for the audit log that
// was already being written to but never queried. Every route below is
// locked to role 'admin'/'ai-admin' — no other portal is touched in
// this pass.
const adminApprovalRoutes = require('./routes/adminApprovalRoutes'); // additive: unified pending-approvals inbox
const adminDashboardRoutes = require('./routes/adminDashboardRoutes'); // additive: platform-wide KPI dashboard
const adminBroadcastRoutes = require('./routes/adminBroadcastRoutes'); // additive: announcement + real-time push
const adminAuditRoutes = require('./routes/adminAuditRoutes'); // additive: read access to the existing audit log

// New in this pass: AI-Admin Portal-only additions. Read-only AI usage/
// RAG/KB governance analytics (including a live retrieval preview that
// never calls the model), and audited oversight actions on a specific
// user's AI memory for compliance requests. Every route below is
// locked to role 'ai-admin'/'admin' — no other portal is touched in
// this pass.
const aiGovernanceRoutes = require('./routes/aiGovernanceRoutes'); // additive: AI usage/RAG/KB analytics + retrieval preview
const aiMemoryAdminRoutes = require('./routes/aiMemoryAdminRoutes'); // additive: audited per-user AI memory oversight

// AI Admin Portal — Advanced AI Suite (11 new features, additive, all
// locked to role 'ai-admin'/'admin' like the two modules above). Each
// is its own module + own table(s) + own routes file; nothing existing
// is modified.
const createInterviewLabRouter = require('./routes/interviewLabRoutes'); // additive: AI Interview Orchestrator
const createInterviewSchedulerRouter = require('./routes/interviewSchedulerRoutes'); // additive: AI Interview Scheduler for placement drives (job_applications -> interview invites)
const createPlacementAutopilotRouter = require('./routes/placementAutopilotRoutes'); // additive: AI Placement Cell Auto-Pilot (simulated apply)
const createCodeReviewerRouter = require('./routes/codeReviewerRoutes'); // additive: AI Code Reviewer & Project Grader
const createCareerSimulatorRouter = require('./routes/careerSimulatorRoutes'); // additive: AI Career Path Monte Carlo Simulator
const createCurriculumMapperRouter = require('./routes/curriculumMapperRoutes'); // additive: AI Syllabus Compliance & Curriculum Mapper
const createIntegrityDashboardRouter = require('./routes/integrityDashboardRoutes'); // additive: AI Academic Integrity & Proctoring Dashboard
const createExamDifficultyRouter = require('./routes/examDifficultyRoutes'); // additive: AI Exam Paper Difficulty Analyzer
const createParentMeetingSummarizerRouter = require('./routes/parentMeetingSummarizerRoutes'); // additive: AI Auto-Parent Meeting Summarizer
const createGrantFinderRouter = require('./routes/grantFinderRoutes'); // additive: AI Faculty Research Grant & Collab Finder
const createSentimentHeatmapRouter = require('./routes/sentimentHeatmapRoutes'); // additive: AI Campus Sentiment Heatmap (Live)
const createAchievementRecommenderRouter = require('./routes/achievementRecommenderRoutes'); // additive: AI Auto-Achievement & Award Recommender
const createClassroomSentimentRouter = require('./routes/classroomSentimentRoutes'); // additive: real Live Classroom Sentiment Analysis (WebRTC + face-api.js, aggregated server-side)
const lmsIntegrationRoutes = require('./routes/lmsIntegrationRoutes'); // additive: real LMS Integration (Canvas OAuth2 + Moodle Web Services)

const ws = require('./ws');
const scheduler = require('./scheduler');

const PORT = Number(process.env.PORT || 4111);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const AI_API_TOKEN = process.env.AI_API_TOKEN || '';
const MAX_TOKENS_CAP = Number(process.env.MAX_TOKENS_CAP || 2000);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
const VALID_ROLES = new Set(['student', 'faculty', 'parent', 'admin', 'ai-admin']);

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy — needed for express-rate-limit to read X-Forwarded-For correctly
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Every AI phase in the app funnels through /api/ai/*, so one limiter covers all of them.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many AI requests — please slow down and try again shortly.' },
});

function checkAuth(req, res) {
  if (!AI_API_TOKEN) return true; // auth disabled for local/dev use
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token && token === AI_API_TOKEN) return true;
  res.status(401).json({ ok: false, error: 'Unauthorized — missing or invalid bearer token' });
  return false;
}

function normalizeRole(rawRole, headerRole) {
  const candidate = String(rawRole || headerRole || 'student').toLowerCase();
  return VALID_ROLES.has(candidate) ? candidate : 'student';
}

function extractLatestQuery(body) {
  if (body.query && String(body.query).trim()) return String(body.query).trim();
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m?.role === 'user');
  return lastUser?.content ? String(lastUser.content) : '';
}

// ---------------------------------------------------------------------------
// Health & status — lets the AI Admin portal (or curl) confirm the backend
// is alive and correctly configured without spending a model call.
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    ok: true,
    model: ANTHROPIC_MODEL,
    hasApiKey: Boolean(ANTHROPIC_API_KEY),
    authRequired: Boolean(AI_API_TOKEN),
    rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
    roles: [...VALID_ROLES],
    features: {
      database: true, accounts: true, rag: 'tf-idf', memory: true, resumeBuilder: true,
      timetable: true, assignments: true, quizzes: true, aiQuizDrafting: true,
      library: true, events: true, messaging: true, forum: true, gamification: true,
      uploads: true, settings: true, search: true, reports: true,
      realtime: true, studyPlanner: true, academics: true,
      leaveManagement: true, feeReceipts: true, certificates: true,
      studentTasks: true, studentNotes: true, studentStreak: true, studentDashboard: true,
      facultyTasks: true, facultyNotes: true, facultyGradebook: true, facultyDashboard: true,
      parentChildLinks: true, parentReminders: true, parentDashboard: true,
      adminApprovals: true, adminDashboard: true, adminBroadcast: true, adminAudit: true,
      aiGovernance: true, aiMemoryAdmin: true,
      interviewLab: true, placementAutopilot: true, codeReviewer: true, careerSimulator: true,
      curriculumMapper: true, integrityDashboard: true, examDifficultyAnalyzer: true,
      parentMeetingSummarizer: true, grantFinder: true, sentimentHeatmap: true, achievementRecommender: true,
      liveClassroomSentiment: true, lmsIntegration: true,
    },
  });
});

// ---------------------------------------------------------------------------
// The one endpoint that powers every AI phase across all five portals:
// student, faculty, parent, admin, ai-admin. The frontend's
// callBackendAiBridge() posts here first for every callClaude() call in the
// app (chat, insights, predictions, roadmaps, resumes, presentations, exam
// generation, translation, etc.) before ever touching a client-side key.
// ---------------------------------------------------------------------------
app.post('/api/ai/instant', aiLimiter, attachUserIfPresent, async (req, res) => {
  if (!checkAuth(req, res)) return;

  try {
    const body = req.body || {};
    const role = normalizeRole(body.role, req.get('x-edu-role'));
    const query = extractLatestQuery(body);

    if (!query) {
      return res.status(400).json({ ok: false, error: 'Request must include a non-empty "query" or "messages".' });
    }

    const messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
          .map((m) => ({ role: m.role, content: String(m.content) }))
      : [{ role: 'user', content: query }];

    const realUserName = req.user?.name || (body.userName ? String(body.userName).trim() : '');
    let system = getRolePrompt(role);
    if (realUserName) {
      system += `\n\nIMPORTANT: The user's real name is "${realUserName}". Always address them by this exact name — never use a placeholder or any other name.`;
    }
    if (body.useRag !== false) {
      const topK = Math.max(1, Math.min(8, Number(body.ragTopK) || 4));
      const snippets = retrieve(role, query, topK);
      if (snippets.length) {
        system += `\n\nRelevant platform context (use only if helpful, do not contradict the user's actual data):\n- ${snippets.join('\n- ')}`;
      }
    }

    // Long-term memory: only kicks in for logged-in users (req.user set by
    // attachUserIfPresent via a JWT from /api/auth/login). Anonymous callers
    // behave exactly as before — fully backward compatible.
    if (body.useMemory !== false && req.user) {
      system += memory.formatContextForPrompt(req.user.id, role);
    }

    const maxTokens = Math.min(MAX_TOKENS_CAP, Number(body.maxTokens) || 1500);

    const text = await callAnthropic({
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
      system,
      messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
      maxTokens,
      timeoutMs: body.timeoutMs,
    });

    if (req.user) {
      memory.saveTurn(req.user.id, role, query, text);
    }

    return res.json({ ok: true, text, model: ANTHROPIC_MODEL, role, remembered: Boolean(req.user) });
  } catch (error) {
    const status = error instanceof UpstreamAIError ? error.status : 500;
    console.error('[POST /api/ai/instant]', error?.message || error);
    return res.status(status).json({ ok: false, error: error?.message || 'AI backend request failed' });
  }
});

// ---------------------------------------------------------------------------
// New, additive route groups: real accounts + JWT auth, and real
// database-backed data for every portal (attendance, grades, fees,
// notifications, announcements, admin overview, RAG knowledge management).
// None of this changes the routes above — it's all new surface area the
// frontend can adopt portal-by-portal without breaking existing localStorage
// behavior.
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api', dataRoutes);
app.use('/api/resume', createResumeRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));

// ---------------------------------------------------------------------------
// New, additive feature route groups (this pass): timetable, assignments,
// quizzes (with optional AI-drafted questions), library, events/calendar,
// direct messaging, discussion forum, gamification, file uploads, platform
// settings, unified search, and CSV reports. All independently mounted —
// none of them touch or reorder the routes registered above.
// ---------------------------------------------------------------------------
app.use('/api/timetable', timetableRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/quiz', createQuizRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/library', libraryRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/study-plan', createStudyPlanRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/academics', academicsRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/fees', feeReceiptRoutes); // adds /:id/receipt.pdf alongside the existing /api/fees routes in dataRoutes.js
app.use('/api/certificates', certificateRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/hostel', hostelRoutes);
app.use('/api/hostel-mess', hostelMessRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/transport', busTrackingRoutes);
app.use('/api/transport', busTrackingLiveRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/payroll', payrollTaxRoutes);
app.use('/api/placements', placementRoutes);
app.use('/api/placements/mock-interviews', mockInterviewRoutes);
app.use('/api/student/data-sync', studentDataSyncRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/placements/interview-scheduler', createInterviewSchedulerRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/inventory', inventoryRoutes);
app.use('/api/canteen', canteenRoutes);
app.use('/api/exam-cell', examCellRoutes);
app.use('/api/admissions/interviews', admissionInterviewRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/maintenance', maintenanceAssetRoutes);

// Student Portal-only additions (this pass) — see requires above.
app.use('/api/student/tasks', studentTaskRoutes);
app.use('/api/student/notes', studentNoteRoutes);
app.use('/api/student/streak', studentStreakRoutes);
app.use('/api/student/dashboard', studentDashboardRoutes);

// Faculty Portal-only additions (this pass) — see requires above.
app.use('/api/faculty/tasks', facultyTaskRoutes);
app.use('/api/faculty/notes', facultyNoteRoutes);
app.use('/api/faculty/gradebook', facultyGradebookRoutes);
app.use('/api/faculty/dashboard', facultyDashboardRoutes);
app.use('/api/faculty/students', facultyStudentProfileRoutes);
app.use('/api/faculty/classes', facultyClassAnalyticsRoutes);
app.use('/api/faculty/classroom-sentiment', createClassroomSentimentRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/lms', lmsIntegrationRoutes);

// Parent Portal-only additions (this pass) — see requires above.
app.use('/api/parent/children', parentChildRoutes);
app.use('/api/parent/reminders', parentNoteRoutes);
app.use('/api/parent/dashboard', parentDashboardRoutes);
app.use('/api/parent/wellness', parentWellnessRoutes);
app.use('/api/payments', paymentGatewayRoutes);

// Admin Portal-only additions (this pass) — see requires above.
app.use('/api/admin/approvals', adminApprovalRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/broadcast', adminBroadcastRoutes);
app.use('/api/admin/audit', adminAuditRoutes);

// AI-Admin Portal-only additions (this pass) — see requires above.
app.use('/api/ai-admin/governance', aiGovernanceRoutes);
app.use('/api/ai-admin/memory', aiMemoryAdminRoutes);

// AI Admin Portal — Advanced AI Suite (this pass) — see requires above.
app.use('/api/ai-admin/interview-lab', createInterviewLabRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/placement-autopilot', createPlacementAutopilotRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/code-reviewer', createCodeReviewerRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/career-simulator', createCareerSimulatorRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/curriculum-mapper', createCurriculumMapperRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/integrity', createIntegrityDashboardRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/exam-difficulty', createExamDifficultyRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/parent-meeting-summarizer', createParentMeetingSummarizerRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/grant-finder', createGrantFinderRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/sentiment-heatmap', createSentimentHeatmapRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/ai-admin/award-recommender', createAchievementRecommenderRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));

// AI Admin Portal — Job Center live feed + certificate blockchain verification (this pass) — see requires above.
app.use('/api/ai-admin/live-job-feed', liveJobFeedRoutes);
app.use('/api/ai-admin/blockchain-verify', blockchainVerifyRoutes.adminRouter);
app.use('/api/verify/certificate', blockchainVerifyRoutes.publicRouter); // public: no auth, anyone can verify a certificate
app.use('/api/ai-admin/vector-db', vectorDbRoutes);

app.use('/api/student/profile', studentProfileRoutes);
app.use('/api/student/skills', createSkillsRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/document-services', createDocumentServiceRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/i18n', createI18nRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL })); // multilingual — every portal, any authenticated role
app.use('/api/student/backlog', backlogRoutes);
app.use('/api/attendance-tools', createAttendanceToolsRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/grade-engine', gradeEngineRoutes);
app.use('/api/rewards', rewardStoreRoutes);
app.use('/api/student/wellness', wellnessRoutes);
app.use('/api/student/job-tracker', jobTrackerRoutes);
app.use('/api/career-prep', createCareerPrepRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/study-tool', createStudyToolRouter({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }));
app.use('/api/meetings', meetingRoutes);
app.use('/api/timetable-export', timetableCsvRoutes);

// ---------------------------------------------------------------------------
// Serve the frontend from the same origin as the API — no CORS headaches,
// and it lines up with the default backendBridge.url of
// http://localhost:4111/api/ai/instant baked into the frontend.
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ---------------------------------------------------------------------------
// New in this pass: real HTTP server handle (needed so the WebSocket
// server can attach to the same port — `app.listen()` returns this same
// handle, so nothing about how the app boots changes), a background
// scheduler for overdue-library reminders, and an export of `app` so an
// automated test suite can drive requests without binding a real port.
// The server only actually starts listening when this file is run
// directly (`node src/server.js` / `npm start`), exactly as before —
// `require('./server')` from a test file does NOT open a port.
// ---------------------------------------------------------------------------
function start() {
  const httpServer = app.listen(PORT, () => {
    console.log(`EduAI backend listening on http://localhost:${PORT}`);
    console.log(`  Frontend:        http://localhost:${PORT}/`);
    console.log(`  AI endpoint:     POST http://localhost:${PORT}/api/ai/instant`);
    console.log(`  WebSocket:       ws://localhost:${PORT}/ws?token=<jwt>`);
    console.log(`  Gemini key:      ${process.env.GEMINI_API_KEY ? 'configured (used first)' : 'not set'}`);
    console.log(`  Anthropic key:   ${ANTHROPIC_API_KEY ? 'configured' + (process.env.GEMINI_API_KEY ? ' (fallback)' : '') : 'MISSING — set ANTHROPIC_API_KEY in .env'}`);
    console.log(`  Model:           ${ANTHROPIC_MODEL}${process.env.GEMINI_API_KEY ? ` / Gemini: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}` : ''}`);
    console.log(`  Database:        ${require('./db').DB_PATH}`);
    console.log(`  Auth:            POST /api/auth/register, /api/auth/login`);
  });
  const wss = ws.attach(httpServer);
  scheduler.start();
  // ws does not auto-close its WebSocketServer when the underlying HTTP
  // server closes (it only stops accepting new upgrades) — without this,
  // an open heartbeat interval + tracked sockets keep the Node process
  // alive after httpServer.close(), which matters for tests and graceful
  // shutdowns alike.
  httpServer.on('close', () => wss.close());
  return httpServer;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
