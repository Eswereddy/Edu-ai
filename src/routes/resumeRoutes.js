// AI Resume Builder routes — generate a resume from profile facts, run an
// ATS-style check, and download the result as PDF or Word (.docx).
// Fully additive: new route group, doesn't touch any existing behavior.

const express = require('express');
const { db } = require('../db');
const { uid, requireAuth } = require('../auth');
const { generateResumeContent, checkResumeAts } = require('../resumeBuilder');
const { renderResumePdf, renderResumeDocx } = require('../resumeRender');

module.exports = function createResumeRouter({ apiKey, model }) {
  const router = express.Router();

  function loadOwnedResume(req, res) {
    const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(req.params.id);
    if (!resume) {
      res.status(404).json({ ok: false, error: 'Resume not found' });
      return null;
    }
    if (resume.user_id !== req.user.id) {
      res.status(403).json({ ok: false, error: 'Not your resume' });
      return null;
    }
    return resume;
  }

  // Generate (or regenerate) a resume from profile facts.
  router.post('/generate', requireAuth, async (req, res) => {
    try {
      const { profile, targetRole, template, jobDescription } = req.body || {};
      if (!profile || typeof profile !== 'object') {
        return res.status(400).json({ ok: false, error: '"profile" object is required (name, education, skills, experience, projects, ...)' });
      }

      const { content, aiGenerated, warning } = await generateResumeContent({ apiKey, model, profile, targetRole });
      const ats = checkResumeAts(content, jobDescription);

      const id = uid();
      db.prepare(
        `INSERT INTO resumes (id, user_id, target_role, template, content_json, ats_score, ats_feedback_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.user.id, targetRole || null, template || 'classic', JSON.stringify(content), ats.score, JSON.stringify(ats));

      res.status(201).json({ ok: true, id, content, aiGenerated, warning: warning || undefined, ats });
    } catch (error) {
      console.error('[POST /api/resume/generate]', error?.message || error);
      res.status(500).json({ ok: false, error: error?.message || 'Resume generation failed' });
    }
  });

  // List your own resumes (most recent first).
  router.get('/', requireAuth, (req, res) => {
    const rows = db
      .prepare('SELECT id, target_role, template, ats_score, created_at, updated_at FROM resumes WHERE user_id = ? ORDER BY updated_at DESC')
      .all(req.user.id);
    res.json({ ok: true, records: rows });
  });

  // Fetch one resume's full structured content.
  router.get('/:id', requireAuth, (req, res) => {
    const resume = loadOwnedResume(req, res);
    if (!resume) return;
    res.json({
      ok: true,
      id: resume.id,
      targetRole: resume.target_role,
      template: resume.template,
      content: JSON.parse(resume.content_json),
      ats: resume.ats_feedback_json ? JSON.parse(resume.ats_feedback_json) : null,
      createdAt: resume.created_at,
      updatedAt: resume.updated_at,
    });
  });

  router.delete('/:id', requireAuth, (req, res) => {
    const resume = loadOwnedResume(req, res);
    if (!resume) return;
    db.prepare('DELETE FROM resumes WHERE id = ?').run(resume.id);
    res.json({ ok: true });
  });

  // Re-run (or run fresh) the ATS-style check, optionally against a
  // pasted job description for keyword matching.
  router.post('/:id/check', requireAuth, (req, res) => {
    const resume = loadOwnedResume(req, res);
    if (!resume) return;
    const content = JSON.parse(resume.content_json);
    const ats = checkResumeAts(content, req.body?.jobDescription);
    db.prepare('UPDATE resumes SET ats_score = ?, ats_feedback_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
      ats.score, JSON.stringify(ats), resume.id
    );
    res.json({ ok: true, ats });
  });

  // Downloads
  router.get('/:id/download.pdf', requireAuth, async (req, res) => {
    const resume = loadOwnedResume(req, res);
    if (!resume) return;
    try {
      const content = JSON.parse(resume.content_json);
      const buffer = await renderResumePdf(content);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${(content.name || 'resume').replace(/\s+/g, '_')}.pdf"`);
      res.send(buffer);
    } catch (error) {
      console.error('[GET /api/resume/:id/download.pdf]', error?.message || error);
      res.status(500).json({ ok: false, error: 'Failed to render PDF' });
    }
  });

  router.get('/:id/download.docx', requireAuth, async (req, res) => {
    const resume = loadOwnedResume(req, res);
    if (!resume) return;
    try {
      const content = JSON.parse(resume.content_json);
      const buffer = await renderResumeDocx(content);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${(content.name || 'resume').replace(/\s+/g, '_')}.docx"`);
      res.send(buffer);
    } catch (error) {
      console.error('[GET /api/resume/:id/download.docx]', error?.message || error);
      res.status(500).json({ ok: false, error: 'Failed to render DOCX' });
    }
  });

  return router;
};
