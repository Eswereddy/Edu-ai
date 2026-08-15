// Real email delivery via SMTP (nodemailer). This is the other missing
// delivery channel: previously a notification only ever lived in the
// `notifications` table + an optional live WebSocket push — nothing
// ever reached a user's inbox. Degrades to a safe, logged no-op if SMTP
// isn't configured, so the app runs fine in dev without it.
//
// Configuration (see .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE

let transporter = null;
let initAttempted = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  if (initAttempted) return null;
  initAttempted = true;
  if (!isConfigured()) return null;
  try {
    // nodemailer is an optional dependency — only required once SMTP is
    // actually configured, so a fresh `npm install` without it still runs.
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return transporter;
  } catch (e) {
    console.warn('[email] nodemailer not available — email delivery disabled:', e?.message || e);
    return null;
  }
}

/**
 * Best-effort email send. Never throws — returns a status object so
 * callers (notify.js) can fire-and-forget it.
 */
async function sendEmail(to, subject, html) {
  if (!to || !subject) return { ok: false, reason: 'missing_to_or_subject' };
  const t = getTransporter();
  if (!t) return { ok: false, reason: isConfigured() ? 'transport_init_failed' : 'not_configured' };
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: String(subject).slice(0, 200),
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e?.message || e);
    return { ok: false, reason: 'send_failed', error: e?.message || String(e) };
  }
}

module.exports = { sendEmail, isConfigured };
