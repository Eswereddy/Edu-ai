// HR/Payroll extensions: faculty self-service (bank details + annual tax
// declarations), automatic TDS deduction on payroll generation, and a
// Form-16-style annual tax summary PDF.
//
// Fully additive — new tables only, own file. Does NOT modify
// payroll.js: tax-aware payroll generation is a wrapper that computes the
// TDS amount here and then calls the existing, untouched
// `payroll.generatePayroll()` with it folded into `deductions`, so every
// safeguard already in that function (duplicate-run check, etc.) still
// applies unchanged.
//
// IMPORTANT — these are simplified, illustrative slab rates for a demo
// project, not current CBDT-notified brackets, and the "Form 16" PDF is a
// plain-language summary, not a statutory TRACES-certified Form 16.
// Neither should be used for real payroll disbursal or tax filing without
// a qualified CA/HR professional verifying against the actual law for the
// relevant financial year.

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db } = require('./db');
const payroll = require('./payroll');

db.exec(`
CREATE TABLE IF NOT EXISTS staff_bank_details (
  user_id TEXT PRIMARY KEY,
  bank_name TEXT,
  account_number TEXT,
  ifsc TEXT,
  pan TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_tax_declarations (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL,
  financial_year TEXT NOT NULL,
  regime TEXT NOT NULL DEFAULT 'new' CHECK(regime IN ('old','new')),
  declared_80c REAL NOT NULL DEFAULT 0,
  declared_80d REAL NOT NULL DEFAULT 0,
  hra_claimed REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(staff_user_id, financial_year)
);

CREATE TABLE IF NOT EXISTS payroll_tax_breakdown (
  payroll_run_id TEXT PRIMARY KEY,
  financial_year TEXT NOT NULL,
  regime TEXT NOT NULL,
  annualized_gross REAL NOT NULL,
  taxable_income REAL NOT NULL,
  annual_tax REAL NOT NULL,
  cess REAL NOT NULL,
  monthly_tds REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

// ------------------------------------------------------- Self-service

function upsertBankDetails({ userId, bankName, accountNumber, ifsc, pan }) {
  if (!userId) throw fail('userId is required');
  const existing = db.prepare('SELECT * FROM staff_bank_details WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(
      `UPDATE staff_bank_details SET bank_name = ?, account_number = ?, ifsc = ?, pan = ?, updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(bankName ?? existing.bank_name, accountNumber ?? existing.account_number, ifsc ?? existing.ifsc, pan ?? existing.pan, userId);
  } else {
    db.prepare(
      'INSERT INTO staff_bank_details (user_id, bank_name, account_number, ifsc, pan) VALUES (?,?,?,?,?)'
    ).run(userId, bankName || null, accountNumber || null, ifsc || null, pan || null);
  }
  return db.prepare('SELECT * FROM staff_bank_details WHERE user_id = ?').get(userId);
}

function getBankDetails(userId) {
  return db.prepare('SELECT * FROM staff_bank_details WHERE user_id = ?').get(userId) || null;
}

const VALID_REGIMES = new Set(['old', 'new']);
const FY_PATTERN = /^\d{4}-\d{2}$/;

