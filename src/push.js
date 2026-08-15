// Real mobile push delivery via Firebase Cloud Messaging. This is the
// piece that was missing: notify.js could only reach a user who had the
// browser tab open with a live WebSocket connection. This module lets a
// notification also reach a closed/backgrounded mobile app.
//
// Configuration is via env vars (see .env.example):
//   FIREBASE_SERVICE_ACCOUNT      — the full service-account JSON, as a
//                                    single-line string (recommended for
//                                    hosts like Render/Railway/Heroku).
//   FIREBASE_SERVICE_ACCOUNT_PATH — OR a path to a service-account JSON
//                                    file on disk.
// If neither is set, every function here degrades to a safe, logged
// no-op instead of throwing — so the app keeps working in dev without
// Firebase configured, and starts actually delivering push the moment
// real credentials are added, with zero code changes elsewhere.
//
// A mobile app (iOS/Android/React Native/Flutter) obtains its own FCM
// registration token via the Firebase client SDK, then calls
// POST /api/push/device-token (see routes/pushRoutes.js) to register it
// against the logged-in user. sendPush() below fans a notification out
// to every token that user has registered (they may have more than one
// device).

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS push_device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_device_tokens(user_id);
`);

function uid() { return crypto.randomUUID(); }

let firebaseApp = null;
let initAttempted = false;
let initError = null;

function getFirebaseMessaging() {
  if (firebaseApp) return firebaseApp.messaging ? firebaseApp : null;
  if (initAttempted) return null;
  initAttempted = true;
  try {
    // firebase-admin is an optional dependency — only required when
    // actually configured, so the app doesn't crash on a fresh install
    // that hasn't run `npm install firebase-admin` yet.
    const admin = require('firebase-admin');
    let credentialJson = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credentialJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      credentialJson = require(require('path').resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
    } else {
      return null; // not configured — safe no-op mode
    }
    firebaseApp = admin.apps && admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(credentialJson) });
    firebaseApp.messaging = () => admin.messaging(firebaseApp);
    return firebaseApp;
  } catch (e) {
    initError = e?.message || String(e);
    console.warn('[push] Firebase not available — push notifications disabled:', initError);
    return null;
  }
}

function isConfigured() {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

function registerToken(userId, token, platform = 'unknown') {
  if (!userId || !token) throw Object.assign(new Error('userId and token are required'), { status: 400 });
  const existing = db.prepare('SELECT * FROM push_device_tokens WHERE token = ?').get(token);
  if (existing) {
    db.prepare('UPDATE push_device_tokens SET user_id = ?, platform = ? WHERE token = ?').run(userId, platform, token);
    return db.prepare('SELECT * FROM push_device_tokens WHERE token = ?').get(token);
  }
  const id = uid();
  db.prepare('INSERT INTO push_device_tokens (id, user_id, token, platform) VALUES (?,?,?,?)').run(id, userId, token, platform);
  return db.prepare('SELECT * FROM push_device_tokens WHERE id = ?').get(id);
}

function unregisterToken(userId, token) {
  db.prepare('DELETE FROM push_device_tokens WHERE user_id = ? AND token = ?').run(userId, token);
  return { removed: true };
}

function listTokens(userId) {
  return db.prepare('SELECT * FROM push_device_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function removeStaleTokens(tokens) {
  if (!tokens.length) return;
  const stmt = db.prepare('DELETE FROM push_device_tokens WHERE token = ?');
  for (const t of tokens) stmt.run(t);
}

/**
 * Best-effort push to every device this user has registered. Never
 * throws — returns a small status object instead, so callers (notify.js)
 * can fire-and-forget it.
 */
async function sendPush(userId, { title, body, data } = {}) {
  if (!userId || !title) return { ok: false, reason: 'missing_title_or_user' };
  const tokens = listTokens(userId).map(r => r.token);
  if (!tokens.length) return { ok: false, reason: 'no_registered_devices' };

  const app = getFirebaseMessaging();
  if (!app) return { ok: false, reason: isConfigured() ? 'firebase_init_failed' : 'not_configured', tokens: tokens.length };

  try {
    const message = {
      tokens,
      notification: { title: String(title).slice(0, 200), body: body ? String(body).slice(0, 500) : '' },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    };
    const result = await app.messaging().sendEachForMulticast(message);
    const stale = [];
    result.responses.forEach((r, i) => {
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '')) {
        stale.push(tokens[i]);
      }
    });
    removeStaleTokens(stale);
    return { ok: true, successCount: result.successCount, failureCount: result.failureCount };
  } catch (e) {
    console.error('[push] send failed:', e?.message || e);
    return { ok: false, reason: 'send_failed', error: e?.message || String(e) };
  }
}

module.exports = { registerToken, unregisterToken, listTokens, sendPush, isConfigured };
