// /api/payroll/* — staff profiles, monthly payroll generation, payslip PDFs.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const payroll = require('../payroll');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/profile', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const profile = payroll.upsertProfile(req.body || {});
    audit.record(req.user.id, 'upsert', 'staff_profile', profile.id, profile);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/profile/:userId', requireAuth, (req, res) => {
  if (req.params.userId !== req.user.id && !['admin', 'ai-admin'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }
  res.json({ ok: true, profile: payroll.getProfile(req.params.userId) });
});

router.get('/profiles', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, profiles: payroll.listProfiles() });
});

router.post('/generate', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const run = payroll.generatePayroll({ ...req.body, generatedBy: req.user.id });
    audit.record(req.user.id, 'generate', 'payroll_run', run.id, { month: run.month, year: run.year, netPay: run.net_pay });
    notify.send(run.staff_user_id, {
      title: 'Payslip generated',
      body: `Your payslip for ${run.month}/${run.year} is ready.`,
      type: 'payroll_generated',
      meta: { runId: run.id },
    });
    res.status(201).json({ ok: true, run });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/:id/mark-paid', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const run = payroll.markPaid(req.params.id);
    audit.record(req.user.id, 'mark_paid', 'payroll_run', run.id, {});
    res.json({ ok: true, run });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/mine', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, runs: payroll.myPayroll(req.user.id) });
});

router.get('/', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, runs: payroll.listPayroll({ month: req.query.month, year: req.query.year, staffUserId: req.query.staffUserId }) });
});

router.get('/:id/payslip.pdf', requireAuth, async (req, res) => {
  try {
    const run = payroll.getRun(req.params.id);
    if (!run) return res.status(404).json({ ok: false, error: 'Payroll run not found' });
    if (run.staff_user_id !== req.user.id && !['admin', 'ai-admin'].includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }
    const { buffer } = await payroll.generatePayslipPdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${run.month}-${run.year}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
