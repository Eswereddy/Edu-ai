// Faculty "Class Analytics Dashboard" — per-class-section, read-only
// roll-up combining attendance, grades, and the existing
// facultyGradebook assignment/quiz stats for the students in that
// class. Fully additive: no new tables, no writes. The class roster is
// derived from who has actually submitted work for that class section
// (assignment submissions + quiz attempts) since there is no separate
// class-roster table in the schema — this mirrors how facultyGradebook.js
// and assignments.js already scope data by class_section.

const { db } = require('./db');
const timetable = require('./timetable');
const assignments = require('./assignments');
const quiz = require('./quiz');
const gradebook = require('./facultyGradebook');

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Every class_section + subject combo this faculty member is connected
// to, via their timetable slots, the assignments they've posted, or the
// quizzes they've created.
function myClasses(facultyId) {
  const combos = new Map();

  const byDay = timetable.listForFaculty(facultyId);
  for (const day of Object.values(byDay)) {
    for (const slot of day) {
      const key = `${slot.class_section}::${slot.subject}`;
      if (!combos.has(key)) combos.set(key, { classSection: slot.class_section, subject: slot.subject });
    }
  }
  for (const a of assignments.listForFaculty(facultyId)) {
    const key = `${a.class_section}::${a.subject}`;
    if (!combos.has(key)) combos.set(key, { classSection: a.class_section, subject: a.subject });
  }
  for (const q of quiz.listForCreator(facultyId)) {
    const key = `${q.class_section}::${q.subject}`;
    if (!combos.has(key)) combos.set(key, { classSection: q.class_section, subject: q.subject });
  }
  return [...combos.values()].sort((x, y) => x.classSection.localeCompare(y.classSection));
}

function distinctSections(facultyId) {
  return [...new Set(myClasses(facultyId).map((c) => c.classSection))].sort();
}

// Roster for a class section = students who have submitted an
// assignment or attempted a quiz for that section (a real-world proxy
// for enrollment given the current schema has no explicit roster table).
function rosterForSection(classSection) {
  const ids = new Set();
  db.prepare(
    `SELECT DISTINCT s.student_id FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id WHERE a.class_section = ?`
  )
    .all(classSection)
    .forEach((r) => ids.add(r.student_id));
  db.prepare(
    `SELECT DISTINCT qa.student_id FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id WHERE q.class_section = ? AND qa.submitted_at IS NOT NULL`
  )
    .all(classSection)
    .forEach((r) => ids.add(r.student_id));
  if (!ids.size) return [];
  const placeholders = [...ids].map(() => '?').join(',');
  return db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) ORDER BY name`).all(...ids);
}

function attendanceForRoster(roster, subject) {
  if (!roster.length) return { avgPercent: null, perStudent: [] };
  const perStudent = roster.map((student) => {
    const rows = subject
      ? db.prepare('SELECT status FROM attendance WHERE student_id = ? AND subject = ?').all(student.id, subject)
      : db.prepare('SELECT status FROM attendance WHERE student_id = ?').all(student.id);
    const present = rows.filter((r) => r.status === 'present').length;
    const percent = rows.length ? round1((present / rows.length) * 100) : null;
    return { studentId: student.id, name: student.name, percent, totalRecords: rows.length };
  });
  const withData = perStudent.filter((p) => p.percent != null);
  const avgPercent = withData.length ? round1(withData.reduce((s, p) => s + p.percent, 0) / withData.length) : null;
  return { avgPercent, perStudent };
}

function classAnalytics(facultyId, classSection, { subject } = {}) {
  const known = distinctSections(facultyId);
  if (!known.includes(classSection)) {
    const err = new Error('You do not teach this class section');
    err.status = 403;
    throw err;
  }
  const roster = rosterForSection(classSection);
  const attendance = attendanceForRoster(roster, subject);
  const gb = gradebook.overview(facultyId, { classSection, subject });

  return {
    generatedAt: new Date().toISOString(),
    classSection,
    subject: subject || null,
    studentCount: roster.length,
    roster,
    attendance,
    assignments: gb.assignments,
    quizzes: gb.quizzes,
  };
}

module.exports = { myClasses, distinctSections, rosterForSection, classAnalytics };
