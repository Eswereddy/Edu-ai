// Certificate requests: students request an official certificate
// (Bonafide, Study, Character), admin approves/rejects, and an approved
// request can be rendered as a real downloadable PDF on demand.
// Additive — new table only.

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS certificate_requests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  cert_type TEXT NOT NULL DEFAULT 'bonafide' CHECK(cert_type IN ('bonafide','study','character')),
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_student ON certificate_requests(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

const CERT_TITLES = {
  bonafide: 'Bonafide Certificate',
  study: 'Study Certificate',
  character: 'Character Certificate',
};

function requestCertificate({ studentId, certType, purpose }) {
  if (!studentId) throw Object.assign(new Error('studentId is required'), { status: 400 });
  const type = certType && CERT_TITLES[certType] ? certType : 'bonafide';
  const id = uid();
  db.prepare('INSERT INTO certificate_requests (id, student_id, cert_type, purpose) VALUES (?, ?, ?, ?)').run(
    id, studentId, type, purpose || null
  );
  return getById(id);
}

function getById(id) {
  return db.prepare('SELECT * FROM certificate_requests WHERE id = ?').get(id) || null;
}

function listForStudent(studentId) {
  return db.prepare('SELECT * FROM certificate_requests WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

function listAll({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM certificate_requests WHERE status = ? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM certificate_requests ORDER BY created_at DESC').all();
}

function review(id, { status, reviewedBy, reviewNote }) {
  const row = getById(id);
  if (!row) throw Object.assign(new Error('Certificate request not found'), { status: 404 });
  if (row.status !== 'pending') throw Object.assign(new Error('Already reviewed'), { status: 409 });
  if (!['approved', 'rejected'].includes(status)) throw Object.assign(new Error('status must be approved or rejected'), { status: 400 });
  db.prepare(
    `UPDATE certificate_requests SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(status, reviewedBy || null, reviewNote || null, id);
  return getById(id);
}

function renderCertificatePdf({ request, student }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text('EduAI College', { align: 'center' });
    doc.font('Helvetica').fontSize(12).fillColor('#555555').text(CERT_TITLES[request.cert_type], { align: 'center' });
    doc.fillColor('#000000').moveDown(2);

    doc.font('Helvetica-Bold').fontSize(11).text(`Certificate No: CERT-${request.id.slice(0, 8).toUpperCase()}`);
    doc.font('Helvetica').text(`Date Issued: ${new Date().toDateString()}`);
    doc.moveDown(1.5);

    const body = request.cert_type === 'bonafide'
      ? `This is to certify that ${student?.name || 'the student'} is a bonafide student of this institution.`
      : request.cert_type === 'study'
      ? `This is to certify that ${student?.name || 'the student'} has been studying at this institution.`
      : `This is to certify that ${student?.name || 'the student'} has been a student of good character at this institution.`;

    doc.font('Helvetica').fontSize(12).text(body, { align: 'justify', lineGap: 4 });
    if (request.purpose) {
      doc.moveDown(0.8).text(`This certificate is issued for the purpose of: ${request.purpose}`, { align: 'justify' });
    }

    doc.moveDown(3);
    doc.font('Helvetica').fontSize(10).text('_____________________', { align: 'right' });
    doc.text('Authorized Signatory', { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888888').text(
      'This is a system-generated certificate issued upon administrative approval.',
      { align: 'center' }
    );

    doc.end();
  });
}

async function generateCertificatePdf(id) {
  const request = getById(id);
  if (!request) throw Object.assign(new Error('Certificate request not found'), { status: 404 });
  if (request.status !== 'approved') throw Object.assign(new Error('Certificate is not approved yet'), { status: 409 });
  const student = db.prepare('SELECT name, email FROM users WHERE id = ?').get(request.student_id);
  const buffer = await renderCertificatePdf({ request, student });
  return { buffer, request };
}

module.exports = { requestCertificate, getById, listForStudent, listAll, review, generateCertificatePdf, CERT_TITLES };
