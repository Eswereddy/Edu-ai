// Placements & Alumni: job/internship postings with a student application
// pipeline, plus an alumni registry. Additive — new tables only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT,
  package_lpa REAL,
  eligibility TEXT,
  drive_date TEXT,
  posted_by TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_postings(id),
  student_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','shortlisted','selected','rejected')),
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_job_apps_student ON job_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_job_apps_job ON job_applications(job_id);

CREATE TABLE IF NOT EXISTS alumni (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  graduation_year INTEGER,
  company TEXT,
  designation TEXT,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() {
  return crypto.randomUUID();
}

function postJob({ title, company, description, packageLpa, eligibility, driveDate, postedBy }) {
  if (!title || !company) throw Object.assign(new Error('title and company are required'), { status: 400 });
  const id = uid();
  db.prepare(
    `INSERT INTO job_postings (id, title, company, description, package_lpa, eligibility, drive_date, posted_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, title, company, description || null, packageLpa != null ? Number(packageLpa) : null, eligibility || null, driveDate || null, postedBy || null);
  return db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id);
}

function listJobs({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM job_postings WHERE status = ? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM job_postings ORDER BY created_at DESC').all();
}

function getJob(id) {
  return db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id) || null;
}

function closeJob(id) {
  const job = getJob(id);
  if (!job) throw Object.assign(new Error('Job posting not found'), { status: 404 });
  db.prepare(`UPDATE job_postings SET status = 'closed' WHERE id = ?`).run(id);
  return getJob(id);
}

function applyToJob({ jobId, studentId }) {
  const job = getJob(jobId);
  if (!job) throw Object.assign(new Error('Job posting not found'), { status: 404 });
  if (job.status !== 'open') throw Object.assign(new Error('This posting is closed'), { status: 409 });
  const existing = db.prepare('SELECT * FROM job_applications WHERE job_id = ? AND student_id = ?').get(jobId, studentId);
  if (existing) throw Object.assign(new Error('You have already applied to this posting'), { status: 409 });
  const id = uid();
  db.prepare('INSERT INTO job_applications (id, job_id, student_id) VALUES (?,?,?)').run(id, jobId, studentId);
  return db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id);
}

function listApplicationsForJob(jobId) {
  return db.prepare('SELECT * FROM job_applications WHERE job_id = ? ORDER BY applied_at DESC').all(jobId);
}

function myApplications(studentId) {
  return db.prepare(
    `SELECT ja.*, jp.title, jp.company FROM job_applications ja
     JOIN job_postings jp ON jp.id = ja.job_id WHERE ja.student_id = ? ORDER BY ja.applied_at DESC`
  ).all(studentId);
}

function updateApplicationStatus(id, status) {
  if (!['applied', 'shortlisted', 'selected', 'rejected'].includes(status)) {
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  }
  const row = db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Application not found'), { status: 404 });
  db.prepare(`UPDATE job_applications SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id);
}

function registerAlumni({ userId, graduationYear, company, designation, bio }) {
  if (!userId) throw Object.assign(new Error('userId is required'), { status: 400 });
  const existing = db.prepare('SELECT * FROM alumni WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(
      'UPDATE alumni SET graduation_year = ?, company = ?, designation = ?, bio = ? WHERE user_id = ?'
    ).run(graduationYear ?? existing.graduation_year, company ?? existing.company, designation ?? existing.designation, bio ?? existing.bio, userId);
    return db.prepare('SELECT * FROM alumni WHERE user_id = ?').get(userId);
  }
  const id = uid();
  db.prepare(
    'INSERT INTO alumni (id, user_id, graduation_year, company, designation, bio) VALUES (?,?,?,?,?,?)'
  ).run(id, userId, graduationYear != null ? Number(graduationYear) : null, company || null, designation || null, bio || null);
  return db.prepare('SELECT * FROM alumni WHERE id = ?').get(id);
}

function listAlumni({ graduationYear, company } = {}) {
  let sql = `SELECT a.*, u.name, u.email FROM alumni a JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params = [];
  if (graduationYear) { sql += ' AND a.graduation_year = ?'; params.push(Number(graduationYear)); }
  if (company) { sql += ' AND a.company LIKE ?'; params.push(`%${company}%`); }
  sql += ' ORDER BY a.graduation_year DESC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  postJob, listJobs, getJob, closeJob, applyToJob, listApplicationsForJob,
  myApplications, updateApplicationStatus, registerAlumni, listAlumni,
};
