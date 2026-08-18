// Real persistent database for the EduAI backend.
//
// Uses Node's built-in `node:sqlite` (available Node 22+, no native
// compilation, no extra dependency) so this works anywhere Node runs.
// This module is 100% additive — nothing in the existing server.js
// behavior is removed; it just gives the new routes (auth, memory,
// portal data) somewhere real to read/write instead of localStorage.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eduai.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','faculty','parent','admin','ai-admin')),
  linked_student_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK(sender IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_entries (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late')),
  marked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  exam_type TEXT NOT NULL,
  marks REAL NOT NULL,
  max_marks REAL NOT NULL,
  term TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fees (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','overdue')) DEFAULT 'pending',
  due_date TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  target_role TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_role TEXT,
  template TEXT NOT NULL DEFAULT 'classic',
  content_json TEXT NOT NULL,
  ats_score INTEGER,
  ats_feedback_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, role);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
`);

// --- Additive migration: real OAuth sign-in (Google / LinkedIn / GitHub) ---
// password_hash stays NOT NULL for OAuth-only accounts (a random unusable
// hash is stored — see auth.js), so the original table definition above
// never has to change. These columns are added defensively so upgrading
// an existing eduai.db file (already deployed) works without a fresh DB.
function addColumnIfMissing(table, column, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  } catch (e) {
    // Non-fatal: worst case the OAuth-specific lookups fall back to email match.
    console.warn(`[db] could not add column ${table}.${column}:`, e.message);
  }
}

addColumnIfMissing('users', 'oauth_provider', 'oauth_provider TEXT');
addColumnIfMissing('users', 'oauth_id', 'oauth_id TEXT');
addColumnIfMissing('users', 'avatar_url', 'avatar_url TEXT');

db.exec(`CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id);`);

// --- Additive expansion: genuinely NEW real-world tables only.
// IMPORTANT: this backend already has full, richer, dedicated tables for
// assignments/submissions (src/assignments.js), hostel (src/hostel.js),
// library (src/library.js), transport (src/transport.js), exams
// (src/examCell.js), payroll (src/payroll.js), placements
// (src/placements.js), and parent-child links (src/parentChildren.js) —
// each with its own routes already mounted in server.js. Duplicating
// those table names here would collide with (and break) those modules,
// so this block only adds tables that don't exist anywhere else:
// structured subject/class/faculty-profile metadata and a real login
// audit trail. Run `node src/seed.js` to fill everything (new tables
// AND the existing ones above) with realistic connected demo data.
db.exec(`
CREATE TABLE IF NOT EXISTS faculty_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_id TEXT UNIQUE,
  department TEXT,
  designation TEXT,
  phone TEXT,
  office_room TEXT,
  specialization TEXT,
  joined_year INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  branch TEXT,
  year INTEGER,
  credits INTEGER DEFAULT 3,
  faculty_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  branch TEXT,
  year INTEGER,
  section TEXT,
  class_teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS login_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email_attempted TEXT,
  method TEXT NOT NULL DEFAULT 'password' CHECK(method IN ('password','google','linkedin','github')),
  success INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subjects_faculty ON subjects(faculty_user_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(user_id);
`);

module.exports = { db, DB_PATH };

module.exports = { db, DB_PATH };
