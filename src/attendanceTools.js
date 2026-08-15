// Attendance tools built ON TOP of the existing `attendance` table (from
// db.js / dataRoutes.js) — read-only against it, no schema change, no
// modification to the existing /api/attendance routes. Adds: subject-wise
// breakdown, a deficit calculator (classes needed to reach a required %,
// or classes safely skippable), a PDF report, and an AI recovery plan.

const PDFDocument = require('pdfkit');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

function subjectWiseBreakdown(studentId) {
  const rows = db.prepare('SELECT subject, status FROM attendance WHERE student_id = ?').all(studentId);
  const bySubject = {};
  for (const r of rows) {
    if (!bySubject[r.subject]) bySubject[r.subject] = { subject: r.subject, total: 0, present: 0, absent: 0, late: 0 };
    const s = bySubject[r.subject];
    s.total += 1;
    if (r.status === 'present') s.present += 1;
    else if (r.status === 'absent') s.absent += 1;
    else if (r.status === 'late') s.late += 1;
  }
  return Object.values(bySubject).map((s) => ({
    ...s,
    percent: s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 10000) / 100 : 0,
  }));
}

// Deficit calculator: given a required percentage, tells the student
// either how many more consecutive classes they must attend to reach it,
// or how many they can safely skip and stay above it.
function deficitCalculator(studentId, requiredPercent = 75) {
  const req = Math.max(1, Math.min(100, Number(requiredPercent) || 75));
  const subjects = subjectWiseBreakdown(studentId);
  return subjects.map((s) => {
    const attended = s.present + s.late;
    if (s.percent >= req) {
      // classes that can be skipped while staying >= req%
      let skippable = 0;
      while (s.total + skippable > 0 && (attended / (s.total + skippable + 1)) * 100 >= req) {
        skippable += 1;
        if (skippable > 1000) break;
      }
      return { ...s, requiredPercent: req, status: 'safe', classesCanSkip: skippable };
    }
    // classes that must be attended consecutively to reach req%
    let mustAttend = 0;
    let a = attended;
    let t = s.total;
    while (t > 0 && (a / t) * 100 < req) {
      a += 1;
      t += 1;
      mustAttend += 1;
      if (mustAttend > 1000) break;
    }
    return { ...s, requiredPercent: req, status: 'deficit', classesMustAttend: mustAttend };
  });
}

function renderAttendancePdf({ studentName, requiredPercent, breakdown }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('EduAI College', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Attendance Report', { align: 'center' });
    doc.fillColor('#000000').moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Student: ', { continued: true }).font('Helvetica').text(studentName || '—');
    doc.font('Helvetica-Bold').text('Required attendance: ', { continued: true }).font('Helvetica').text(`${requiredPercent}%`);
    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999999').lineWidth(0.75).stroke();
    doc.moveDown(0.6);

    for (const row of breakdown) {
      doc.font('Helvetica-Bold').fontSize(11).text(row.subject);
      doc.font('Helvetica').fontSize(10).fillColor('#333333').text(
        `Present: ${row.present}  Absent: ${row.absent}  Late: ${row.late}  Total: ${row.total}  —  ${row.percent}%`
      );
      if (row.status === 'deficit') {
        doc.fillColor('#b00020').text(`Below required ${row.requiredPercent}% — attend the next ${row.classesMustAttend} class(es) consecutively to recover.`);
      } else {
        doc.fillColor('#0a7a2f').text(`Meets required ${row.requiredPercent}%. Can safely skip up to ${row.classesCanSkip} more class(es).`);
      }
      doc.fillColor('#000000').moveDown(0.6);
    }
    doc.end();
  });
}

async function recoveryPlan({ apiKey, model, studentName, breakdown }) {
  const deficitSubjects = breakdown.filter((b) => b.status === 'deficit');
  if (!deficitSubjects.length) {
    return { aiGenerated: false, plan: 'All subjects currently meet the required attendance percentage — no recovery plan needed.' };
  }
  const summary = deficitSubjects
    .map((s) => `${s.subject}: currently ${s.percent}%, needs ${s.classesMustAttend} more consecutive class(es) to reach ${s.requiredPercent}%.`)
    .join('\n');
  try {
    const plan = await callAnthropic({
      apiKey,
      model,
      system: 'You are an academic advisor. Given a student\'s subject-wise attendance deficits, write a short, practical, encouraging recovery plan (under 200 words, plain text, no markdown) with concrete next steps per subject.',
      messages: [{ role: 'user', content: `Student: ${studentName || 'the student'}\n\nAttendance deficits:\n${summary}` }],
      temperature: 0.4,
      maxTokens: 500,
    });
    return { aiGenerated: true, plan };
  } catch (e) {
    return {
      aiGenerated: false,
      plan: `Recovery plan (fallback):\n${deficitSubjects.map((s) => `- ${s.subject}: attend the next ${s.classesMustAttend} class(es) without missing any to reach ${s.requiredPercent}%.`).join('\n')}`,
    };
  }
}

module.exports = { subjectWiseBreakdown, deficitCalculator, renderAttendancePdf, recoveryPlan };
