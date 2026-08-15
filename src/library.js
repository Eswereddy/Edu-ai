// Library management: book catalog + issue/return workflow with automatic
// overdue fine calculation. Additive module.

const { db } = require('./db');
const crypto = require('crypto');

db.exec(`
CREATE TABLE IF NOT EXISTS library_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  category TEXT,
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_issues (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT NOT NULL,
  returned_at TEXT,
  fine REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_library_issues_book ON library_issues(book_id);
CREATE INDEX IF NOT EXISTS idx_library_issues_student ON library_issues(student_id);
`);

const LOAN_DAYS = 14;
const FINE_PER_DAY = 5; // currency units per day overdue

function uid() {
  return crypto.randomUUID();
}

function addBook({ title, author, isbn, category, totalCopies }) {
  if (!title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  const copies = Math.max(1, Number(totalCopies) || 1);
  const id = uid();
  db.prepare(
    `INSERT INTO library_books (id, title, author, isbn, category, total_copies, available_copies)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, author || null, isbn || null, category || null, copies, copies);
  return getBook(id);
}

function getBook(id) {
  return db.prepare('SELECT * FROM library_books WHERE id = ?').get(id) || null;
}

function listBooks({ search } = {}) {
  if (search) {
    const like = `%${search}%`;
    return db
      .prepare('SELECT * FROM library_books WHERE title LIKE ? OR author LIKE ? OR category LIKE ? ORDER BY title')
      .all(like, like, like);
  }
  return db.prepare('SELECT * FROM library_books ORDER BY title').all();
}

function updateBook(id, patch) {
  const book = getBook(id);
  if (!book) {
    const err = new Error('Book not found');
    err.status = 404;
    throw err;
  }
  const fields = ['title', 'author', 'isbn', 'category'];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(patch, f)) {
      sets.push(`${f} = ?`);
      params.push(patch[f]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'totalCopies')) {
    const delta = Number(patch.totalCopies) - book.total_copies;
    sets.push('total_copies = ?', 'available_copies = available_copies + ?');
    params.push(Number(patch.totalCopies), delta);
  }
  if (!sets.length) return book;
  params.push(id);
  db.prepare(`UPDATE library_books SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getBook(id);
}

function issueBook(bookId, studentId) {
  const book = getBook(bookId);
  if (!book) {
    const err = new Error('Book not found');
    err.status = 404;
    throw err;
  }
  if (book.available_copies < 1) {
    const err = new Error('No copies currently available');
    err.status = 409;
    throw err;
  }
  const activeLoan = db
    .prepare('SELECT id FROM library_issues WHERE book_id = ? AND student_id = ? AND returned_at IS NULL')
    .get(bookId, studentId);
  if (activeLoan) {
    const err = new Error('Student already has this book on loan');
    err.status = 409;
    throw err;
  }
  const dueAt = new Date(Date.now() + LOAN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const id = uid();
  db.prepare('INSERT INTO library_issues (id, book_id, student_id, due_at) VALUES (?, ?, ?, ?)').run(id, bookId, studentId, dueAt);
  db.prepare('UPDATE library_books SET available_copies = available_copies - 1 WHERE id = ?').run(bookId);
  return getIssue(id);
}

function getIssue(id) {
  return db.prepare('SELECT * FROM library_issues WHERE id = ?').get(id) || null;
}

function returnBook(issueId) {
  const issue = getIssue(issueId);
  if (!issue) {
    const err = new Error('Issue record not found');
    err.status = 404;
    throw err;
  }
  if (issue.returned_at) {
    const err = new Error('Already returned');
    err.status = 409;
    throw err;
  }
  const now = new Date();
  const due = new Date(issue.due_at);
  const overdueDays = Math.max(0, Math.ceil((now - due) / (24 * 60 * 60 * 1000)));
  const fine = overdueDays * FINE_PER_DAY;
  db.prepare(`UPDATE library_issues SET returned_at = datetime('now'), fine = ? WHERE id = ?`).run(fine, issueId);
  db.prepare('UPDATE library_books SET available_copies = available_copies + 1 WHERE id = ?').run(issue.book_id);
  return getIssue(issueId);
}

function listIssuesForStudent(studentId) {
  return db
    .prepare(
      `SELECT li.*, b.title, b.author FROM library_issues li JOIN library_books b ON b.id = li.book_id
       WHERE li.student_id = ? ORDER BY li.issued_at DESC`
    )
    .all(studentId);
}

function listActiveIssues() {
  return db
    .prepare(
      `SELECT li.*, b.title FROM library_issues li JOIN library_books b ON b.id = li.book_id
       WHERE li.returned_at IS NULL ORDER BY li.due_at ASC`
    )
    .all();
}

function listOverdue() {
  const nowIso = new Date().toISOString();
  return listActiveIssues().filter((i) => i.due_at < nowIso);
}

module.exports = {
  addBook,
  getBook,
  listBooks,
  updateBook,
  issueBook,
  getIssue,
  returnBook,
  listIssuesForStudent,
  listActiveIssues,
  listOverdue,
  LOAN_DAYS,
  FINE_PER_DAY,
};
