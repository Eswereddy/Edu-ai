// LIVE JOB FEED — server-side proxy to real, third-party job listings.
// Additive — own table, own file, nothing here is imported by any
// pre-existing file, and no existing file is modified.
//
// IMPORTANT — what this deliberately does NOT do:
// LinkedIn, Internshala, and Naukri do not offer a public listings API,
// and scraping their pages is against each site's Terms of Service
// (LinkedIn in particular has pursued legal action against scrapers).
// Building a scraper for those three specific sites isn't something
// this module does, regardless of environment — that's true whether
// this code runs here or anywhere else.
//
// What IS real and IS wired up here: a genuine server-side proxy to
// job-listing APIs that are actually public/licensable, so the admin
// portal's "Job Center" shows real, live postings instead of mock
// data:
//   - Adzuna (https://developer.adzuna.com/) — free API key, covers
//     India (`in`) and many other countries. Set ADZUNA_APP_ID +
//     ADZUNA_APP_KEY.
//   - Arbeitnow (https://www.arbeitnow.com/api/job-board-api) — public,
//     no key required, free to use for aggregation.
// Both are called live, server-side (never from the browser, so no key
// is ever exposed to the client), results are normalized to one shape,
// and cached briefly in SQLite to avoid hammering the upstream APIs.
//
// Adding another real provider later (e.g. a paid Naukri/Internshala
// partner API, if the college licenses one) is a matter of adding one
// more fetcher function below with the same normalized shape — the
// route layer and caching don't need to change.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS live_job_feed_cache (
  id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_job_feed_query ON live_job_feed_cache(query_key);
`);

function uid() {
  return crypto.randomUUID();
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — keeps it "live" without hammering upstream APIs

function getCached(queryKey) {
  const row = db.prepare(
    'SELECT payload_json, fetched_at FROM live_job_feed_cache WHERE query_key = ? ORDER BY fetched_at DESC LIMIT 1'
  ).get(queryKey);
  if (!row) return null;
  const age = Date.now() - new Date(row.fetched_at + 'Z').getTime();
  if (age > CACHE_TTL_MS) return null;
  return JSON.parse(row.payload_json);
}

function setCached(queryKey, source, payload) {
  db.prepare(
    'INSERT INTO live_job_feed_cache (id, query_key, source, payload_json) VALUES (?, ?, ?, ?)'
  ).run(uid(), queryKey, source, JSON.stringify(payload));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- Adzuna
async function fetchAdzuna({ query, location, page = 1 }) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { ok: false, skipped: true, reason: 'ADZUNA_APP_ID/ADZUNA_APP_KEY not configured' };

  const country = process.env.ADZUNA_COUNTRY || 'in'; // India by default
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('results_per_page', '20');
  if (query) url.searchParams.set('what', query);
  if (location) url.searchParams.set('where', location);
  url.searchParams.set('content-type', 'application/json');

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) return { ok: false, error: `Adzuna returned ${res.status}` };
  const data = await res.json();
  const jobs = (data.results || []).map((j) => ({
    id: `adzuna:${j.id}`,
    source: 'adzuna',
    title: j.title,
    company: j.company?.display_name || 'Unknown',
    location: j.location?.display_name || location || '',
    url: j.redirect_url,
    salaryMin: j.salary_min ?? null,
    salaryMax: j.salary_max ?? null,
    postedAt: j.created || null,
    description: (j.description || '').slice(0, 500),
  }));
  return { ok: true, jobs };
}

// -------------------------------------------------------------- Arbeitnow
async function fetchArbeitnow({ query }) {
  const res = await fetchWithTimeout('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) return { ok: false, error: `Arbeitnow returned ${res.status}` };
  const data = await res.json();
  let jobs = (data.data || []).map((j) => ({
    id: `arbeitnow:${j.slug}`,
    source: 'arbeitnow',
    title: j.title,
    company: j.company_name || 'Unknown',
    location: j.location || (j.remote ? 'Remote' : ''),
    url: j.url,
    salaryMin: null,
    salaryMax: null,
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
    description: (j.description || '').replace(/<[^>]+>/g, ' ').slice(0, 500),
  }));
  if (query) {
    const q = query.toLowerCase();
    jobs = jobs.filter((j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q));
  }
  return { ok: true, jobs: jobs.slice(0, 20) };
}

// ------------------------------------------------------------------ Public

/**
 * Fetches live listings from every configured/available real provider,
 * merges them, and caches the merged result briefly. Never throws —
 * a provider that's unconfigured or down is dropped, not fatal.
 */
async function getLiveJobs({ query = '', location = '', page = 1 } = {}) {
  const queryKey = JSON.stringify({ query, location, page });
  const cached = getCached(queryKey);
  if (cached) return { ...cached, cached: true };

  const results = await Promise.allSettled([
    fetchAdzuna({ query, location, page }),
    fetchArbeitnow({ query }),
  ]);

  const jobs = [];
  const providers = [];
  const [adzuna, arbeitnow] = results;

  if (adzuna.status === 'fulfilled' && adzuna.value.ok) {
    jobs.push(...adzuna.value.jobs);
    providers.push({ name: 'adzuna', ok: true, count: adzuna.value.jobs.length });
  } else {
    providers.push({
      name: 'adzuna',
      ok: false,
      reason: adzuna.status === 'fulfilled' ? (adzuna.value.reason || adzuna.value.error) : String(adzuna.reason),
    });
  }

  if (arbeitnow.status === 'fulfilled' && arbeitnow.value.ok) {
    jobs.push(...arbeitnow.value.jobs);
    providers.push({ name: 'arbeitnow', ok: true, count: arbeitnow.value.jobs.length });
  } else {
    providers.push({
      name: 'arbeitnow',
      ok: false,
      reason: arbeitnow.status === 'fulfilled' ? arbeitnow.value.error : String(arbeitnow.reason),
    });
  }

  const payload = { jobs, providers, fetchedAt: new Date().toISOString() };
  setCached(queryKey, 'merged', payload);
  return { ...payload, cached: false };
}

module.exports = { getLiveJobs };
