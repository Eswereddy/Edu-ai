// Real, database-backed endpoints for the genuinely new tables added in
// db.js: faculty profiles, subjects, classes, and login history/audit.
//
// Everything else a real college portal needs — assignments, hostel,
// library, transport, exams, payroll, placements, parent-child links —
// already has its own dedicated, richer route file mounted in server.js
// (assignmentRoutes, hostelRoutes, libraryRoutes, transportRoutes,
// examCellRoutes, payrollRoutes, placementRoutes, parentChildRoutes).
// This file does not duplicate any of those.

const express = require('express');
const { db } = require('../db');
const { uid, requireAuth, requireRole } = require('../auth');

const router = express.Router();

// -------------------------------------------------------------- Subjects
router.get('/subjects', requireAuth, (req, res) => {
  const { branch, year } = req.query;
  let sql = 'SELECT s.*, u.name AS faculty_name FROM subjects s LEFT JOIN users u ON u.id = s.faculty_user_id WHERE 1=1';
  const params = [];
  if (branch) { sql += ' AND s.branch = ?'; params.push(branch); }
  if (year) { sql += ' AND s.year = ?'; params.push(Number(year)); }
  res.json({ ok: true, records: db.prepare(sql).all(...params) });
});

router.post('/subjects', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const { code, name, branch, year, credits, facultyUserId } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const id = uid();
  db.prepare('INSERT INTO subjects (id, code, name, branch, year, credits, faculty_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, code || null, name, branch || null, year ?? null, credits ?? 3, facultyUserId || null);
  res.status(201).json({ ok: true, id });
});

// --------------------------------------------------------------- Classes
router.get('/classes', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name AS class_teacher_name FROM classes c LEFT JOIN users u ON u.id = c.class_teacher_id ORDER BY c.name
  `).all();
  res.json({ ok: true, records: rows });
});

router.post('/classes', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const { name, branch, year, section, classTeacherId } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const id = uid();
  db.prepare('INSERT INTO classes (id, name, branch, year, section, class_teacher_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, branch || null, year ?? null, section || null, classTeacherId || null);
  res.status(201).json({ ok: true, id });
});

// -------------------------------------------------------- Faculty profile
router.get('/profile/faculty/:userId', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM faculty_profiles WHERE user_id = ?').get(req.params.userId);
  if (!profile) return res.status(404).json({ ok: false, error: 'No profile on file yet' });
  res.json({ ok: true, profile });
});

router.put('/profile/faculty/:userId', requireAuth, (req, res) => {
  const isSelf = req.user.role === 'faculty' && req.user.id === req.params.userId;
  const isStaff = ['admin', 'ai-admin'].includes(req.user.role);
  if (!isSelf && !isStaff) return res.status(403).json({ ok: false, error: 'Not authorized' });
  const { employeeId, department, designation, phone, officeRoom, specialization, joinedYear } = req.body || {};
  db.prepare(`
    INSERT INTO faculty_profiles (user_id, employee_id, department, designation, phone, office_room, specialization, joined_year, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET employee_id=excluded.employee_id, department=excluded.department,
      designation=excluded.designation, phone=excluded.phone, office_room=excluded.office_room,
      specialization=excluded.specialization, joined_year=excluded.joined_year, updated_at=datetime('now')
  `).run(req.params.userId, employeeId || null, department || null, designation || null, phone || null,
    officeRoom || null, specialization || null, joinedYear || null);
  res.json({ ok: true });
});

// ---------------------------------------------------------- Login audit
router.get('/auth/login-history', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT method, success, ip_address, created_at FROM login_audit WHERE user_id = ? ORDER BY created_at DESC LIMIT 25'
  ).all(req.user.id);
  res.json({ ok: true, records: rows });
});

router.get('/admin/login-audit', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT la.*, u.name, u.role FROM login_audit la LEFT JOIN users u ON u.id = la.user_id
    ORDER BY la.created_at DESC LIMIT 100
  `).all();
  res.json({ ok: true, records: rows });
});

module.exports = router;
