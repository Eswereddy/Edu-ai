// AI Interview Scheduler for the Placement Cell — lets admin/faculty
// generate an interview invitation (AI-drafted message, gracefully
// degrading to a template if no API key is configured) for a student's
// job application, send it, and track status through to completion.
// Distinct from mockInterviews.js (student self-practice booking),
// interviewLab.js (AI-Admin mock Q&A orchestrator), and
// admissionInterviews.js (admissions-panel interviews) — this one is
// scoped to real placement-drive interviews tied to job_applications.
// Fully additive — new table only, reuses job_applications/job_postings.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS placement_interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id),
  job_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  scheduled_at TEXT,
  mode TEXT NOT NULL DEFAULT 'online' CHECK(mode IN ('online','offline')),
  location TEXT,
  invite_message TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','confirmed','declined','completed','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_student ON placement_interviews(student_id);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_job ON placement_interviews(job_id);
CREATE INDEX IF NOT EXISTS idx_placement_interviews_app ON placement_interviews(application_id);
`);

function uid() { return crypto.randomUUID(); }

function getApplicationContext(applicationId) {
  return db.prepare(`
    SELECT ja.id AS application_id, ja.job_id, ja.student_id, ja.status AS application_status,
           jp.title AS job_title, jp.company, u.name AS student_name
    FROM job_applications ja
    JOIN job_postings jp ON jp.id = ja.job_id
    LEFT JOIN users u ON u.id = ja.student_id
    WHERE ja.id = ?
  `).get(applicationId);
}

const SELECT_WITH_JOIN = `
  SELECT pi.*, jp.title AS job_title, jp.company, u.name AS student_name
  FROM placement_interviews pi
  JOIN job_postings jp ON jp.id = pi.job_id
  LEFT JOIN users u ON u.id = pi.student_id
`;

function getInterview(id) {
  return db.prepare(`${SELECT_WITH_JOIN} WHERE pi.id = ?`).get(id) || null;
}

async function draftInviteMessage({ apiKey, model, studentName, jobTitle, company, scheduledAt, mode, location }) {
  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'You are the placement cell assistant drafting a short, warm, professional interview invitation email to a student. Return JSON: {"message":"the full email body, 80-150 words, ready to send, no subject line"}.',
    prompt: `Student: ${studentName || 'Candidate'}\nRole: ${jobTitle}\nCompany: ${company}\nScheduled: ${scheduledAt || 'to be confirmed'}\nMode: ${mode}\nLocation/Link: ${location || 'to be shared'}`,
    maxTokens: 500,
  });
  if (ai.ok && ai.data && ai.data.message) return ai.data.message;
  const when = scheduledAt ? new Date(scheduledAt).toLocaleString() : 'a time we will confirm shortly';
  return `Dear ${studentName || 'Candidate'},\n\nCongratulations! You have been shortlisted for the ${jobTitle} role at ${company}. Your interview is scheduled for ${when} (${mode}${location ? `, ${location}` : ''}).\n\nPlease confirm your availability at the earliest. All the best!\n\nRegards,\nPlacement Cell`;
}

async function generateAndCreateInterview({ apiKey, model, applicationId, scheduledAt, mode = 'online', location, createdBy }) {
  const ctx = getApplicationContext(applicationId);
  if (!ctx) throw Object.assign(new Error('Application not found'), { status: 404 });
  const message = await draftInviteMessage({
    apiKey, model,
    studentName: ctx.student_name,
    jobTitle: ctx.job_title,
    company: ctx.company,
    scheduledAt, mode, location,
  });
  const id = uid();
  db.prepare(
    `INSERT INTO placement_interviews (id, application_id, job_id, student_id, scheduled_at, mode, location, invite_message, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, applicationId, ctx.job_id, ctx.student_id, scheduledAt || null, mode, location || null, message, createdBy || null);
  return getInterview(id);
}

function listInterviews({ jobId, studentId, status } = {}) {
  let sql = `${SELECT_WITH_JOIN} WHERE 1=1`;
  const params = [];
  if (jobId) { sql += ' AND pi.job_id = ?'; params.push(jobId); }
  if (studentId) { sql += ' AND pi.student_id = ?'; params.push(studentId); }
  if (status) { sql += ' AND pi.status = ?'; params.push(status); }
  sql += ' ORDER BY pi.created_at DESC';
  return db.prepare(sql).all(...params);
}

function myInterviews(studentId) {
  return listInterviews({ studentId });
}

function sendInvite(id) {
  const row = getInterview(id);
  if (!row) throw Object.assign(new Error('Interview invite not found'), { status: 404 });
  if (row.status !== 'draft') throw Object.assign(new Error('Only a draft invite can be sent'), { status: 409 });
  db.prepare(`UPDATE placement_interviews SET status = 'sent', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getInterview(id);
}

function respond(id, studentId, action) {
  if (!['confirm', 'decline'].includes(action)) throw Object.assign(new Error('Invalid action'), { status: 400 });
  const row = getInterview(id);
  if (!row) throw Object.assign(new Error('Interview invite not found'), { status: 404 });
  if (row.student_id !== studentId) throw Object.assign(new Error('Not your interview invite'), { status: 403 });
  if (row.status !== 'sent') throw Object.assign(new Error('Only a sent invite can be responded to'), { status: 409 });
  const newStatus = action === 'confirm' ? 'confirmed' : 'declined';
  db.prepare(`UPDATE placement_interviews SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, id);
  return getInterview(id);
}

function updateInterview(id, { scheduledAt, mode, location, status } = {}) {
  const row = getInterview(id);
  if (!row) throw Object.assign(new Error('Interview invite not found'), { status: 404 });
  if (status && !['draft', 'sent', 'confirmed', 'declined', 'completed', 'cancelled'].includes(status)) {
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  }
  db.prepare(
    `UPDATE placement_interviews SET
       scheduled_at = COALESCE(?, scheduled_at),
       mode = COALESCE(?, mode),
       location = COALESCE(?, location),
       status = COALESCE(?, status),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(scheduledAt ?? null, mode ?? null, location ?? null, status ?? null, id);
  return getInterview(id);
}

module.exports = {
  generateAndCreateInterview, getInterview, listInterviews, myInterviews,
  sendInvite, respond, updateInterview, getApplicationContext,
};
