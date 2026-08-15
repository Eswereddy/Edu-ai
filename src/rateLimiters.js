// Shared rate limiters for the write-heavy routes added in this pass
// (forum posts/replies, direct messages) — previously only /api/ai/* had
// a limiter (see server.js's `aiLimiter`). Additive module: reuses the
// `express-rate-limit` dependency already in package.json.

const rateLimit = require('express-rate-limit');

// Keyed per logged-in user (falls back to IP for the rare unauthenticated
// case) so one noisy user can't exhaust a shared IP's budget in a NAT'd
// classroom/lab setting.
function keyByUser(req) {
  return req.user?.id || req.ip;
}

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WRITE_RATE_LIMIT_PER_MINUTE || 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  message: { ok: false, error: 'Too many requests — please slow down and try again shortly.' },
});

module.exports = { writeLimiter };
