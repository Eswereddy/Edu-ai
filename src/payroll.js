// Payroll & HR: staff (faculty/admin) employment profiles and monthly
// payroll runs with a real downloadable payslip PDF. Additive — new
// tables only, references users.id but doesn't touch the users table.

const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  employee_code TEXT,
  designation TEXT,
  department TEXT,
  date_of_joining TEXT,
  basic_salary REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  basic REAL NOT NULL,
  allowances REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','paid')),
  generated_by TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  UNIQUE(staff_user_id, month, year)
);
CREATE INDEX IF NOT EXISTS idx_payroll_staff ON payroll_runs(staff_user_id);
`);

function uid() {
  return crypto.randomUUID();
}

function upsertProfile({ userId, employeeCode, designation, department, dateOfJoining, basicSalary }) {
  if (!userId) throw Object.assign(new Error('userId is required'), { status: 400 });
  const existing = db.prepare('SELECT * FROM staff_profiles WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(
      `UPDATE staff_profiles SET employee_code = ?, designation = ?, department = ?, date_of_joining = ?,
       basic_salary = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).run(employeeCode ?? existing.employee_code, designation ?? existing.designation, department ?? existing.department,
      dateOfJoining ?? existing.date_of_joining, basicSalary != null ? Number(basicSalary) : existing.basic_salary, userId);
    return db.prepare('SELECT * FROM staff_profiles WHERE user_id = ?').get(userId);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO staff_profiles (id, user_id, employee_code, designation, department, date_of_joining, basic_salary)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, userId, employeeCode || null, designation || null, department || null, dateOfJoining || null, basicSalary ? Number(basicSalary) : 0);
  return db.prepare('SELECT * FROM staff_profiles WHERE id = ?').get(id);
}

function getProfile(userId) {
  return db.prepare('SELECT * FROM staff_profiles WHERE user_id = ?').get(userId) || null;
}

function listProfiles() {
  return db.prepare(
    `SELECT sp.*, u.name, u.email, u.role FROM staff_profiles sp JOIN users u ON u.id = sp.user_id ORDER BY u.name`
  ).all();
}

function generatePayroll({ staffUserId, month, year, allowances = 0, deductions = 0, generatedBy }) {
  const profile = getProfile(staffUserId);
  const basic = profile ? profile.basic_salary : 0;
  const netPay = Number(basic) + Number(allowances) - Number(deductions);
  const existing = db.prepare('SELECT * FROM payroll_runs WHERE staff_user_id = ? AND month = ? AND year = ?')
    .get(staffUserId, month, year);
  if (existing) {
    throw Object.assign(new Error('Payroll for this staff member and month already exists'), { status: 409 });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO payroll_runs (id, staff_user_id, month, year, basic, allowances, deductions, net_pay, generated_by)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, staffUserId, Number(month), Number(year), Number(basic), Number(allowances), Number(deductions), netPay, generatedBy || null);
  return db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id);
}

function markPaid(id) {
  const row = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Payroll run not found'), { status: 404 });
  if (row.status === 'paid') throw Object.assign(new Error('Already marked paid'), { status: 409 });
  db.prepare(`UPDATE payroll_runs SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).run(id);
  return db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id);
}

function myPayroll(userId) {
  return db.prepare('SELECT * FROM payroll_runs WHERE staff_user_id = ? ORDER BY year DESC, month DESC').all(userId);
}

function listPayroll({ month, year, staffUserId } = {}) {
  let sql = 'SELECT * FROM payroll_runs WHERE 1=1';
  const params = [];
  if (month) { sql += ' AND month = ?'; params.push(Number(month)); }
  if (year) { sql += ' AND year = ?'; params.push(Number(year)); }
  if (staffUserId) { sql += ' AND staff_user_id = ?'; params.push(staffUserId); }
  sql += ' ORDER BY year DESC, month DESC';
  return db.prepare(sql).all(...params);
}

function getRun(id) {
  return db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id) || null;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function renderPayslipPdf({ run, staff }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('EduAI College', { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text('Salary Payslip', { align: 'center' });
    doc.fillColor('#000000').moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999999').lineWidth(0.75).stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').text('Employee Name: ', { continued: true }).font('Helvetica').text(staff?.name || 'Unknown');
    doc.font('Helvetica-Bold').text('Employee Code: ', { continued: true }).font('Helvetica').text(staff?.employee_code || '—');
    doc.font('Helvetica-Bold').text('Designation: ', { continued: true }).font('Helvetica').text(staff?.designation || '—');
    doc.font('Helvetica-Bold').text('Department: ', { continued: true }).font('Helvetica').text(staff?.department || '—');
    doc.font('Helvetica-Bold').text('Pay Period: ', { continued: true }).font('Helvetica').text(`${MONTH_NAMES[run.month]} ${run.year}`);
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(11).text('Earnings & Deductions');
    doc.font('Helvetica').fontSize(10).moveDown(0.3);
    doc.text(`Basic Salary: Rs. ${Number(run.basic).toFixed(2)}`);
    doc.text(`Allowances: Rs. ${Number(run.allowances).toFixed(2)}`);
    doc.text(`Deductions: Rs. ${Number(run.deductions).toFixed(2)}`);
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(12).text('Net Pay');
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0a7d3c').text(`Rs. ${Number(run.net_pay).toFixed(2)}`);
    doc.fillColor('#000000').fontSize(10).font('Helvetica');
    doc.moveDown(0.3).text(`Status: ${run.status}`);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888888').text(
      'This is a system-generated payslip and does not require a signature.',
      { align: 'center' }
    );
    doc.end();
  });
}

async function generatePayslipPdf(runId) {
  const run = getRun(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found'), { status: 404 });
  const staffRow = db.prepare(
    `SELECT u.name, sp.employee_code, sp.designation, sp.department
     FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
     WHERE u.id = ?`
  ).get(run.staff_user_id);
  const buffer = await renderPayslipPdf({ run, staff: staffRow });
  return { buffer, run };
}

module.exports = {
  upsertProfile, getProfile, listProfiles, generatePayroll, markPaid,
  myPayroll, listPayroll, getRun, generatePayslipPdf,
};
