// Real, database-backed endpoints for the data every portal currently
// fakes in localStorage: attendance, grades, fees, notifications,
// announcements, plus admin-managed RAG knowledge entries. All additive —
// the frontend can adopt these gradually per portal without anything
// breaking if it doesn't call them yet.

const express = require('express');
const { db } = require('../db');
const { uid, requireAuth, requireRole } = require('../auth');
const rag = require('../rag');

const router = express.Router();

function canSeeStudent(user, studentId) {
  if (['admin', 'ai-admin', 'faculty'].includes(user.role)) return true;
  if (user.role === 'student') return user.id === studentId;
  if (user.role === 'parent') return user.linkedStudentId === studentId;
  return false;
}

// ---------------------------------------------------------------- Attendance
router.get('/attendance/:studentId', requireAuth, (req, res) => {
  if (!canSeeStudent(req.user, req.params.studentId)) return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
  const rows = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC').all(req.params.studentId);
  const present = rows.filter((r) => r.status === 'present').length;
  const pct = rows.length ? Math.round((present / rows.length) * 1000) / 10 : null;
  res.json({ ok: true, records: rows, attendancePercent: pct });
});

router.post('/attendance', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  const { studentId, subject, date, status } = req.body || {};
  if (!studentId || !subject || !date || !status) {
    return res.status(400).json({ ok: false, error: 'studentId, subject, date, status are required' });
  }
  const id = uid();
  db.prepare('INSERT INTO attendance (id, student_id, subject, date, status, marked_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, studentId, subject, date, status, req.user.id
  );
  res.status(201).json({ ok: true, id });
});

// -------------------------------------------------------------------- Grades
router.get('/grades/:studentId', requireAuth, (req, res) => {
  if (!canSeeStudent(req.user, req.params.studentId)) return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
  const rows = db.prepare('SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC').all(req.params.studentId);
  res.json({ ok: true, records: rows });
});

router.post('/grades', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  const { studentId, subject, examType, marks, maxMarks, term } = req.body || {};
  if (!studentId || !subject || !examType || marks == null || maxMarks == null) {
    return res.status(400).json({ ok: false, error: 'studentId, subject, examType, marks, maxMarks are required' });
  }
  const id = uid();
  db.prepare('INSERT INTO grades (id, student_id, subject, exam_type, marks, max_marks, term) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, studentId, subject, examType, Number(marks), Number(maxMarks), term || null
  );
  res.status(201).json({ ok: true, id });
});

// ---------------------------------------------------------------------- Fees
router.get('/fees/:studentId', requireAuth, (req, res) => {
  if (!canSeeStudent(req.user, req.params.studentId)) return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
  const rows = db.prepare('SELECT * FROM fees WHERE student_id = ? ORDER BY due_date ASC').all(req.params.studentId);
  res.json({ ok: true, records: rows });
});

router.post('/fees', requireAuth, requireRole('admin'), (req, res) => {
  const { studentId, amount, dueDate } = req.body || {};
  if (!studentId || amount == null) return res.status(400).json({ ok: false, error: 'studentId and amount are required' });
  const id = uid();
  db.prepare('INSERT INTO fees (id, student_id, amount, due_date) VALUES (?, ?, ?, ?)').run(id, studentId, Number(amount), dueDate || null);
  res.status(201).json({ ok: true, id });
});

router.post('/fees/:id/pay', requireAuth, (req, res) => {
  const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(req.params.id);
  if (!fee) return res.status(404).json({ ok: false, error: 'Fee record not found' });
  if (!canSeeStudent(req.user, fee.student_id)) return res.status(403).json({ ok: false, error: 'Not authorized' });
  db.prepare("UPDATE fees SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --------------------------------------------------------------- Notifications
router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ ok: true, records: rows, unread: rows.filter((r) => !r.is_read).length });
});

router.post('/notifications', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  const { userId, title, body } = req.body || {};
  if (!userId || !title) return res.status(400).json({ ok: false, error: 'userId and title are required' });
  const id = uid();
  db.prepare('INSERT INTO notifications (id, user_id, title, body) VALUES (?, ?, ?, ?)').run(id, userId, title, body || '');
  res.status(201).json({ ok: true, id });
});

router.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------- Announcements
router.get('/announcements', requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM announcements WHERE target_role = ? OR target_role = 'all' ORDER BY created_at DESC LIMIT 50")
    .all(req.user.role);
  res.json({ ok: true, records: rows });
});

router.post('/announcements', requireAuth, requireRole('faculty', 'admin'), (req, res) => {
  const { targetRole, title, body } = req.body || {};
  if (!targetRole || !title) return res.status(400).json({ ok: false, error: 'targetRole and title are required' });
  const id = uid();
  db.prepare('INSERT INTO announcements (id, target_role, title, body, created_by) VALUES (?, ?, ?, ?, ?)').run(
    id, targetRole, title, body || '', req.user.id
  );
  res.status(201).json({ ok: true, id });
});

// --------------------------------------------------------- Knowledge base (RAG)
router.get('/kb/:role', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  res.json({ ok: true, records: rag.listKbEntries(req.params.role) });
});

router.post('/kb', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const { role, content, tags } = req.body || {};
  if (!role || !content) return res.status(400).json({ ok: false, error: 'role and content are required' });
  res.status(201).json({ ok: true, entry: rag.addKbEntry({ role, content, tags }) });
});

router.delete('/kb/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  rag.deleteKbEntry(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------- Admin overview
router.get('/admin/overview', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  const counts = {
    users: db.prepare('SELECT role, COUNT(*) as n FROM users GROUP BY role').all(),
    attendanceRecords: db.prepare('SELECT COUNT(*) as n FROM attendance').get().n,
    gradesRecords: db.prepare('SELECT COUNT(*) as n FROM grades').get().n,
    pendingFees: db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(amount),0) as total FROM fees WHERE status != 'paid'").get(),
    announcements: db.prepare('SELECT COUNT(*) as n FROM announcements').get().n,
    conversations: db.prepare('SELECT COUNT(*) as n FROM conversations').get().n,
  };
  res.json({ ok: true, counts });
});

module.exports = router;
