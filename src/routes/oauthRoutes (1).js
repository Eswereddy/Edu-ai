// Real "Continue with Google / LinkedIn / GitHub" — Authorization Code flow.
// Additive router, mounted at /api/auth/oauth in server.js. Nothing in the
// existing /api/auth (email+password) routes is touched.

const crypto = require('crypto');
const express = require('express');
const { findOrCreateOAuthUser } = require('../auth');
const oauth = require('../oauth');

const router = express.Router();

// In-memory CSRF state store: state -> { portal, redirect, createdAt }.
// A single-process demo-appropriate store; swap for Redis if you scale to
// multiple instances. Entries expire after 10 minutes either way.
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

function mapPortalToRole(portal) {
  const p = String(portal || '').toLowerCase();
  if (p === 'aiadmin') return 'ai-admin';
  if (['student', 'faculty', 'parent', 'admin', 'ai-admin'].includes(p)) return p;
  return 'student';
}

function frontendRedirect({ portal, ok, token, user, error }) {
  const params = new URLSearchParams({ oauth_portal: portal || 'student' });
  if (ok) {
    params.set('oauth_token', token);
    params.set('oauth_name', user.name || '');
    params.set('oauth_email', user.email || '');
    params.set('oauth_id', user.id || '');
    params.set('oauth_avatar', user.avatarUrl || '');
  } else {
    params.set('oauth_error', error || 'OAuth sign-in failed');
  }
  return `/?${params.toString()}`;
}

// GET /api/auth/oauth/providers — lets the frontend grey out buttons for
// providers that have no CLIENT_ID/CLIENT_SECRET configured, like a real app.
router.get('/providers', (req, res) => {
  res.json({ ok: true, providers: oauth.listProviderStatus() });
});

// GET /api/auth/oauth/:provider/start?portal=student
router.get('/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!oauth.PROVIDERS[provider]) {
    return res.status(400).json({ ok: false, error: 'Unknown OAuth provider' });
  }

  pruneExpiredStates();
  const portal = String(req.query.portal || 'student');
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { portal, createdAt: Date.now() });

  try {
    const redirectUri = oauth.getRedirectUri(req, provider);
    const authorizeUrl = oauth.buildAuthorizeUrl(provider, { state, redirectUri });
    res.redirect(authorizeUrl);
  } catch (error) {
    pendingStates.delete(state);
    // Not configured yet — send the user back with a clear message instead
    // of a dead redirect, same UX a real app gives for a disabled provider.
    res.redirect(frontendRedirect({ portal, ok: false, error: error.message }));
  }
});

// GET /api/auth/oauth/:provider/callback?code=...&state=...
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query;

  const pending = state ? pendingStates.get(state) : null;
  if (pending) pendingStates.delete(state);
  const portal = pending?.portal || 'student';

  if (providerError) {
    return res.redirect(frontendRedirect({ portal, ok: false, error: `${provider} sign-in was cancelled` }));
  }
  if (!oauth.PROVIDERS[provider]) {
    return res.redirect(frontendRedirect({ portal, ok: false, error: 'Unknown OAuth provider' }));
  }
  if (!pending) {
    return res.redirect(frontendRedirect({ portal, ok: false, error: 'Sign-in session expired — please try again' }));
  }
  if (!code) {
    return res.redirect(frontendRedirect({ portal, ok: false, error: 'Missing authorization code' }));
  }

  try {
    const redirectUri = oauth.getRedirectUri(req, provider);
    const accessToken = await oauth.exchangeCodeForToken(provider, { code, redirectUri });
    const profile = await oauth.fetchProfile(provider, accessToken);

    const role = mapPortalToRole(portal);
    const { token, user } = await findOrCreateOAuthUser({
      provider,
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      role,
    });

    res.redirect(frontendRedirect({ portal, ok: true, token, user }));
  } catch (error) {
    console.error(`[oauth:${provider}] callback failed:`, error.message);
    res.redirect(frontendRedirect({ portal, ok: false, error: error.message || `${provider} sign-in failed` }));
  }
});

module.exports = router;