function upsertTaxDeclaration({ staffUserId, financialYear, regime, declared80C, declared80D, hraClaimed, otherDeductions }) {
  if (!staffUserId || !financialYear) throw fail('staffUserId and financialYear are required');
  if (!FY_PATTERN.test(financialYear)) throw fail('financialYear must look like "2025-26"');
  const r = VALID_REGIMES.has(regime) ? regime : 'new';
  const existing = db.prepare('SELECT * FROM staff_tax_declarations WHERE staff_user_id = ? AND financial_year = ?')
    .get(staffUserId, financialYear);
  if (existing) {
    db.prepare(
      `UPDATE staff_tax_declarations SET regime = ?, declared_80c = ?, declared_80d = ?, hra_claimed = ?, other_deductions = ?, submitted_at = datetime('now')
       WHERE id = ?`
    ).run(r, Number(declared80C) || 0, Number(declared80D) || 0, Number(hraClaimed) || 0, Number(otherDeductions) || 0, existing.id);
    return db.prepare('SELECT * FROM staff_tax_declarations WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO staff_tax_declarations (id, staff_user_id, financial_year, regime, declared_80c, declared_80d, hra_claimed, other_deductions)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, staffUserId, financialYear, r, Number(declared80C) || 0, Number(declared80D) || 0, Number(hraClaimed) || 0, Number(otherDeductions) || 0);
  return db.prepare('SELECT * FROM staff_tax_declarations WHERE id = ?').get(id);
}

function getTaxDeclaration(staffUserId, financialYear) {
  return db.prepare('SELECT * FROM staff_tax_declarations WHERE staff_user_id = ? AND financial_year = ?')
    .get(staffUserId, financialYear) || null;
}

function listTaxDeclarations({ financialYear } = {}) {
  if (financialYear) {
    return db.prepare(
      `SELECT td.*, u.name, u.email FROM staff_tax_declarations td JOIN users u ON u.id = td.staff_user_id
       WHERE td.financial_year = ? ORDER BY u.name`
    ).all(financialYear);
  }
  return db.prepare(
    `SELECT td.*, u.name, u.email FROM staff_tax_declarations td JOIN users u ON u.id = td.staff_user_id ORDER BY td.financial_year DESC, u.name`
  ).all();
}

// Indian financial year runs April -> March.
function financialYearFor(month, year) {
  const m = Number(month);
  const y = Number(year);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// ------------------------------------------------------- Tax computation
// Illustrative slabs only — see file header disclaimer.

const NEW_REGIME_SLABS = [
  { upTo: 300000, rate: 0 },
  { upTo: 700000, rate: 0.05 },
  { upTo: 1000000, rate: 0.10 },
  { upTo: 1200000, rate: 0.15 },
  { upTo: 1500000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];
const NEW_REGIME_STANDARD_DEDUCTION = 75000;
const NEW_REGIME_REBATE_CEILING = 1200000; // taxable income at/below this -> nil tax under 87A

const OLD_REGIME_SLABS = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];
const OLD_REGIME_STANDARD_DEDUCTION = 50000;
const OLD_REGIME_REBATE_CEILING = 500000;
const OLD_REGIME_80C_CAP = 150000;
const OLD_REGIME_80D_CAP = 100000;

function taxFromSlabs(taxableIncome, slabs) {
  let tax = 0;
  let lower = 0;
  for (const slab of slabs) {
    if (taxableIncome <= lower) break;
    const upper = Math.min(taxableIncome, slab.upTo);
    tax += Math.max(0, upper - lower) * slab.rate;
    lower = slab.upTo;
  }
  return tax;
}

// grossAnnualSalary: full-year basic + allowances estimate.
function computeAnnualTax({ grossAnnualSalary, regime, declared80C = 0, declared80D = 0, hraClaimed = 0, otherDeductions = 0 }) {
  const gross = Math.max(0, Number(grossAnnualSalary) || 0);
  let taxableIncome;
  let slabs;
  let rebateCeiling;

  if (regime === 'old') {
    const deductions = OLD_REGIME_STANDARD_DEDUCTION
      + Math.min(Number(declared80C) || 0, OLD_REGIME_80C_CAP)
      + Math.min(Number(declared80D) || 0, OLD_REGIME_80D_CAP)
      + Math.max(0, Number(hraClaimed) || 0)
      + Math.max(0, Number(otherDeductions) || 0);
    taxableIncome = Math.max(0, gross - deductions);
    slabs = OLD_REGIME_SLABS;
    rebateCeiling = OLD_REGIME_REBATE_CEILING;
  } else {
    // New regime does not allow 80C/80D/HRA — only the standard deduction.
    taxableIncome = Math.max(0, gross - NEW_REGIME_STANDARD_DEDUCTION);
    slabs = NEW_REGIME_SLABS;
    rebateCeiling = NEW_REGIME_REBATE_CEILING;
  }

  let annualTax = taxFromSlabs(taxableIncome, slabs);
  if (taxableIncome <= rebateCeiling) annualTax = 0; // Section 87A rebate (marginal relief not modeled)
  const cess = annualTax * 0.04; // health & education cess
  const totalAnnualTax = annualTax + cess;

  return {
    taxableIncome: Math.round(taxableIncome),
    annualTax: Math.round(annualTax),
    cess: Math.round(cess),
    totalAnnualTax: Math.round(totalAnnualTax),
    monthlyTds: Math.round(totalAnnualTax / 12),
  };
}

// ------------------------------------------------ Tax-aware payroll run

function generatePayrollWithTax({ staffUserId, month, year, allowances = 0, otherDeductions = 0, generatedBy }) {
  const profile = payroll.getProfile(staffUserId);
  if (!profile) throw fail('No staff profile found for this user — create one first', 404);

  const financialYear = financialYearFor(month, year);
  const declaration = getTaxDeclaration(staffUserId, financialYear);
  const regime = declaration?.regime || 'new';

  // Approximation: assumes basic + allowances stay flat across the
  // financial year to estimate annualized gross for slab purposes. Real
  // payroll systems true this up every month as actuals change.
  const annualizedGross = (Number(profile.basic_salary) + Number(allowances)) * 12;

  const { taxableIncome, annualTax, cess, totalAnnualTax, monthlyTds } = computeAnnualTax({
    grossAnnualSalary: annualizedGross,
    regime,
    declared80C: declaration?.declared_80c || 0,
    declared80D: declaration?.declared_80d || 0,
    hraClaimed: declaration?.hra_claimed || 0,
    otherDeductions: declaration?.other_deductions || 0,
  });

  const totalDeductions = Number(otherDeductions) + monthlyTds;
  // Reuses the existing, unmodified payroll.generatePayroll() — its
  // duplicate-run-per-month check and net-pay math still apply as-is.
  const run = payroll.generatePayroll({ staffUserId, month, year, allowances, deductions: totalDeductions, generatedBy });

  db.prepare(
    `INSERT INTO payroll_tax_breakdown (payroll_run_id, financial_year, regime, annualized_gross, taxable_income, annual_tax, cess, monthly_tds)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(run.id, financialYear, regime, annualizedGross, taxableIncome, annualTax, cess, monthlyTds);

  return { run, taxBreakdown: getTaxBreakdown(run.id) };
}

function getTaxBreakdown(runId) {
  return db.prepare('SELECT * FROM payroll_tax_breakdown WHERE payroll_run_id = ?').get(runId) || null;
}

// ----------------------------------------------------------- Form-16-ish

function form16Summary(staffUserId, financialYear) {
  if (!FY_PATTERN.test(financialYear)) throw fail('financialYear must look like "2025-26"');
  const profile = payroll.getProfile(staffUserId);
  if (!profile) throw fail('No staff profile found for this user', 404);

  const [startYearStr] = financialYear.split('-');
  const startYear = Number(startYearStr);
  // Months Apr(startYear)..Dec(startYear), then Jan(startYear+1)..Mar(startYear+1)
  const runs = db.prepare(
    `SELECT * FROM payroll_runs WHERE staff_user_id = ?
     AND ((year = ? AND month >= 4) OR (year = ? AND month <= 3))
     ORDER BY year, month`
  ).all(staffUserId, startYear, startYear + 1);

  const breakdowns = runs.map((r) => ({ run: r, tax: getTaxBreakdown(r.id) }));
  const grossPaid = runs.reduce((sum, r) => sum + Number(r.basic) + Number(r.allowances), 0);
  const totalTdsDeducted = breakdowns.reduce((sum, b) => sum + (b.tax ? Number(b.tax.monthly_tds) : 0), 0);
  const latestRegime = breakdowns.length ? breakdowns[breakdowns.length - 1].tax?.regime : (getTaxDeclaration(staffUserId, financialYear)?.regime || 'new');
  const latestTaxableIncome = breakdowns.length ? breakdowns[breakdowns.length - 1].tax?.taxable_income : null;

  return {
    staffUserId,
    financialYear,
    monthsWithPayroll: runs.length,
    grossSalaryPaid: Math.round(grossPaid),
    totalTdsDeducted: Math.round(totalTdsDeducted),
    regime: latestRegime,
    estimatedAnnualTaxableIncome: latestTaxableIncome,
    monthlyBreakdown: breakdowns.map((b) => ({
      month: b.run.month,
      year: b.run.year,
      basic: b.run.basic,
      allowances: b.run.allowances,
      deductions: b.run.deductions,
      netPay: b.run.net_pay,
      tds: b.tax ? b.tax.monthly_tds : null,
    })),
  };
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function renderForm16Pdf({ summary, staff, bank }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('EduAI College', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555')
      .text('Form 16 — Annual Tax Summary (Illustrative)', { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(0.8);

    const boxY = doc.y;
    const boxHeight = 48;
    doc.save();
    doc.rect(50, boxY, 495, boxHeight).fillAndStroke('#fff4e5', '#e0a020');
    doc.restore();
    doc.fillColor('#7a4a00').fontSize(8.5).font('Helvetica-Bold')
      .text('This is a system-generated summary for internal / project use only. It is NOT a statutory Form 16 issued under Rule 31(1)(a) of the Income Tax Rules and cannot be used for income tax filing. Obtain the official TRACES-certified Form 16 from your employer for that purpose.',
        58, boxY + 5, { width: 479 });
    doc.fillColor('#000000').font('Helvetica').fontSize(10);
    doc.x = 50;
    doc.y = boxY + boxHeight + 12;

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999999').lineWidth(0.75).stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').text('Employee Name: ', { continued: true }).font('Helvetica').text(staff?.name || 'Unknown');
    doc.font('Helvetica-Bold').text('Employee Code: ', { continued: true }).font('Helvetica').text(staff?.employee_code || '—');
    doc.font('Helvetica-Bold').text('PAN: ', { continued: true }).font('Helvetica').text(bank?.pan || '—');
    doc.font('Helvetica-Bold').text('Designation: ', { continued: true }).font('Helvetica').text(staff?.designation || '—');
    doc.font('Helvetica-Bold').text('Financial Year: ', { continued: true }).font('Helvetica').text(summary.financialYear);
    doc.font('Helvetica-Bold').text('Tax Regime: ', { continued: true }).font('Helvetica').text(summary.regime === 'old' ? 'Old Regime' : 'New Regime');
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(11).text('Monthly Breakdown');
    doc.font('Helvetica').fontSize(9).moveDown(0.3);
    const colX = [50, 150, 230, 320, 410, 480];
    doc.font('Helvetica-Bold').text('Month', colX[0], doc.y, { continued: false });
    doc.font('Helvetica-Bold').text('Basic', colX[1], doc.y - 11);
    doc.font('Helvetica-Bold').text('Allowances', colX[2], doc.y - 11);
    doc.font('Helvetica-Bold').text('Deductions', colX[3], doc.y - 11);
    doc.font('Helvetica-Bold').text('TDS', colX[4], doc.y - 11);
    doc.font('Helvetica-Bold').text('Net', colX[5], doc.y - 11);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(9);
    for (const row of summary.monthlyBreakdown) {
      const y = doc.y;
      doc.text(`${MONTH_NAMES[row.month]} ${row.year}`, colX[0], y);
      doc.text(Number(row.basic).toFixed(0), colX[1], y);
      doc.text(Number(row.allowances).toFixed(0), colX[2], y);
      doc.text(Number(row.deductions).toFixed(0), colX[3], y);
      doc.text(row.tds != null ? Number(row.tds).toFixed(0) : '—', colX[4], y);
      doc.text(Number(row.netPay).toFixed(0), colX[5], y);
      doc.moveDown(0.35);
    }
    doc.x = 50;
    doc.moveDown(0.6);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    doc.x = 50;
    doc.font('Helvetica-Bold').fontSize(11).text('Annual Summary');
    doc.font('Helvetica').fontSize(10).moveDown(0.3);
    doc.text(`Gross Salary Paid (${summary.monthsWithPayroll} month(s) processed): Rs. ${summary.grossSalaryPaid.toFixed(2)}`);
    if (summary.estimatedAnnualTaxableIncome != null) {
      doc.text(`Estimated Annual Taxable Income: Rs. ${Number(summary.estimatedAnnualTaxableIncome).toFixed(2)}`);
    }
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).text('Total Tax Deducted at Source');
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0a5d9e').text(`Rs. ${summary.totalTdsDeducted.toFixed(2)}`);
    doc.fillColor('#000000').font('Helvetica').fontSize(10);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888888').text(
      'System-generated summary. Not a substitute for the official Form 16 (Parts A & B) issued via TRACES.',
      { align: 'center' }
    );
    doc.end();
  });
}

async function generateForm16Pdf(staffUserId, financialYear) {
  const summary = form16Summary(staffUserId, financialYear);
  const staffRow = db.prepare(
    `SELECT u.name, sp.employee_code, sp.designation, sp.department
     FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
     WHERE u.id = ?`
  ).get(staffUserId);
  const bank = getBankDetails(staffUserId);
  const buffer = await renderForm16Pdf({ summary, staff: staffRow, bank });
  return { buffer, summary };
}

module.exports = {
  upsertBankDetails, getBankDetails,
  upsertTaxDeclaration, getTaxDeclaration, listTaxDeclarations,
  financialYearFor, computeAnnualTax,
  generatePayrollWithTax, getTaxBreakdown,
  form16Summary, generateForm16Pdf,
};
