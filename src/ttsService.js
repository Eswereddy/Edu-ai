// Backend Text-to-Speech via the Google Cloud Text-to-Speech REST API.
// Mirrors anthropicClient.js's shape on purpose (fetch + AbortController
// + a dedicated error class) so it fits this codebase's existing
// conventions for "thin wrapper around one external API".
//
// Fully additive: no existing file requires this module — only the new
// ttsRoutes.js below does. Degrades gracefully. If GOOGLE_TTS_API_KEY
// isn't set, callers get a clear thrown error the route turns into
// { ok:false, error }, so the frontend can fall back to the browser's
// built-in speechSynthesis, which is exactly what it does today and
// keeps working unchanged.
//
// Swapping to Amazon Polly instead: Polly's synthesizeSpeech call needs
// SigV4-signed AWS requests (access key + secret, not a single API key),
// which means pulling in the aws-sdk client-polly package — deliberately
// not added here since it wasn't already a dependency. To switch,
// `npm install @aws-sdk/client-polly`, add a `synthesizeSpeechPolly()`
// function that mirrors this one's (text) -> base64 audio contract, and
// pick between them in ttsRoutes.js with a TTS_PROVIDER env var.

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

class UpstreamTTSError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamTTSError';
    this.status = status || 502;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.languageCode] - BCP-47 code, defaults to en-IN to match the frontend's existing utter.lang
 * @param {string} [opts.voiceName] - specific Google voice, e.g. 'en-IN-Neural2-A'
 * @param {number} [opts.speakingRate] - 0.25 - 4.0, defaults to 1.0
 * @returns {Promise<string>} base64-encoded MP3 audio
 */
async function synthesizeSpeech({ text, languageCode = 'en-IN', voiceName, speakingRate = 1.0 }) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    throw new UpstreamTTSError('GOOGLE_TTS_API_KEY is not configured on the server', 500);
  }
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new UpstreamTTSError('text is required', 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), 15000);

  try {
    const response = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: cleanText.slice(0, 5000) },
        voice: voiceName
          ? { languageCode, name: voiceName }
          : { languageCode, ssmlGender: 'FEMALE' },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: typeof speakingRate === 'number' ? speakingRate : 1.0,
        },
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_e) {
      throw new UpstreamTTSError('Google TTS returned a non-JSON response', 502);
    }

    if (!response.ok) {
      const msg = data?.error?.message || `Google TTS request failed (${response.status})`;
      throw new UpstreamTTSError(msg, response.status);
    }
    if (!data.audioContent) {
      throw new UpstreamTTSError('Google TTS returned no audio content', 502);
    }
    return data.audioContent; // base64 MP3, ready to hand straight to an <audio> element
  } catch (error) {
    if (error instanceof UpstreamTTSError) throw error;
    const isAbort = error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
    if (isAbort) throw new UpstreamTTSError('Request to Google TTS timed out', 504);
    throw new UpstreamTTSError(error?.message || 'Failed to reach Google TTS', 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { synthesizeSpeech, UpstreamTTSError };
