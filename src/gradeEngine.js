// Grade Engine: batch (class-section) comparison and a simple, explainable
// academic risk assessment. Built entirely on top of the existing
// `academics.js` (semesters/results/SGPA) and `attendance` table — read
// only, no changes to either.

const { db } = require('./db');
const academics = require('./academics');

// Every student who has at least one result recorded in this semester.
function studentIdsInSemester(semesterId) {
  return db.prepare('SELECT DISTINCT student_id FROM results WHERE semester_id = ?').all(semesterId).map((r) => r.student_id);
}

function batchComparison(semesterId) {
  const studentIds = studentIdsInSemester(semesterId);
  const rows = studentIds.map((studentId) => ({ studentId, sgpa: academics.sgpaFor(studentId, semesterId) })).filter((r) => r.sgpa != null);
  if (!rows.length) return { semesterId, classAverageSgpa: null, students: [] };

  const avg = Math.round((rows.reduce((s, r) => s + r.sgpa, 0) / rows.length) * 100) / 100;
  const sorted = [...rows].sort((a, b) => b.sgpa - a.sgpa);

  const withRank = rows.map((r) => {
    const rank = sorted.findIndex((s) => s.studentId === r.studentId) + 1;
    const percentile = Math.round((1 - (rank - 1) / rows.length) * 10000) / 100;
    return { ...r, rank, percentile, aboveAverage: r.sgpa >= avg };
  });

  return { semesterId, classAverageSgpa: avg, totalStudents: rows.length, students: withRank.sort((a, b) => a.rank - b.rank) };
}

function attendancePercentFor(studentId) {
  const rows = db.prepare('SELECT status FROM attendance WHERE student_id = ?').all(studentId);
  if (!rows.length) return null;
  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length;
  return Math.round((present / rows.length) * 10000) / 100;
}

// Simple, explainable risk flags — not a predictive model. Thresholds are
// deliberately conservative and documented so a faculty member can see
// exactly why a student was flagged.
function riskAssessment(studentId, semesterId) {
  const sgpa = academics.sgpaFor(studentId, semesterId);
  const attendancePercent = attendancePercentFor(studentId);
  const flags = [];
  if (sgpa != null && sgpa < 5) flags.push({ reason: 'Low SGPA', detail: `SGPA ${sgpa} is below 5.0` });
  if (attendancePercent != null && attendancePercent < 75) flags.push({ reason: 'Low attendance', detail: `Attendance ${attendancePercent}% is below the standard 75% requirement` });

  let riskLevel = 'low';
  if (flags.length === 1) riskLevel = 'medium';
  if (flags.length >= 2) riskLevel = 'high';
  if (sgpa == null && attendancePercent == null) riskLevel = 'unknown';

  return { studentId, semesterId, sgpa, attendancePercent, riskLevel, flags };
}

function riskAssessmentForSemester(semesterId) {
  const studentIds = studentIdsInSemester(semesterId);
  return studentIds.map((studentId) => riskAssessment(studentId, semesterId)).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, unknown: 3 };
    return order[a.riskLevel] - order[b.riskLevel];
  });
}

module.exports = { batchComparison, riskAssessment, riskAssessmentForSemester, attendancePercentFor };
