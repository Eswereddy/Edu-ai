// Admission Interview Scheduling: panel slots against existing
// admission_applications, plus per-panelist feedback/recommendation.
// Additive-only — new tables, own file, doesn't touch admissions.js.
//
// NOTE: distinct from mockInterviews.js, which is placement/mock-interview
// practice for students. This module schedules the *actual* admissions
// panel interview for a prospective applicant (who may not have a user
// account yet — applications only get one on approval).

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS admission_interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  panelist_id TEXT NOT NULL REFERENCES users(id),
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  mode TEXT NOT NULL DEFAULT 'in_person' CHECK(mode IN ('in_person','online')),
  location_or_link TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adm_interview_app ON admission_interviews(application_id);
CREATE INDEX IF NOT EXISTS idx_adm_interview_panelist ON admission_interviews(panelist_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_adm_interview_status ON admission_interviews(status);

CREATE TABLE IF NOT EXISTS admission_interview_feedback (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES admission_interviews(id) ON DELETE CASCADE,
  panelist_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER CHECK(rating BETWEEN 1 AND 10),
  recommendation TEXT NOT NULL CHECK(recommendation IN ('select','reject','waitlist')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(interview_id, panelist_id)
);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

const MODES = ['in_person', 'online'];
const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];
const RECOMMENDATIONS = ['select', 'reject', 'waitlist'];

function getApplication(applicationId) {
  return db.prepare('SELECT * FROM admission_applications WHERE id = ?').get(applicationId);
}

function getInterview(id) {
  return db.prepare('SELECT * FROM admission_interviews WHERE id = ?').get(id) || null;
}

function scheduleInterview({ applicationId, panelistId, scheduledAt, durationMinutes, mode, locationOrLink, createdBy }) {
  if (!applicationId) throw fail('applicationId is required');
  if (!getApplication(applicationId)) throw fail('Application not found', 404);
  if (!panelistId) throw fail('panelistId is required');
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) throw fail('scheduledAt must be a valid date/time');
  const cleanMode = MODES.includes(mode) ? mode : 'in_person';
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 30;

  const id = uid();
  db.prepare(
    `INSERT INTO admission_interviews
     (id, application_id, panelist_id, scheduled_at, duration_minutes, mode, location_or_link, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, applicationId, panelistId, scheduledAt, duration, cleanMode, locationOrLink || null, createdBy || null);

  db.prepare(`UPDATE admission_applications SET status = 'under_review' WHERE id = ? AND status = 'submitted'`)
    .run(applicationId);

  return getInterview(id);
}

function rescheduleInterview({ id, scheduledAt, durationMinutes, mode, locationOrLink }) {
  const row = getInterview(id);
  if (!row) throw fail('Interview not found', 404);
  if (row.status !== 'scheduled') throw fail(`Cannot reschedule an interview that is ${row.status}`, 409);
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) throw fail('scheduledAt must be a valid date/time');
  const cleanMode = MODES.includes(mode) ? mode : row.mode;
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : row.duration_minutes;

  db.prepare(
    `UPDATE admission_interviews SET scheduled_at = ?, duration_minutes = ?, mode = ?, location_or_link = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(scheduledAt, duration, cleanMode, locationOrLink != null ? locationOrLink : row.location_or_link, id);
  return getInterview(id);
}

function cancelInterview(id) {
  const row = getInterview(id);
  if (!row) throw fail('Interview not found', 404);
  if (row.status !== 'scheduled') throw fail(`Cannot cancel an interview that is ${row.status}`, 409);
  db.prepare(`UPDATE admission_interviews SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getInterview(id);
}

function markStatus({ id, status }) {
  const row = getInterview(id);
  if (!row) throw fail('Interview not found', 404);
  if (!STATUSES.includes(status)) throw fail(`status must be one of ${STATUSES.join(', ')}`);
  if (row.status !== 'scheduled') throw fail(`Interview is already ${row.status}`, 409);
  db.prepare(`UPDATE admission_interviews SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return getInterview(id);
}

function submitFeedback({ interviewId, panelistId, rating, recommendation, notes }) {
  const row = getInterview(interviewId);
  if (!row) throw fail('Interview not found', 404);
  if (row.panelist_id !== panelistId) throw fail('Only the assigned panelist can submit feedback for this interview', 403);
  if (!RECOMMENDATIONS.includes(recommendation)) throw fail(`recommendation must be one of ${RECOMMENDATIONS.join(', ')}`);
  if (rating != null && (Number(rating) < 1 || Number(rating) > 10)) throw fail('rating must be between 1 and 10');

  const id = uid();
  try {
    db.prepare(
      `INSERT INTO admission_interview_feedback (id, interview_id, panelist_id, rating, recommendation, notes)
       VALUES (?,?,?,?,?,?)`
    ).run(id, interviewId, panelistId, rating != null ? Number(rating) : null, recommendation, notes || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw fail('Feedback for this interview has already been submitted', 409);
    throw e;
  }

  if (row.status === 'scheduled') {
    db.prepare(`UPDATE admission_interviews SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(interviewId);
  }
  return db.prepare('SELECT * FROM admission_interview_feedback WHERE id = ?').get(id);
}

function getFeedback(interviewId) {
  return db.prepare('SELECT * FROM admission_interview_feedback WHERE interview_id = ?').all(interviewId);
}

function listInterviews({ applicationId, panelistId, status } = {}) {
  let sql = `SELECT ai.*, a.applicant_name, a.course_applied FROM admission_interviews ai
             JOIN admission_applications a ON a.id = ai.application_id WHERE 1=1`;
  const params = [];
  if (applicationId) { sql += ' AND ai.application_id = ?'; params.push(applicationId); }
  if (panelistId) { sql += ' AND ai.panelist_id = ?'; params.push(panelistId); }
  if (status) { sql += ' AND ai.status = ?'; params.push(status); }
  sql += ' ORDER BY ai.scheduled_at';
  return db.prepare(sql).all(...params);
}

function myInterviews(panelistId) {
  return listInterviews({ panelistId });
}

module.exports = {
  MODES, STATUSES, RECOMMENDATIONS,
  scheduleInterview, rescheduleInterview, cancelInterview, markStatus,
  submitFeedback, getFeedback,
  getInterview, listInterviews, myInterviews, getApplication,
};
