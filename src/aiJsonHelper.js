// Shared helper for the AI Admin Portal "Advanced AI Suite" (interview
// orchestrator, placement auto-pilot, code reviewer, career simulator,
// curriculum mapper, integrity dashboard, exam difficulty analyzer,
// parent meeting summarizer, grant finder, sentiment heatmap, award
// recommender). Every one of those modules needs the same two things:
// ask the model for strict JSON back, and degrade gracefully (never
// throw a 500 to the UI) if there's no API key configured or the model
// call fails. Centralizing that here keeps all 11 feature modules small.
// Purely additive — does not touch anthropicClient.js, only wraps it.

const { callAnthropic, UpstreamAIError } = require('./anthropicClient');

function safeJsonParse(text) {
  try {
    const cleaned = String(text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }
}

/**
 * Calls Anthropic and parses the reply as JSON. On any failure (no API
 * key, upstream error, unparsable reply) it returns { ok:false, error }
 * instead of throwing, so callers can fall back to a heuristic result.
 */
async function callAnthropicJson({ apiKey, model, system, prompt, maxTokens = 1200, temperature = 0.4 }) {
  try {
    const text = await callAnthropic({
      apiKey,
      model,
      system: `${system}\nRespond with ONLY valid JSON. No markdown fences, no commentary before or after.`,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      maxTokens,
    });
    const parsed = safeJsonParse(text);
    if (!parsed) return { ok: false, error: 'Model reply was not valid JSON', raw: text };
    return { ok: true, data: parsed };
  } catch (e) {
    const msg = e instanceof UpstreamAIError ? e.message : (e?.message || 'AI call failed');
    return { ok: false, error: msg };
  }
}

module.exports = { safeJsonParse, callAnthropicJson };
