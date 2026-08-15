// Admissions & Enrollment: prospective-student applications, an
// admin/faculty review queue, a seat-availability matrix per
// course/class-section, and one-click enrollment (creates a real login
// account) on approval. Fully additive — new tables only, nothing in
// db.js/auth.js changed. Reuses auth.registerUser so an approved
// applicant gets the exact same kind of account as anyone who signs up
// normally.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS admission_applications (
  id TEXT PRIMARY KEY,
  applicant_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  dob TEXT,
  gender TEXT,
  course_applied TEXT NOT NULL,
  class_section TEXT,
  previous_school TEXT,
  previous_percentage REAL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','approved','rejected','waitlisted')),
  reviewed_by TEXT,
  review_note TEXT,
  created_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admission_status ON admission_applications(status);
CREATE INDEX IF NOT EXISTS idx_admission_email ON admission_applications(email);

CREATE TABLE IF NOT EXISTS admission_seats (
  id TEXT PRIMARY KEY,
  academic_year TEXT NOT NULL,
  course TEXT NOT NULL,
  class_section TEXT NOT NULL,
  total_seats INTEGER NOT NULL,
  filled_seats INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(academic_year, course, class_section)
);
`);

function uid() {
  return crypto.randomUUID();
}

function submitApplication(data) {
  const { applicantName, email, phone, dob, gender, courseApplied, classSection, previousSchool, previousPercentage, address } = data || {};
  if (!applicantName || !email || !courseApplied) {
    throw Object.assign(new Error('applicantName, email, and courseApplied are required'), { status: 400 });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO admission_applications
     (id, applicant_name, email, phone, dob, gender, course_applied, class_section, previous_school, previous_percentage, address)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, String(applicantName).trim(), String(email).trim().toLowerCase(), phone || null, dob || null, gender || null,
    String(courseApplied).trim(), classSection || null, previousSchool || null,
    previousPercentage != null ? Number(previousPercentage) : null, address || null);
  return getById(id);
}

function getById(id) {
  return db.prepare('SELECT * FROM admission_applications WHERE id = ?').get(id) || null;
}

function listApplications({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM admission_applications WHERE status = ? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM admission_applications ORDER BY created_at DESC').all();
}

function setUnderReview(id) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Application not found'), { status: 404 });
  if (row.status !== 'submitted') return row;
  db.prepare(`UPDATE admission_applications SET status = 'under_review' WHERE id = ?`).run(id);
  return getById(id);
}

function upsertSeatMatrix({ academicYear, course, classSection, totalSeats }) {
  if (!academicYear || !course || !classSection || totalSeats == null) {
    throw Object.assign(new Error('academicYear, course, classSection, totalSeats are required'), { status: 400 });
  }
  const existing = db.prepare(
    'SELECT * FROM admission_seats WHERE academic_year = ? AND course = ? AND class_section = ?'
  ).get(academicYear, course, classSection);
  if (existing) {
    db.prepare('UPDATE admission_seats SET total_seats = ? WHERE id = ?').run(Number(totalSeats), existing.id);
    return db.prepare('SELECT * FROM admission_seats WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare(
    'INSERT INTO admission_seats (id, academic_year, course, class_section, total_seats) VALUES (?,?,?,?,?)'
  ).run(id, academicYear, course, classSection, Number(totalSeats));
  return db.prepare('SELECT * FROM admission_seats WHERE id = ?').get(id);
}

function listSeats({ academicYear } = {}) {
  if (academicYear) return db.prepare('SELECT * FROM admission_seats WHERE academic_year = ? ORDER BY course, class_section').all(academicYear);
  return db.prepare('SELECT * FROM admission_seats ORDER BY academic_year DESC, course, class_section').all();
}

function findSeatRow(course, classSection, academicYear) {
  if (academicYear) {
    return db.prepare('SELECT * FROM admission_seats WHERE course = ? AND class_section = ? AND academic_year = ?')
      .get(course, classSection, academicYear);
  }
  return db.prepare('SELECT * FROM admission_seats WHERE course = ? AND class_section = ? ORDER BY academic_year DESC').get(course, classSection);
}

/**
 * Approve (or reject/waitlist) an application. On approval: checks a
 * matching seat row (if one exists) isn't full, increments filled_seats,
 * and creates a real login account via auth.registerUser with a random
 * temporary password that's returned once so the reviewer can hand it to
 * the student (matches how every other part of this app authenticates —
 * no separate "applicant" login system to maintain).
 */
async function review(id, { status, reviewedBy, reviewNote, academicYear }) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Application not found'), { status: 404 });
  if (!['approved', 'rejected', 'waitlisted'].includes(status)) {
    throw Object.assign(new Error('status must be approved, rejected, or waitlisted'), { status: 400 });
  }
  if (row.status === 'approved' || row.status === 'rejected') {
    throw Object.assign(new Error('This application has already been finalized'), { status: 409 });
  }

  let tempPassword = null;
  let createdUserId = null;

  if (status === 'approved') {
    const seatRow = findSeatRow(row.course_applied, row.class_section, academicYear);
    if (seatRow && seatRow.filled_seats >= seatRow.total_seats) {
      throw Object.assign(new Error('No seats remaining for this course/section'), { status: 409 });
    }
    const { registerUser } = require('./auth');
    tempPassword = crypto.randomBytes(6).toString('base64url');
    const user = await registerUser({
      name: row.applicant_name,
      email: row.email,
      password: tempPassword,
      role: 'student',
    });
    createdUserId = user.id;
    if (seatRow) {
      db.prepare('UPDATE admission_seats SET filled_seats = filled_seats + 1 WHERE id = ?').run(seatRow.id);
    }
  }

  db.prepare(
    `UPDATE admission_applications
     SET status = ?, reviewed_by = ?, review_note = ?, created_user_id = ?, reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(status, reviewedBy || null, reviewNote || null, createdUserId, id);

  return { application: getById(id), tempPassword, createdUserId };
}

module.exports = {
  submitApplication, getById, listApplications, setUnderReview,
  upsertSeatMatrix, listSeats, review,
};
