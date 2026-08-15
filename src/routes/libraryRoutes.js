// /api/library/* — catalog browsing, issue/return workflow.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const library = require('../library');
const audit = require('../audit');
const notify = require('../notify'); // additive: notify student of new loan / due date

const router = express.Router();

router.get('/books', requireAuth, (req, res) => {
  res.json({ ok: true, books: library.listBooks({ search: req.query.search }) });
});

router.post('/books', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const book = library.addBook(req.body || {});
    audit.record(req.user.id, 'create', 'library_book', book.id, { title: book.title });
    res.status(201).json({ ok: true, book });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.patch('/books/:id', requireAuth, requireRole('admin', 'ai-admin'), (req, res) => {
  try {
    const book = library.updateBook(req.params.id, req.body || {});
    res.json({ ok: true, book });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/issue', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const { bookId, studentId } = req.body || {};
    if (!bookId || !studentId) return res.status(400).json({ ok: false, error: 'bookId and studentId are required' });
    const issue = library.issueBook(bookId, studentId);
    audit.record(req.user.id, 'issue', 'library_issue', issue.id, { bookId, studentId });
    const book = library.getBook(bookId);
    notify.send(studentId, {
      title: 'Book issued',
      body: `"${book?.title || 'Book'}" is due back ${new Date(issue.due_at).toDateString()}.`,
      type: 'library_issued',
      meta: { issueId: issue.id, dueAt: issue.due_at },
    });
    res.status(201).json({ ok: true, issue, loanDays: library.LOAN_DAYS });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/return/:issueId', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  try {
    const issue = library.returnBook(req.params.issueId);
    audit.record(req.user.id, 'return', 'library_issue', issue.id, { fine: issue.fine });
    res.json({ ok: true, issue });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/my-loans', requireAuth, requireRole('student'), (req, res) => {
  res.json({ ok: true, loans: library.listIssuesForStudent(req.user.id) });
});

router.get('/loans/:studentId', requireAuth, requireRole('admin', 'ai-admin', 'faculty', 'parent'), (req, res) => {
  res.json({ ok: true, loans: library.listIssuesForStudent(req.params.studentId) });
});

router.get('/active', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, issues: library.listActiveIssues() });
});

router.get('/overdue', requireAuth, requireRole('admin', 'ai-admin', 'faculty'), (req, res) => {
  res.json({ ok: true, issues: library.listOverdue(), finePerDay: library.FINE_PER_DAY });
});

module.exports = router;
