// Admin broadcast: creates an announcement (writing to the same
// `announcements` table the existing POST /api/announcements route in
// dataRoutes.js already writes to, with the identical column set — that
// route and its behavior are completely unchanged) and, additively,
// also pushes a real-time notification (via the existing notify.send,
// itself unchanged) to every currently-registered user the announcement
// targets. The plain announcement route only ever inserted a row for
// polling; this is a new, additive way to reach people immediately.

const crypto = require('crypto');
const { db } = require('./db');
const notify = require('./notify');

function uid() {
  return crypto.randomUUID();
}

function broadcast({ targetRole, title, body, createdBy }) {
  if (!targetRole || !title || !String(title).trim()) {
    const err = new Error('targetRole and title are required');
    err.status = 400;
    throw err;
  }
  const validRoles = new Set(['all', 'student', 'faculty', 'parent', 'admin', 'ai-admin']);
  if (!validRoles.has(targetRole)) {
    const err = new Error(`targetRole must be one of: ${[...validRoles].join(', ')}`);
    err.status = 400;
    throw err;
  }

  const id = uid();
  db.prepare('INSERT INTO announcements (id, target_role, title, body, created_by) VALUES (?, ?, ?, ?, ?)').run(
    id, targetRole, String(title).trim(), body || '', createdBy || null
  );

  const recipients = targetRole === 'all'
    ? db.prepare('SELECT id FROM users').all()
    : db.prepare('SELECT id FROM users WHERE role = ?').all(targetRole);

  let notified = 0;
  for (const r of recipients) {
    if (createdBy && r.id === createdBy) continue;
    notify.send(r.id, { title: String(title).trim(), body: body || '', type: 'announcement', meta: { announcementId: id } });
    notified += 1;
  }

  return { id, targetRole, title: String(title).trim(), body: body || '', notifiedCount: notified };
}

module.exports = { broadcast };
