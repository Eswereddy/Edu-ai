// WebSocket layer for real-time notifications, messaging pushes, and forum
// activity. Fully additive — attaches to the existing HTTP server returned
// by `app.listen()` in server.js via `attach(httpServer)`; it does not
// replace or wrap Express, so every existing REST route keeps working
// completely unchanged whether or not any client ever opens a socket.
//
// Auth: same JWT used everywhere else. Client connects to
//   ws://host:port/ws?token=<jwt>
// (query param, since browser WebSocket API can't set custom headers).
// An invalid/missing token closes the connection immediately with code 4401.

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const notify = require('./notify');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

function roleOf(userId) {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return row ? row.role : null;
}

function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let userId = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') || '';
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.sub;
    } catch (_e) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    notify.registerSocket(userId, ws);
    ws.send(JSON.stringify({ kind: 'connected', userId, at: new Date().toISOString() }));

    ws.on('close', () => notify.unregisterSocket(userId, ws));
    ws.on('error', () => notify.unregisterSocket(userId, ws));

    // Lightweight heartbeat so dead connections (laptop sleep, network
    // drop) get cleaned out of the in-memory registry instead of leaking.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_e) { /* ignore */ }
    }
  }, 30000);
  if (heartbeat.unref) heartbeat.unref(); // don't keep the process alive just for housekeeping
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

module.exports = { attach, roleOf };
