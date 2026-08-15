// /api/student/skills/* — technical & soft skills, radar chart data, and
// an AI-generated roadmap (current vs target).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const skills = require('../skills');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('student'));

  router.get('/', (req, res) => {
    res.json({ ok: true, skills: skills.listSkills(req.user.id) });
  });

  router.put('/', (req, res) => {
    try {
      const skill = skills.upsertSkill(req.user.id, req.body || {});
      audit.record(req.user.id, 'upsert', 'student_skill', skill.id);
      res.json({ ok: true, skill });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to save skill' });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      skills.deleteSkill(req.user.id, req.params.id);
      audit.record(req.user.id, 'delete', 'student_skill', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to delete skill' });
    }
  });

  router.get('/radar', (req, res) => {
    res.json({ ok: true, radar: skills.radarData(req.user.id) });
  });

  router.post('/roadmap', async (req, res) => {
    try {
      const roadmap = await skills.generateRoadmap({ apiKey, model, studentId: req.user.id, targetRole: req.body?.targetRole });
      audit.record(req.user.id, 'generate', 'skill_roadmap', roadmap.id, { aiGenerated: roadmap.aiGenerated });
      res.status(201).json({ ok: true, roadmap });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate roadmap' });
    }
  });

  router.get('/roadmap', (req, res) => {
    res.json({ ok: true, roadmaps: skills.listRoadmaps(req.user.id) });
  });

  router.get('/roadmap/:id', (req, res) => {
    const roadmap = skills.getRoadmap(req.user.id, req.params.id);
    if (!roadmap) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, roadmap });
  });

  return router;
};
