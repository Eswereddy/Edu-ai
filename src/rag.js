// Upgraded retrieval: TF-IDF + cosine similarity over a combined corpus of
// the original static facts (knowledgeBase.js, untouched) plus a growing,
// DB-backed knowledge base that admins can add to at runtime via
// /api/kb (see dataRoutes.js). Same retrieve(role, query, topK) contract
// as before, so server.js's existing call site keeps working — this is a
// drop-in quality upgrade, not a breaking change.

const { KB: STATIC_KB } = require('./knowledgeBase');
const { db } = require('./db');

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function buildCorpus(role) {
  const staticDocs = (STATIC_KB[role] || STATIC_KB.student || []).map((content) => ({ content, source: 'static' }));
  const dynamicRows = db.prepare('SELECT content FROM kb_entries WHERE role = ? ORDER BY created_at DESC').all(role);
  const dynamicDocs = dynamicRows.map((r) => ({ content: r.content, source: 'kb' }));
  return [...dynamicDocs, ...staticDocs]; // admin-added facts take precedence
}

function computeTfIdf(corpusTokensList) {
  const df = new Map();
  corpusTokensList.forEach((tokens) => {
    new Set(tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const N = corpusTokensList.length || 1;
  const idf = new Map();
  df.forEach((count, term) => idf.set(term, Math.log((N + 1) / (count + 1)) + 1));
  return idf;
}

function vectorize(tokens, idf) {
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  const vec = new Map();
  tf.forEach((count, term) => {
    const weight = (count / tokens.length) * (idf.get(term) || 0);
    if (weight > 0) vec.set(term, weight);
  });
  return vec;
}

function cosineSim(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((val, key) => {
    normA += val * val;
    if (b.has(key)) dot += val * b.get(key);
  });
  b.forEach((val) => {
    normB += val * val;
  });
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieve up to topK relevant knowledge snippets for a role + query,
 * ranked by TF-IDF cosine similarity rather than raw keyword-overlap
 * counting. Falls back to the top static facts if nothing scores > 0,
 * exactly like the original implementation.
 */
function retrieve(role, query, topK = 4) {
  const docs = buildCorpus(role);
  if (!docs.length) return [];

  const docTokensList = docs.map((d) => tokenize(d.content));
  const idf = computeTfIdf(docTokensList);
  const docVectors = docTokensList.map((tokens) => vectorize(tokens, idf));
  const queryVector = vectorize(tokenize(query), idf);

  const scored = docs.map((d, i) => ({ content: d.content, score: cosineSim(queryVector, docVectors[i]) }));
  scored.sort((a, b) => b.score - a.score);

  const withHits = scored.filter((s) => s.score > 0).slice(0, topK);
  if (withHits.length) return withHits.map((s) => s.content);
  return docs.slice(0, Math.min(topK, docs.length)).map((d) => d.content);
}

function addKbEntry({ role, content, tags }) {
  const { uid } = require('./auth');
  const id = uid();
  db.prepare('INSERT INTO kb_entries (id, role, content, tags) VALUES (?, ?, ?, ?)').run(
    id,
    role,
    content,
    tags || null
  );
  return { id, role, content, tags: tags || null };
}

function listKbEntries(role) {
  return db.prepare('SELECT * FROM kb_entries WHERE role = ? ORDER BY created_at DESC').all(role);
}

function deleteKbEntry(id) {
  db.prepare('DELETE FROM kb_entries WHERE id = ?').run(id);
}

module.exports = { retrieve, addKbEntry, listKbEntries, deleteKbEntry };
