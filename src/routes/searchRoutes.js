// /api/search — one query box across knowledge-base entries,
// announcements, forum threads, and the library catalog. Purely additive:
// read-only, reuses each domain's own table via the shared db connection.
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'Query param "q" is required' });
  const like = `%${q}%`;

  const kb = db.prepare('SELECT id, role, content, tags FROM kb_entries WHERE content LIKE ? LIMIT 10').all(like);
  const announcements = db.prepare('SELECT id, title, body, target_role FROM announcements WHERE title LIKE ? OR body LIKE ? LIMIT 10').all(like, like);
  const forumThreads = db.prepare('SELECT id, title, body FROM forum_threads WHERE title LIKE ? OR body LIKE ? LIMIT 10').all(like, like);
  const books = db.prepare('SELECT id, title, author, category FROM library_books WHERE title LIKE ? OR author LIKE ? LIMIT 10').all(like, like);

  res.json({
    ok: true,
    query: q,
    results: {
      knowledgeBase: kb,
      announcements,
      forumThreads,
      libraryBooks: books,
    },
    totalMatches: kb.length + announcements.length + forumThreads.length + books.length,
  });
});

module.exports = router;
