// Thin wrapper around the model API used for every AI feature across all
// portals. Docs: https://docs.claude.com/en/api/messages
//
// PROVIDER FALLBACK (additive): every call is tried in this order —
//   1. Gemini   (free tier, if GEMINI_API_KEY is set)
//   2. Groq     (free tier, if GROQ_API_KEY is set)
//   3. Anthropic (paid, using the apiKey/model the caller passed in, as before)
// A provider is skipped if its key isn't configured, and the next one is
// tried automatically if a configured provider's request fails. This is
// transparent to every caller — the exported function name and signature
// are unchanged, so none of the ~24 files that call callAnthropic() needed
// to be touched.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

class UpstreamAIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamAIError';
    this.status = status || 502;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.system - system prompt
 * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages
 * @param {number} opts.temperature
 * @param {number} opts.maxTokens
 * @param {number} opts.timeoutMs
 * @returns {Promise<string>} the model's text reply
 */
async function callAnthropicDirect({ apiKey, model, system, messages, temperature, maxTokens, timeoutMs }) {
  if (!apiKey) {
    throw new UpstreamAIError('ANTHROPIC_API_KEY is not configured on the server', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), Math.max(2000, Number(timeoutMs) || 22000));

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        system,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.4,
        max_tokens: maxTokens || 700,
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new UpstreamAIError('Anthropic returned a non-JSON response', 502);
    }

    if (!response.ok) {
      const msg = data?.error?.message || `Anthropic request failed (${response.status})`;
      throw new UpstreamAIError(msg, response.status);
    }

    const text = Array.isArray(data?.content)
      ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      : '';

    if (!text) throw new UpstreamAIError('Anthropic returned an empty response', 502);
    return text;
  } catch (error) {
    if (error instanceof UpstreamAIError) throw error;
    const isAbort = error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
    if (isAbort) throw new UpstreamAIError('Request to Anthropic timed out', 504);
    throw new UpstreamAIError(error?.message || 'Failed to reach Anthropic', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same contract as callAnthropicDirect, but talks to Google's Gemini API
 * (generateContent) instead. Translates the Anthropic-shaped messages/system
 * into Gemini's contents/systemInstruction format.
 */
async function callGeminiDirect({ apiKey, model, system, messages, temperature, maxTokens, timeoutMs }) {
  if (!apiKey) {
    throw new UpstreamAIError('GEMINI_API_KEY is not configured on the server', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), Math.max(2000, Number(timeoutMs) || 22000));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || GEMINI_MODEL)}:generateContent?key=${apiKey}`;

  const contents = (messages || []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: typeof temperature === 'number' ? temperature : 0.4,
          maxOutputTokens: maxTokens || 700,
        },
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new UpstreamAIError('Gemini returned a non-JSON response', 502);
    }

    if (!response.ok) {
      const msg = data?.error?.message || `Gemini request failed (${response.status})`;
      throw new UpstreamAIError(msg, response.status);
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n').trim();

    if (!text) throw new UpstreamAIError('Gemini returned an empty response', 502);
    return text;
  } catch (error) {
    if (error instanceof UpstreamAIError) throw error;
    const isAbort = error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
    if (isAbort) throw new UpstreamAIError('Request to Gemini timed out', 504);
    throw new UpstreamAIError(error?.message || 'Failed to reach Gemini', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same contract as callAnthropicDirect, but talks to Groq's OpenAI-compatible
 * chat completions endpoint. Groq has a generous free tier (no card needed)
 * and is very fast, so it's a good second-line fallback before the paid
 * Anthropic key.
 */
async function callGroqDirect({ apiKey, model, system, messages, temperature, maxTokens, timeoutMs }) {
  if (!apiKey) {
    throw new UpstreamAIError('GROQ_API_KEY is not configured on the server', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), Math.max(2000, Number(timeoutMs) || 22000));

  const chatMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...(messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || GROQ_MODEL,
        messages: chatMessages,
        temperature: typeof temperature === 'number' ? temperature : 0.4,
        max_tokens: maxTokens || 700,
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      throw new UpstreamAIError('Groq returned a non-JSON response', 502);
    }

    if (!response.ok) {
      const msg = data?.error?.message || `Groq request failed (${response.status})`;
      throw new UpstreamAIError(msg, response.status);
    }

    const text = String(data?.choices?.[0]?.message?.content || '').trim();

    if (!text) throw new UpstreamAIError('Groq returned an empty response', 502);
    return text;
  } catch (error) {
    if (error instanceof UpstreamAIError) throw error;
    const isAbort = error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
    if (isAbort) throw new UpstreamAIError('Request to Groq timed out', 504);
    throw new UpstreamAIError(error?.message || 'Failed to reach Groq', 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Public entry point used by every AI feature in the app. Tries each
 * configured free provider in order (Gemini, then Groq) before falling
 * back to Anthropic — using the apiKey/model the caller supplied — as the
 * last, paid resort. A provider is skipped entirely if its key isn't set.
 * If nothing is configured at all, throws a clear combined error.
 */
async function callAnthropic({ apiKey, model, system, messages, temperature, maxTokens, timeoutMs }) {
  const errors = [];

  if (GEMINI_API_KEY) {
    try {
      return await callGeminiDirect({ apiKey: GEMINI_API_KEY, model: GEMINI_MODEL, system, messages, temperature, maxTokens, timeoutMs });
    } catch (e) {
      errors.push(`Gemini: ${e?.message || e}`);
    }
  }

  if (GROQ_API_KEY) {
    try {
      return await callGroqDirect({ apiKey: GROQ_API_KEY, model: GROQ_MODEL, system, messages, temperature, maxTokens, timeoutMs });
    } catch (e) {
      errors.push(`Groq: ${e?.message || e}`);
    }
  }

  if (!apiKey) {
    if (!GEMINI_API_KEY && !GROQ_API_KEY) {
      throw new UpstreamAIError('No AI provider is configured on the server (set GEMINI_API_KEY, GROQ_API_KEY, and/or ANTHROPIC_API_KEY)', 500);
    }
    // Free providers were configured but all failed, and there's no paid
    // fallback — surface the combined error instead of a generic 500.
    throw new UpstreamAIError(`All configured AI providers failed. ${errors.join(' | ')}`, 502);
  }

  try {
    return await callAnthropicDirect({ apiKey, model, system, messages, temperature, maxTokens, timeoutMs });
  } catch (e) {
    errors.push(`Anthropic: ${e?.message || e}`);
    throw new UpstreamAIError(`All configured AI providers failed. ${errors.join(' | ')}`, 502);
  }
}

module.exports = { callAnthropic, callAnthropicDirect, callGeminiDirect, callGroqDirect, UpstreamAIError };
