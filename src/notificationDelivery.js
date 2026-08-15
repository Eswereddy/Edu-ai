// Fans a notification out across every delivery channel the platform
// supports. notify.js already handles (1) persisting to the
// `notifications` table and (2) an instant push over an open WebSocket
// tab. This module adds the two channels that were missing:
// (3) a real mobile push via Firebase Cloud Messaging (push.js), and
// (4) a real email via SMTP (email.js) — so the notification still
// reaches the user with the app closed or the browser offline, not
// only someone with a live tab open.
//
// Deliberately isolated in its own file (rather than growing push.js /
// email.js / notify.js into one big module) so each concern — "how do I
// reach a mobile device", "how do I reach an inbox", "how do I fan a
// notification out to every channel" — stays separately testable.

const { db } = require('./db');
const push = require('./push');
const email = require('./email');

function escapeHtmlLite(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Best-effort fan-out. Always resolves (never rejects), so it is safe
 * to call without awaiting from a hot path like notify.send().
 */
async function deliverAcrossChannels(userId, { title, body, type, meta } = {}) {
  if (!userId || !title) return { ok: false, reason: 'missing_title_or_user' };

  const [pushResult, emailResult] = await Promise.allSettled([
    push.sendPush(userId, { title, body, data: { type: type || 'general', ...(meta || {}) } }),
    (async () => {
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
      if (!user?.email) return { ok: false, reason: 'no_email_on_file' };
      const html = `<p><strong>${escapeHtmlLite(title)}</strong></p>${body ? `<p>${escapeHtmlLite(body)}</p>` : ''}<p style="color:#888;font-size:12px">This is an automated notification from EduAI.</p>`;
      return email.sendEmail(user.email, title, html);
    })(),
  ]);

  return {
    push: pushResult.status === 'fulfilled' ? pushResult.value : { ok: false, reason: pushResult.reason?.message },
    email: emailResult.status === 'fulfilled' ? emailResult.value : { ok: false, reason: emailResult.reason?.message },
  };
}

module.exports = { deliverAcrossChannels };
