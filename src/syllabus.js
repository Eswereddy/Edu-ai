// Syllabus documents (view/download, per semester+subject) and exam
// schedule entries with ICS export. Builds on the existing `semesters`
// table from academics.js (read-only reference, not modified) and the
// existing uploads module for actual files. Fully additive — own tables.

const crypto = require('crypto');
const { db } = require('./db');
const { buildIcs } = require('./icsHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS syllabus_documents (
  id TEXT PRIMARY KEY,
  semester_id TEXT,
  subject_name TEXT NOT NULL,
  title TEXT NOT NULL,
  class_section TEXT,
  upload_id TEXT,
  external_url TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_syllabus_semester ON syllabus_documents(semester_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_section ON syllabus_documents(class_section);

CREATE TABLE IF NOT EXISTS exam_schedule_entries (
  id TEXT PRIMARY KEY,
  class_section TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  start_time TEXT,
  room TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exam_schedule_section ON exam_schedule_entries(class_section);
`);

function uid() {
  return crypto.randomUUID();
}

// ------------------------------------------------------------- Syllabus
function addSyllabusDoc({ semesterId, subjectName, title, classSection, uploadId, externalUrl, uploadedBy }) {
  if (!subjectName || !title) throw Object.assign(new Error('subjectName and title are required'), { status: 400 });
  const id = uid();
  db.prepare(
    `INSERT INTO syllabus_documents (id, semester_id, subject_name, title, class_section, upload_id, external_url, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, semesterId || null, subjectName, title, classSection || null, uploadId || null, externalUrl || null, uploadedBy || null);
  return db.prepare('SELECT * FROM syllabus_documents WHERE id = ?').get(id);
}

function listSyllabusDocs({ classSection, semesterId } = {}) {
  let sql = 'SELECT * FROM syllabus_documents WHERE 1=1';
  const params = [];
  if (classSection) { sql += ' AND class_section = ?'; params.push(classSection); }
  if (semesterId) { sql += ' AND semester_id = ?'; params.push(semesterId); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function deleteSyllabusDoc(id) {
  const row = db.prepare('SELECT id FROM syllabus_documents WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare('DELETE FROM syllabus_documents WHERE id = ?').run(id);
  return { deleted: true };
}

// --------------------------------------------------------- Exam schedule
function addExamScheduleEntry({ classSection, subjectName, examDate, startTime, room, createdBy }) {
  if (!classSection || !subjectName || !examDate) {
    throw Object.assign(new Error('classSection, subjectName and examDate are required'), { status: 400 });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO exam_schedule_entries (id, class_section, subject_name, exam_date, start_time, room, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, classSection, subjectName, examDate, startTime || null, room || null, createdBy || null);
  return db.prepare('SELECT * FROM exam_schedule_entries WHERE id = ?').get(id);
}

function listExamSchedule(classSection) {
  return db
    .prepare('SELECT * FROM exam_schedule_entries WHERE class_section = ? ORDER BY exam_date ASC')
    .all(classSection);
}

function deleteExamScheduleEntry(id) {
  const row = db.prepare('SELECT id FROM exam_schedule_entries WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare('DELETE FROM exam_schedule_entries WHERE id = ?').run(id);
  return { deleted: true };
}

function examScheduleIcs(classSection) {
  const rows = listExamSchedule(classSection);
  return buildIcs(`Exam Schedule - ${classSection}`, rows.map((r) => ({
    uid: r.id,
    title: `${r.subject_name} exam`,
    date: r.exam_date,
    description: [r.start_time ? `Starts ${r.start_time}` : null, r.room ? `Room ${r.room}` : null].filter(Boolean).join(', '),
    location: r.room || undefined,
  })));
}

module.exports = {
  addSyllabusDoc, listSyllabusDocs, deleteSyllabusDoc,
  addExamScheduleEntry, listExamSchedule, deleteExamScheduleEntry, examScheduleIcs,
};
