// Renders the structured resume JSON (see resumeBuilder.js) into a real
// downloadable PDF (pdfkit) and Word .docx (docx package). Both are pure
// JS with no native compilation and no external service calls.

const PDFDocument = require('pdfkit');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
} = require('docx');

function contactLine(contact = {}) {
  return [contact.email, contact.phone, contact.location, contact.linkedin, contact.github, contact.portfolio]
    .filter(Boolean)
    .join('  |  ');
}

// ---------------------------------------------------------------- PDF ------
function renderResumePdf(content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text(content.name || 'Resume', { align: 'center' });
    const contact = contactLine(content.contact);
    if (contact) {
      doc.moveDown(0.2).font('Helvetica').fontSize(9.5).fillColor('#333333').text(contact, { align: 'center' });
      doc.fillColor('#000000');
    }
    doc.moveDown(0.6);

    function sectionHeader(title) {
      doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(title.toUpperCase());
      const y = doc.y + 2;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#999999').lineWidth(0.75).stroke();
      doc.moveDown(0.4);
    }

    function bulletList(bullets = []) {
      doc.font('Helvetica').fontSize(10);
      bullets.forEach((b) => {
        doc.text(`•  ${b}`, { indent: 10, paragraphGap: 2 });
      });
    }

    if (content.summary) {
      sectionHeader('Summary');
      doc.font('Helvetica').fontSize(10).text(content.summary, { align: 'justify' });
    }

    if (content.skills?.length) {
      sectionHeader('Skills');
      doc.font('Helvetica').fontSize(10).text(content.skills.join('  •  '));
    }

    if (content.experience?.length) {
      sectionHeader('Experience');
      content.experience.forEach((e) => {
        doc.font('Helvetica-Bold').fontSize(10.5).text(`${e.title}${e.org ? ' — ' + e.org : ''}`, { continued: false });
        if (e.dates) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555555').text(e.dates).fillColor('#000000');
        bulletList(e.bullets);
        doc.moveDown(0.3);
      });
    }

    if (content.projects?.length) {
      sectionHeader('Projects');
      content.projects.forEach((p) => {
        doc.font('Helvetica-Bold').fontSize(10.5).text(`${p.name}${p.tech ? ' (' + p.tech + ')' : ''}`);
        if (p.dates) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555555').text(p.dates).fillColor('#000000');
        bulletList(p.bullets);
        doc.moveDown(0.3);
      });
    }

    if (content.education?.length) {
      sectionHeader('Education');
      content.education.forEach((ed) => {
        doc.font('Helvetica-Bold').fontSize(10.5).text(ed.degree || '');
        doc.font('Helvetica').fontSize(9.5).text(`${ed.institution || ''}${ed.dates ? '  |  ' + ed.dates : ''}${ed.score ? '  |  ' + ed.score : ''}`);
        doc.moveDown(0.2);
      });
    }

    if (content.certifications?.length) {
      sectionHeader('Certifications');
      bulletList(content.certifications);
    }

    doc.end();
  });
}

// --------------------------------------------------------------- DOCX ------
function heading(text) {
  return new Paragraph({
    text: text.toUpperCase(),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' } },
  });
}

function bulletParagraphs(bullets = []) {
  return bullets.map(
    (b) =>
      new Paragraph({
        text: b,
        bullet: { level: 0 },
        spacing: { after: 40 },
      })
  );
}

async function renderResumeDocx(content) {
  const children = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.name || 'Resume', bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
    })
  );
  const contact = contactLine(content.contact);
  if (contact) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contact, size: 18, color: '444444' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  if (content.summary) {
    children.push(heading('Summary'));
    children.push(new Paragraph({ text: content.summary, spacing: { after: 120 } }));
  }

  if (content.skills?.length) {
    children.push(heading('Skills'));
    children.push(new Paragraph({ text: content.skills.join('  •  '), spacing: { after: 120 } }));
  }

  if (content.experience?.length) {
    children.push(heading('Experience'));
    content.experience.forEach((e) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${e.title}${e.org ? ' — ' + e.org : ''}`, bold: true }),
            ...(e.dates ? [new TextRun({ text: `   ${e.dates}`, italics: true, color: '555555' })] : []),
          ],
        })
      );
      children.push(...bulletParagraphs(e.bullets));
    });
  }

  if (content.projects?.length) {
    children.push(heading('Projects'));
    content.projects.forEach((p) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${p.name}${p.tech ? ' (' + p.tech + ')' : ''}`, bold: true }),
            ...(p.dates ? [new TextRun({ text: `   ${p.dates}`, italics: true, color: '555555' })] : []),
          ],
        })
      );
      children.push(...bulletParagraphs(p.bullets));
    });
  }

  if (content.education?.length) {
    children.push(heading('Education'));
    content.education.forEach((ed) => {
      children.push(new Paragraph({ children: [new TextRun({ text: ed.degree || '', bold: true })] }));
      children.push(
        new Paragraph({
          text: `${ed.institution || ''}${ed.dates ? '  |  ' + ed.dates : ''}${ed.score ? '  |  ' + ed.score : ''}`,
          spacing: { after: 80 },
        })
      );
    });
  }

  if (content.certifications?.length) {
    children.push(heading('Certifications'));
    children.push(...bulletParagraphs(content.certifications));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

module.exports = { renderResumePdf, renderResumeDocx };
