// /api/i18n/* — multilingual support for every portal. Any authenticated
// role (student/faculty/parent/admin/ai-admin) can use these — no
// requireRole restriction, since "all portals" means every logged-in
// user, not just admins. Purely additive; mirrors ttsRoutes.js's use of
// a dedicated rate limiter for the external-API-backed endpoint.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../auth');
const i18n = require('../i18n');
const userLanguage = require('../userLanguage');
const uiStrings = require('../uiStrings');

module.exports = ({ apiKey, model }) => {
  const router = express.Router();
  router.use(requireAuth);

  const translateLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

  router.get('/languages', (req, res) => {
    res.json({ ok: true, languages: i18n.SUPPORTED_LANGUAGES });
  });

  router.get('/preference', (req, res) => {
    res.json({ ok: true, language: userLanguage.getLanguage(req.user.id) });
  });

  router.put('/preference', (req, res) => {
    const { language } = req.body || {};
    if (!i18n.SUPPORTED_CODES.has(language)) {
      return res.status(400).json({ ok: false, error: `Unsupported language. Use one of: ${[...i18n.SUPPORTED_CODES].join(', ')}` });
    }
    res.json({ ok: true, ...userLanguage.setLanguage(req.user.id, language) });
  });

  // On-demand translation of arbitrary text (a single string or an
  // array) — for dynamic content: AI replies, notices, submitted text,
  // anything the static UI-string dictionary below doesn't cover.
  router.post('/translate', translateLimiter, async (req, res) => {
    try {
      const { text, texts, targetLang } = req.body || {};
      const input = texts || text;
      if (!input) return res.status(400).json({ ok: false, error: 'text or texts is required' });
      const lang = targetLang || userLanguage.getLanguage(req.user.id);
      if (!i18n.SUPPORTED_CODES.has(lang)) {
        return res.status(400).json({ ok: false, error: `Unsupported language: ${lang}` });
      }
      const results = await i18n.translateBatch(input, lang, { apiKey, model });
      res.json({ ok: true, targetLang: lang, results: Array.isArray(texts) ? results : results[0] });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Translation failed' });
    }
  });

  // Common chrome strings (nav labels, buttons) for every portal, in one
  // call per language so a portal's UI can swap text client-side.
  router.get('/strings/:lang', translateLimiter, async (req, res) => {
    try {
      const lang = req.params.lang;
      if (!i18n.SUPPORTED_CODES.has(lang)) {
        return res.status(400).json({ ok: false, error: `Unsupported language: ${lang}` });
      }
      const strings = await uiStrings.getTranslatedStrings(lang, { apiKey, model });
      res.json({ ok: true, lang, strings });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to load UI strings' });
    }
  });

  return router;
};
