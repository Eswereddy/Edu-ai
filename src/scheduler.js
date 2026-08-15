// Lightweight in-process scheduler for periodic jobs. Additive module —
// server.js only needs to call `start()` once; nothing else changes.
// No external cron dependency: `setInterval` is enough for a single-
// instance deployment like this one.

const { db } = require('./db');
const library = require('./library');
const audit = require('./audit');
const notify = require('./notify');

const DAY_MS = 24 * 60 * 60 * 1000;

// Reminds a student once per calendar day (per issue) that a book is
// overdue. Dedup is done via the existing audit_log table — no schema
// change needed: we just check whether we already logged a reminder for
// this issue today before sending another one.
function checkOverdueLibraryLoans() {
  let sent = 0;
  try {
    const overdue = library.listOverdue();
    const today = new Date().toISOString().slice(0, 10);
    for (const issue of overdue) {
      const alreadyToday = db
        .prepare(
          `SELECT id FROM audit_log WHERE entity = 'library_overdue_reminder' AND entity_id = ? AND created_at LIKE ?`
        )
        .get(issue.id, `${today}%`);
      if (alreadyToday) continue;
      const daysLate = Math.max(1, Math.ceil((Date.now() - new Date(issue.due_at).getTime()) / DAY_MS));
      notify.send(issue.student_id, {
        title: 'Library book overdue',
        body: `"${issue.title}" is ${daysLate} day(s) overdue. Fines are accruing.`,
        type: 'library_overdue',
        meta: { issueId: issue.id, daysLate },
      });
      audit.record(null, 'reminder', 'library_overdue_reminder', issue.id, { daysLate });
      sent += 1;
    }
  } catch (e) {
    console.error('[scheduler] overdue library check failed', e?.message || e);
  }
  return sent;
}

let timer = null;

/**
 * Starts the background loop. `intervalMs` defaults to once an hour —
 * cheap enough to run continuously, and the per-day dedup means a shorter
 * interval never spams students with repeat reminders.
 */
function start({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (timer) return timer; // idempotent — calling start() twice is a no-op
  checkOverdueLibraryLoans(); // run once immediately on boot
  timer = setInterval(checkOverdueLibraryLoans, intervalMs);
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, checkOverdueLibraryLoans };
