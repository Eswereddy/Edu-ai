// MULTILINGUAL (i18n) — core translation engine, shared by every portal.
// Additive: own tables, own file. Mirrors the conventions already used
// by ttsService.js / anthropicClient.js in this codebase (fetch +
// AbortController + a dedicated error class, graceful degradation when
// a key isn't set) so it fits the existing style.
//
// PROVIDERS, tried in this order:
//   1. Google Cloud Translate (GOOGLE_TRANSLATE_API_KEY) — same Google
//      Cloud project this app already uses for TTS (see ttsService.js);
//      typically the same API key works for both once Translate is
//      enabled on that project.
//   2. Claude itself (ANTHROPIC_API_KEY) — already required/configured
//      for every AI feature in this app, so translation works even if
//      GOOGLE_TRANSLATE_API_KEY is never set. Claude is genuinely
//      capable at translation, especially for the Indian-language set
//      this app defaults to (en-IN elsewhere in the codebase).
//   3. Passthrough — if neither is configured/reachable, the original
//      text is returned with `translated:false` rather than throwing,
//      so a portal UI can still render something instead of breaking.
//
// Every translation is cached in SQLite keyed by (text hash, target
// lang, provider) so the same string is never paid for / re-requested
// twice — same caching instinct as liveJobFeed.js.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS translation_cache (
  id TEXT PRIMARY KEY,
  text_hash TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(text_hash, target_lang)
);
`);

// The languages this feature actively supports across all portals.
// Weighted toward India (this app's default locale is en-IN elsewhere)
// plus a few widely-requested global languages. Adding one more is a
// one-line addition here — nothing else needs to change.
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' },
  { code: 'ta', name: 'Tamil' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ur', name: 'Urdu' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese (Simplified)' },
];
const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

class UpstreamTranslationError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamTranslationError';
    this.status = status || 502;
  }
}

function uid() {
  return crypto.randomUUID();
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function langName(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || code;
}

function getCached(text, targetLang) {
  const row = db.prepare('SELECT translated_text, provider FROM translation_cache WHERE text_hash = ? AND target_lang = ?')
    .get(hashText(text), targetLang);
  return row || null;
}

function setCached(text, targetLang, translatedText, provider) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO translation_cache (id, text_hash, target_lang, source_text, translated_text, provider) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uid(), hashText(text), targetLang, String(text), translatedText, provider);
  } catch (_e) { /* cache is best-effort */ }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function translateViaGoogle(texts, targetLang) {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) return null;
  const res = await fetchWithTimeout(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, target: targetLang, format: 'text' }),
  });
  if (!res.ok) throw new UpstreamTranslationError(`Google Translate returned ${res.status}`, res.status);
  const data = await res.json();
  return data.data.translations.map((t) => t.translatedText);
}

async function translateViaClaude(texts, targetLang, apiKey, model) {
  if (!apiKey) return null;
  // Batch as numbered lines so one call handles the whole array and the
  // mapping back to indices is unambiguous even if a string has newlines.
  const marker = '\u0001'; // improbable in real UI/chat text, used as a safe delimiter
  const joined = texts.map((t, i) => `${i}${marker}${String(t).replace(/\n/g, ' ')}`).join('\n');
  const text = await callAnthropic({
    apiKey,
    model,
    system: `You are a translation engine. Translate each numbered line into ${langName(targetLang)} (${targetLang}). ` +
      `Keep the exact "<index>${marker}<translation>" format, one per line, same order, no extra commentary, no markdown.`,
    messages: [{ role: 'user', content: joined }],
    temperature: 0,
    maxTokens: 2000,
  });
  const lines = text.split('\n').filter(Boolean);
  const out = new Array(texts.length).fill(null);
  for (const line of lines) {
    const idx = line.indexOf(marker);
    if (idx === -1) continue;
    const i = Number(line.slice(0, idx));
    if (Number.isInteger(i) && i >= 0 && i < texts.length) out[i] = line.slice(idx + 1);
  }
  // Fall back to the original text for any line the model dropped/reordered.
  return out.map((t, i) => (t == null ? texts[i] : t));
}

/**
 * Translates a batch of strings to targetLang. Cache-first per string;
 * only uncached strings hit a provider. Never throws for a missing/failed
 * provider — falls through the chain and ultimately returns the original
 * text with translated:false so callers always get a usable response.
 */
async function translateBatch(texts, targetLang, { apiKey, model } = {}) {
  if (!Array.isArray(texts)) texts = [texts];
  const clean = texts.map((t) => String(t ?? ''));

  if (targetLang === 'en' || !SUPPORTED_CODES.has(targetLang)) {
    return clean.map((t) => ({ text: t, translated: targetLang === 'en', provider: targetLang === 'en' ? 'none' : 'unsupported-language' }));
  }

  const results = new Array(clean.length);
  const pendingIdx = [];
  clean.forEach((t, i) => {
    if (!t.trim()) { results[i] = { text: t, translated: false, provider: 'none' }; return; }
    const cached = getCached(t, targetLang);
    if (cached) results[i] = { text: cached.translated_text, translated: true, provider: cached.provider, cached: true };
    else pendingIdx.push(i);
  });

  if (pendingIdx.length) {
    const pendingTexts = pendingIdx.map((i) => clean[i]);
    let translated = null;
    let provider = null;

    try {
      translated = await translateViaGoogle(pendingTexts, targetLang);
      provider = 'google-translate';
    } catch (e) {
      console.error('[i18n] Google Translate failed, falling back to Claude:', e.message);
    }

    if (!translated) {
      try {
        translated = await translateViaClaude(pendingTexts, targetLang, apiKey, model);
        provider = 'claude';
      } catch (e) {
        console.error('[i18n] Claude translation failed:', e.message);
      }
    }

    pendingIdx.forEach((i, j) => {
      if (translated && translated[j]) {
        results[i] = { text: translated[j], translated: true, provider };
        setCached(clean[i], targetLang, translated[j], provider);
      } else {
        results[i] = { text: clean[i], translated: false, provider: 'unavailable' };
      }
    });
  }

  return results;
}

async function translateOne(text, targetLang, opts) {
  const [r] = await translateBatch([text], targetLang, opts);
  return r;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  SUPPORTED_CODES,
  translateBatch,
  translateOne,
  UpstreamTranslationError,
};
