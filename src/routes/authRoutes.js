const express = require('express');
const { registerUser, loginUser, requireAuth } = require('../auth');
const memory = require('../memory');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const user = await registerUser(req.body || {});
    res.status(201).json({ ok: true, user });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await loginUser(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// --- Memory controls (per logged-in user) ---
router.get('/memory', requireAuth, (req, res) => {
  const role = String(req.query.role || req.user.role);
  res.json({ ok: true, history: memory.getHistory(req.user.id, role), facts: memory.getFacts(req.user.id) });
});

router.delete('/memory', requireAuth, (req, res) => {
  const role = String(req.query.role || req.user.role);
  memory.clearMemory(req.user.id, role);
  res.json({ ok: true });
});

router.post('/memory/facts', requireAuth, (req, res) => {
  const fact = String(req.body?.fact || '').trim();
  if (!fact) return res.status(400).json({ ok: false, error: '"fact" is required' });
  res.status(201).json({ ok: true, fact: memory.addFact(req.user.id, fact) });
});

router.delete('/memory/facts/:id', requireAuth, (req, res) => {
  memory.deleteFact(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
