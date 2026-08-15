// /api/career-prep/* — AI cover letter generator. (ATS checks live at
// /api/resume/generate's `ats` field, and mock interviews at
// /api/placements/mock-interviews — both pre-existing and untouched.)
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const careerPrep = require('../careerPrep');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('student'));

  router.post('/cover-letter', async (req, res) => {
    try {
      const letter = await careerPrep.generateCoverLetter({
        apiKey, model, studentId: req.user.id, studentName: req.user.name,
        company: req.body?.company, roleTitle: req.body?.roleTitle,
        highlights: req.body?.highlights, jobDescription: req.body?.jobDescription,
      });
      audit.record(req.user.id, 'generate', 'cover_letter', letter.id, { aiGenerated: letter.aiGenerated });
      res.status(201).json({ ok: true, letter });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate cover letter' });
    }
  });

  router.get('/cover-letter', (req, res) => {
    res.json({ ok: true, letters: careerPrep.listCoverLetters(req.user.id) });
  });

  router.get('/cover-letter/:id', (req, res) => {
    const letter = careerPrep.getCoverLetter(req.user.id, req.params.id);
    if (!letter) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, letter });
  });

  return router;
};
