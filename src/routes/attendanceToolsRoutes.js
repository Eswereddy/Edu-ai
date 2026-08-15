// /api/attendance-tools/* — subject-wise breakdown, deficit calculator,
// PDF report, and an AI recovery plan. Reads the existing `attendance`
// table only; never writes to it.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { db } = require('../db');
const tools = require('../attendanceTools');
const audit = require('../audit');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth);

  function resolveStudentId(req) {
    // Students see their own; faculty/admin/parent can pass ?studentId=
    if (req.user.role === 'student') return req.user.id;
    return req.query.studentId || req.body?.studentId;
  }

  router.get('/breakdown', (req, res) => {
    const studentId = resolveStudentId(req);
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
    res.json({ ok: true, breakdown: tools.subjectWiseBreakdown(studentId) });
  });

  router.get('/deficit', (req, res) => {
    const studentId = resolveStudentId(req);
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
    const requiredPercent = req.query.requiredPercent ? Number(req.query.requiredPercent) : 75;
    res.json({ ok: true, requiredPercent, deficit: tools.deficitCalculator(studentId, requiredPercent) });
  });

  router.get('/report.pdf', async (req, res) => {
    const studentId = resolveStudentId(req);
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
    const requiredPercent = req.query.requiredPercent ? Number(req.query.requiredPercent) : 75;
    const student = db.prepare('SELECT name FROM users WHERE id = ?').get(studentId);
    try {
      const breakdown = tools.deficitCalculator(studentId, requiredPercent);
      const buffer = await tools.renderAttendancePdf({ studentName: student?.name, requiredPercent, breakdown });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${studentId.slice(0, 8)}.pdf"`);
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'Failed to render PDF' });
    }
  });

  router.post('/recovery-plan', requireRole('student', 'faculty', 'admin', 'ai-admin'), async (req, res) => {
    const studentId = resolveStudentId(req);
    if (!studentId) return res.status(400).json({ ok: false, error: 'studentId is required' });
    const requiredPercent = req.body?.requiredPercent ? Number(req.body.requiredPercent) : 75;
    const student = db.prepare('SELECT name FROM users WHERE id = ?').get(studentId);
    const breakdown = tools.deficitCalculator(studentId, requiredPercent);
    const result = await tools.recoveryPlan({ apiKey, model, studentName: student?.name, breakdown });
    audit.record(req.user.id, 'generate', 'attendance_recovery_plan', studentId, { aiGenerated: result.aiGenerated });
    res.json({ ok: true, requiredPercent, ...result });
  });

  return router;
};
