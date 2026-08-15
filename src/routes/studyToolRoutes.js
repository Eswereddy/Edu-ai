// /api/study-tool/* — summarizer + Mermaid diagram generator.
// (Quiz drafting: /api/quiz/:id/ai-draft-questions. Planner: /api/study-plan.
// Both pre-existing and untouched.)
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const studyTool = require('../studyTool');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('student'));

  router.post('/summarize', async (req, res) => {
    try {
      const result = await studyTool.summarize({ apiKey, model, studentId: req.user.id, text: req.body?.text, length: req.body?.length });
      audit.record(req.user.id, 'generate', 'study_summary', result.id, { aiGenerated: result.aiGenerated });
      res.status(201).json({ ok: true, ...result });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to summarize' });
    }
  });

  router.post('/diagram', async (req, res) => {
    try {
      const result = await studyTool.generateDiagram({ apiKey, model, studentId: req.user.id, topic: req.body?.topic, diagramType: req.body?.diagramType });
      audit.record(req.user.id, 'generate', 'study_diagram', result.id, { aiGenerated: result.aiGenerated });
      res.status(201).json({ ok: true, ...result });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate diagram' });
    }
  });

  router.get('/history', (req, res) => {
    res.json({ ok: true, history: studyTool.history(req.user.id, { toolType: req.query.toolType }) });
  });

  return router;
};
