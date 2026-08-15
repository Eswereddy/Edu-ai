// Career Prep: AI cover letter generator. ATS checks already exist in
// resumeBuilder.js and mock interview scheduling already exists in
// mockInterviews.js (both untouched) — this fills the one missing piece:
// a cover letter drafted from a resume/profile + a target job.
// Fully additive — own table, own file.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS cover_letters (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  content TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cover_letters_student ON cover_letters(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

async function generateCoverLetter({ apiKey, model, studentId, studentName, company, roleTitle, highlights, jobDescription }) {
  if (!company || !roleTitle) throw Object.assign(new Error('company and roleTitle are required'), { status: 400 });

  const highlightText = Array.isArray(highlights) && highlights.length ? highlights.join('\n- ') : 'No specific highlights provided.';
  let content;
  let aiGenerated = false;
  try {
    content = await callAnthropic({
      apiKey,
      model,
      system: 'You write concise, professional cover letters for students applying to internships/jobs. Plain text only, no markdown, 250-350 words, three to four paragraphs, addressed generically ("Dear Hiring Manager") unless told otherwise.',
      messages: [{
        role: 'user',
        content: `Applicant: ${studentName || 'the applicant'}\nCompany: ${company}\nRole: ${roleTitle}\nKey highlights:\n- ${highlightText}\n${jobDescription ? `\nJob description:\n${jobDescription}` : ''}`,
      }],
      temperature: 0.5,
      maxTokens: 700,
    });
    aiGenerated = true;
  } catch (e) {
    content = `Dear Hiring Manager,\n\nI am writing to express my interest in the ${roleTitle} position at ${company}. ${highlightText !== 'No specific highlights provided.' ? `My relevant experience includes: ${highlightText}.` : 'I believe my academic background and skills make me a strong fit for this role.'}\n\nI would welcome the opportunity to discuss how I can contribute to your team.\n\nSincerely,\n${studentName || 'Applicant'}`;
  }

  const id = uid();
  db.prepare(
    `INSERT INTO cover_letters (id, student_id, company, role_title, content, ai_generated) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, studentId, company, roleTitle, content, aiGenerated ? 1 : 0);
  return { id, studentId, company, roleTitle, content, aiGenerated };
}

function listCoverLetters(studentId) {
  return db.prepare('SELECT id, company, role_title, ai_generated, created_at FROM cover_letters WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

function getCoverLetter(studentId, id) {
  return db.prepare('SELECT * FROM cover_letters WHERE id = ? AND student_id = ?').get(id, studentId) || null;
}

module.exports = { generateCoverLetter, listCoverLetters, getCoverLetter };
