// Real OAuth 2.0 Authorization Code flow for "Continue with Google / LinkedIn / GitHub".
// Additive module — nothing else in the backend is touched. Each provider is only
// "active" (buttons enabled, routes functional) once its CLIENT_ID/CLIENT_SECRET
// env vars are set, exactly like a real production app.

const PROVIDERS = {
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extraAuthParams: { access_type: 'online', prompt: 'select_account' },
    mapProfile: (p) => ({
      providerId: p.sub,
      email: (p.email || '').toLowerCase(),
      emailVerified: !!p.email_verified,
      name: p.name || [p.given_name, p.family_name].filter(Boolean).join(' '),
      avatarUrl: p.picture || null,
    }),
  },
  linkedin: {
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    profileUrl: 'https://api.linkedin.com/v2/userinfo', // OIDC "Sign In with LinkedIn using OpenID Connect"
    scope: 'openid profile email',
    clientId: () => process.env.LINKEDIN_CLIENT_ID,
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET,
    extraAuthParams: {},
    tokenBodyEncoding: 'form',
    mapProfile: (p) => ({
      providerId: p.sub,
      email: (p.email || '').toLowerCase(),
      emailVerified: !!p.email_verified,
      name: p.name || [p.given_name, p.family_name].filter(Boolean).join(' '),
      avatarUrl: p.picture || null,
    }),
  },
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails', // GitHub only returns verified email via a separate scoped call
    scope: 'read:user user:email',
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    extraAuthParams: {},
    mapProfile: (p, emails) => {
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) : null;
      return {
        providerId: String(p.id),
        email: (primary?.email || p.email || '').toLowerCase(),
        emailVerified: !!primary,
        name: p.name || p.login,
        avatarUrl: p.avatar_url || null,
      };
    },
  },
};

function isConfigured(provider) {
  const cfg = PROVIDERS[provider];
  return !!(cfg && cfg.clientId() && cfg.clientSecret());
}

function listProviderStatus() {
  return Object.fromEntries(Object.keys(PROVIDERS).map((key) => [key, isConfigured(key)]));
}

function getRedirectUri(req, provider) {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/api/auth/oauth/${provider}/callback`;
  // Derive from the incoming request — works fine on Render/behind a proxy
  // as long as x-forwarded-proto/host are set (Express trusts them via `trust proxy`).
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/api/auth/oauth/${provider}/callback`;
}

function buildAuthorizeUrl(provider, { state, redirectUri }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw Object.assign(new Error('Unknown OAuth provider'), { status: 400 });
  if (!isConfigured(provider)) {
    throw Object.assign(new Error(`${cfg.label} sign-in is not configured on this server yet`), { status: 503 });
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
    ...cfg.extraAuthParams,
  });
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

async function exchangeCodeForToken(provider, { code, redirectUri }) {
  const cfg = PROVIDERS[provider];
  const body = new URLSearchParams({
    client_id: cfg.clientId(),
    client_secret: cfg.clientSecret(),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const resp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    const err = new Error(data.error_description || data.error || `${cfg.label} token exchange failed`);
    err.status = 502;
    throw err;
  }
  return data.access_token;
}

async function fetchProfile(provider, accessToken) {
  const cfg = PROVIDERS[provider];
  const resp = await fetch(cfg.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const err = new Error(`Could not fetch ${cfg.label} profile`);
    err.status = 502;
    throw err;
  }
  const profile = await resp.json();

  if (provider === 'github') {
    const emailsResp = await fetch(cfg.emailUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const emails = emailsResp.ok ? await emailsResp.json().catch(() => []) : [];
    return cfg.mapProfile(profile, emails);
  }

  return cfg.mapProfile(profile);
}

module.exports = {
  PROVIDERS,
  isConfigured,
  listProviderStatus,
  getRedirectUri,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchProfile,
};
