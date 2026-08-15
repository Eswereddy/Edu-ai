// Fee receipts: generates a real downloadable PDF receipt for any fee
// record already marked 'paid' in the existing `fees` table. Purely
// additive and read-only against that table — no schema change to
// `fees`, no changes to the existing /api/fees routes' behavior.

const PDFDocument = require('pdfkit');
const { db } = require('./db');

function receiptNumber(feeId) {
  // Deterministic, readable receipt number derived from the fee id —
  // no extra table/counter needed, and it's stable if regenerated.
  return `RCPT-${feeId.slice(0, 8).toUpperCase()}`;
}

function renderReceiptPdf({ fee, student }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('EduAI College', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Official Fee Payment Receipt', { align: 'center' });
    doc.fillColor('#000000').moveDown(1);

    const y0 = doc.y;
    doc.moveTo(50, y0).lineTo(545, y0).strokeColor('#999999').lineWidth(0.75).stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).text('Receipt No: ', { continued: true }).font('Helvetica').text(receiptNumber(fee.id));
    doc.font('Helvetica-Bold').text('Date Paid: ', { continued: true }).font('Helvetica').text(fee.paid_at || '—');
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').text('Student Name: ', { continued: true }).font('Helvetica').text(student?.name || 'Unknown');
    doc.font('Helvetica-Bold').text('Student Email: ', { continued: true }).font('Helvetica').text(student?.email || '—');
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(12).text('Amount Paid');
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0a7d3c').text(`Rs. ${Number(fee.amount).toFixed(2)}`);
    doc.fillColor('#000000').fontSize(10).font('Helvetica');
    if (fee.due_date) doc.moveDown(0.3).text(`Original due date: ${fee.due_date}`);
    doc.moveDown(0.3).text(`Status: ${fee.status}`);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888888').text(
      'This is a system-generated receipt and does not require a signature.',
      { align: 'center' }
    );

    doc.end();
  });
}

async function generateReceiptForFee(feeId) {
  const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(feeId);
  if (!fee) throw Object.assign(new Error('Fee record not found'), { status: 404 });
  if (fee.status !== 'paid') throw Object.assign(new Error('Receipt is only available for paid fees'), { status: 409 });
  const student = db.prepare('SELECT name, email FROM users WHERE id = ?').get(fee.student_id);
  const buffer = await renderReceiptPdf({ fee, student });
  return { buffer, receiptNumber: receiptNumber(fee.id), fee };
}

module.exports = { generateReceiptForFee, receiptNumber };
