// /api/tts/* — server-side Text-to-Speech (Google Cloud TTS). Additive:
// this is the only file that requires ttsService.js; nothing else in
// the app changes just by this route existing.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../auth');
const { synthesizeSpeech } = require('../ttsService');

const router = express.Router();

// TTS calls cost money per character on the Google side, so this gets
// its own modest limiter — same pattern as other external-API routes
// in this app (see the AI routes' use of express-rate-limit).
const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

router.post('/speak', requireAuth, ttsLimiter, async (req, res) => {
  try {
    const { text, languageCode, voiceName, speakingRate } = req.body || {};
    const audioContent = await synthesizeSpeech({ text, languageCode, voiceName, speakingRate });
    res.json({ ok: true, audioContent, mimeType: 'audio/mpeg' });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
