// Document Services: general document requests (transcript copy, ID
// reissue, NOC, etc.) with an SLA due date, plus an AI medical-letter
// generator. Distinct from certificates.js (bonafide/study/character
// certs, untouched) — this covers the broader "document services desk".
// Fully additive — own tables, own file.

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS document_service_requests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','ready','rejected')),
  sla_hours INTEGER NOT NULL DEFAULT 72,
  due_at TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doc_requests_student ON document_service_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_doc_requests_status ON document_service_requests(status);

CREATE TABLE IF NOT EXISTS medical_letters (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  content TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() {
  return crypto.randomUUID();
}

const SLA_HOURS = { transcript_copy: 48, id_card_reissue: 72, noc: 96, address_proof: 48, other: 72 };

function createRequest({ studentId, docType, details }) {
  if (!studentId || !docType) throw Object.assign(new Error('studentId and docType are required'), { status: 400 });
  const slaHours = SLA_HOURS[docType] || SLA_HOURS.other;
  const dueAt = new Date(Date.now() + slaHours * 3600 * 1000).toISOString();
  const id = uid();
  db.prepare(
    `INSERT INTO document_service_requests (id, student_id, doc_type, details, sla_hours, due_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, docType, details || null, slaHours, dueAt);
  return getRequest(id);
}

function getRequest(id) {
  const row = db.prepare('SELECT * FROM document_service_requests WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, overdue: row.status !== 'ready' && row.status !== 'rejected' && new Date(row.due_at) < new Date() };
}

function listForStudent(studentId) {
  return db.prepare('SELECT * FROM document_service_requests WHERE student_id = ? ORDER BY created_at DESC').all(studentId)
    .map((row) => ({ ...row, overdue: row.status !== 'ready' && row.status !== 'rejected' && new Date(row.due_at) < new Date() }));
}

function listAll({ status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM document_service_requests WHERE status = ? ORDER BY due_at ASC').all(status)
    : db.prepare('SELECT * FROM document_service_requests ORDER BY due_at ASC').all();
  return rows.map((row) => ({ ...row, overdue: row.status !== 'ready' && row.status !== 'rejected' && new Date(row.due_at) < new Date() }));
}

function updateStatus(id, { status, reviewedBy, reviewNote }) {
  if (!['pending', 'in_progress', 'ready', 'rejected'].includes(status)) {
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  }
  const row = db.prepare('SELECT id FROM document_service_requests WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare(
    `UPDATE document_service_requests SET status = ?, reviewed_by = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, reviewedBy || null, reviewNote || null, id);
  return getRequest(id);
}

// -------------------------------------------------------- Medical letter
async function generateMedicalLetter({ apiKey, model, studentId, studentName, reason, fromDate, toDate }) {
  if (!reason || !fromDate || !toDate) {
    throw Object.assign(new Error('reason, fromDate and toDate are required'), { status: 400 });
  }
  let content;
  let aiGenerated = false;
  try {
    content = await callAnthropic({
      apiKey,
      model,
      system: 'You draft short, formal medical-leave letters for a college document-services desk. Plain text only, no markdown. Keep it under 180 words, formal tone, addressed "To Whom It May Concern", include the student name, dates, and reason, and a closing line inviting the recipient to contact the office for verification.',
      messages: [{ role: 'user', content: `Student: ${studentName || 'the student'}\nReason: ${reason}\nFrom: ${fromDate}\nTo: ${toDate}` }],
      temperature: 0.3,
      maxTokens: 400,
    });
    aiGenerated = true;
  } catch (e) {
    content = `To Whom It May Concern,\n\nThis is to certify that ${studentName || 'the student'} was unable to attend classes from ${fromDate} to ${toDate} due to ${reason}. We request that this absence be excused accordingly.\n\nPlease contact the college document services office for verification.\n\nSincerely,\nDocument Services Office`;
  }

  const id = uid();
  db.prepare(
    `INSERT INTO medical_letters (id, student_id, reason, from_date, to_date, content, ai_generated) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, reason, fromDate, toDate, content, aiGenerated ? 1 : 0);
  return { id, studentId, reason, fromDate, toDate, content, aiGenerated };
}

function getMedicalLetter(id, studentId) {
  return db.prepare('SELECT * FROM medical_letters WHERE id = ? AND student_id = ?').get(id, studentId) || null;
}

function medicalLetterPdf(letter) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(16).text('EduAI College — Document Services', { align: 'center' });
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(11).text(letter.content, { align: 'left', lineGap: 4 });
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#777777').text(
      letter.ai_generated ? 'Drafted with AI assistance; not a substitute for an official medical certificate.' : 'Template letter; not a substitute for an official medical certificate.'
    );
    doc.end();
  });
}

module.exports = {
  createRequest, getRequest, listForStudent, listAll, updateStatus,
  generateMedicalLetter, getMedicalLetter, medicalLetterPdf, SLA_HOURS,
};
