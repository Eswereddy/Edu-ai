// /api/payroll/* additions — faculty self-service (bank details, tax
// declarations), tax-aware payroll generation, and Form-16-style summary.
// Mounted on the SAME router path as the existing payrollRoutes.js but
// lives in its own file/router so nothing there is touched.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const payrollTax = require('../payrollTax');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();
const STAFF_SELF = ['faculty', 'admin', 'ai-admin'];

// ------------------------------------------------------- Self-service

router.put('/self/bank-details', requireAuth, requireRole(...STAFF_SELF), (req, res) => {
  try {
    const details = payrollTax.upsertBankDetails({ ...req.body, userId: req.user.id });
    audit.record(req.user.id, 'upsert', 'staff_bank_details', req.user.id, { bankName: details.bank_name });
    res.json({ ok: true, details });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/self/bank-details', requireAuth, requireRole(...STAFF_SELF), (req, res) => {
  res.json({ ok: true, details: payrollTax.getBankDetails(req.user.id) });
});

router.get('/bank-details/:userId', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, details: payrollTax.getBankDetails(req.params.userId) });
});

router.put('/self/tax-declaration', requireAuth, requireRole(...STAFF_SELF), (req, res) => {
  try {
    const declaration = payrollTax.upsertTaxDeclaration({ ...req.body, staffUserId: req.user.id });
    audit.record(req.user.id, 'upsert', 'staff_tax_declaration', declaration.id, {
      financialYear: declaration.financial_year, regime: declaration.regime,
    });
    res.json({ ok: true, declaration });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/self/tax-declaration/:financialYear', requireAuth, requireRole(...STAFF_SELF), (req, res) => {
  res.json({ ok: true, declaration: payrollTax.getTaxDeclaration(req.user.id, req.params.financialYear) });
});

router.get('/tax-declarations', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, declarations: payrollTax.listTaxDeclarations({ financialYear: req.query.financialYear }) });
});

// ------------------------------------------------ Tax-aware payroll run

router.post('/generate-with-tax', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const { run, taxBreakdown } = payrollTax.generatePayrollWithTax({ ...req.body, generatedBy: req.user.id });
    audit.record(req.user.id, 'generate_with_tax', 'payroll_run', run.id, {
      month: run.month, year: run.year, netPay: run.net_pay, monthlyTds: taxBreakdown.monthly_tds,
    });
    notify.send(run.staff_user_id, {
      title: 'Payslip generated',
      body: `Your payslip for ${run.month}/${run.year} is ready. TDS deducted: Rs. ${taxBreakdown.monthly_tds}.`,
      type: 'payroll_generated',
      meta: { runId: run.id },
    });
    res.status(201).json({ ok: true, run, taxBreakdown });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/:id/tax-breakdown', requireAuth, (req, res) => {
  const breakdown = payrollTax.getTaxBreakdown(req.params.id);
  if (!breakdown) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, breakdown });
});

// ----------------------------------------------------------- Form-16-ish

function canViewStaff(req, staffUserId) {
  return staffUserId === req.user.id || ['admin', 'ai-admin'].includes(req.user.role);
}

router.get('/form16/:staffUserId/:financialYear', requireAuth, (req, res) => {
  if (!canViewStaff(req, req.params.staffUserId)) return res.status(403).json({ ok: false, error: 'Not authorized' });
  try {
    res.json({ ok: true, summary: payrollTax.form16Summary(req.params.staffUserId, req.params.financialYear) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/form16/:staffUserId/:financialYear/pdf', requireAuth, async (req, res) => {
  if (!canViewStaff(req, req.params.staffUserId)) return res.status(403).json({ ok: false, error: 'Not authorized' });
  try {
    const { buffer, summary } = await payrollTax.generateForm16Pdf(req.params.staffUserId, req.params.financialYear);
    audit.record(req.user.id, 'download', 'form16', req.params.staffUserId, { financialYear: req.params.financialYear });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="form16-${summary.financialYear}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
