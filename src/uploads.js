// Generic file upload storage used by assignments, forum attachments,
// profile avatars, etc. Stores files on local disk under data/uploads and
// tracks metadata in the DB so ownership/access can be checked. Additive
// module — requires the new `multer` dependency (see package.json).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  purpose TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
`);

// Deny obviously dangerous file types outright; everything else is allowed
// since this platform handles many kinds of coursework attachments.
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.sh', '.msi', '.com', '.dll', '.scr']);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024); // 15MB default

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type ${ext} is not allowed`));
  }
  cb(null, true);
}

const multerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function recordUpload({ userId, filename, originalName, mimeType, size, purpose }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO uploads (id, user_id, filename, original_name, mime_type, size, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, filename, originalName, mimeType || null, size || null, purpose || null);
  return getUpload(id);
}

function getUpload(id) {
  return db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) || null;
}

function listForUser(userId) {
  return db.prepare('SELECT * FROM uploads WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function absolutePath(upload) {
  return path.join(UPLOAD_DIR, upload.filename);
}

function deleteUpload(id, userId, isAdmin) {
  const upload = getUpload(id);
  if (!upload) return false;
  if (!isAdmin && upload.user_id !== userId) {
    const err = new Error('Not your file');
    err.status = 403;
    throw err;
  }
  try {
    fs.unlinkSync(absolutePath(upload));
  } catch (_e) {
    // file already gone from disk — still clean up the DB row
  }
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
  return true;
}

module.exports = { multerUpload, recordUpload, getUpload, listForUser, absolutePath, deleteUpload, UPLOAD_DIR, MAX_UPLOAD_BYTES };
