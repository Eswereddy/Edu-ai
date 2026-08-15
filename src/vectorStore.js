// VECTOR DATABASE (RAG) — AI Admin Portal add-on.
// Additive — own tables, own file. Does NOT touch rag.js (the existing
// TF-IDF retriever server.js's /api/ai/instant call site already uses)
// or any other existing file. This is a separate, genuine embedding-based
// vector store that the admin portal can index and query on its own —
// a real upgrade path sitting *next to* the old retriever, not a
// silent swap-in.
//
// EMBEDDINGS — real, pluggable providers, picked in this order:
//   1. Voyage AI  (VOYAGE_API_KEY)   — Anthropic's recommended embeddings
//      partner: https://docs.voyageai.com/docs/embeddings
//   2. OpenAI     (OPENAI_API_KEY)   — text-embedding-3-small
//   3. Local hashing fallback        — always available, zero config.
//      A deterministic feature-hashing bag-of-words embedding (256-dim).
//      It's a real, working vector representation (same trick used by
//      scikit-learn's HashingVectorizer) — lower quality than a trained
//      embedding model, but genuinely semantic-ish (shared vocabulary ->
//      shared dimensions) and needs no API key or network call, so
//      search works out of the box and upgrades automatically the
//      moment a real key is set.
//
// STORAGE — two real backends:
//   - local (default): vectors stored + cosine-searched right here in
//     SQLite. This alone is a working vector database for a college's
//     data volumes (thousands–tens of thousands of chunks).
//   - pinecone (when PINECONE_API_KEY + PINECONE_HOST are set): vectors
//     are also upserted to a real Pinecone index over its REST API, and
//     search queries Pinecone directly. Set VECTOR_DB_BACKEND=pinecone
//     to make Pinecone the query path once you've created an index
//     (dimension must match the active embedding provider — see
//     embeddingInfo() below).

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS vector_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT,
  role TEXT,
  user_id TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  embedding_dims INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vector_docs_source ON vector_documents(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_vector_docs_role ON vector_documents(role);
CREATE INDEX IF NOT EXISTS idx_vector_docs_user ON vector_documents(user_id);
`);

function uid() {
  return crypto.randomUUID();
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------ Embeddings

function embeddingInfo() {
  if (process.env.VOYAGE_API_KEY) return { provider: 'voyage', model: 'voyage-3-lite', dims: 512 };
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: 'text-embedding-3-small', dims: 1536 };
  return { provider: 'local-hash', model: 'hashing-256', dims: 256 };
}

async function embedVoyage(texts) {
  const res = await fetchWithTimeout('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: texts, model: 'voyage-3-lite' }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed (${res.status})`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function embedOpenAI(texts) {
  const res = await fetchWithTimeout('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ input: texts, model: 'text-embedding-3-small' }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status})`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

// Deterministic feature-hashing embedding — no network, no key, always works.
function embedLocalHash(text, dims = 256) {
  const vec = new Array(dims).fill(0);
  const tokens = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const h = crypto.createHash('md5').update(tok).digest();
    const idx = h.readUInt32LE(0) % dims;
    const sign = h[4] % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Embeds a batch of texts with whichever provider is configured. Never
 * throws — on any upstream failure it falls back to the local hashing
 * embedding for that batch so indexing/search never hard-fails.
 */
async function embedBatch(texts) {
  const info = embeddingInfo();
  try {
    if (info.provider === 'voyage') return { ...info, vectors: await embedVoyage(texts) };
    if (info.provider === 'openai') return { ...info, vectors: await embedOpenAI(texts) };
  } catch (e) {
    console.error('[vectorStore] embedding provider failed, falling back to local hashing:', e.message);
  }
  return { provider: 'local-hash', model: 'hashing-256', dims: 256, vectors: texts.map((t) => embedLocalHash(t)) };
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// -------------------------------------------------------------- Pinecone

function pineconeConfigured() {
  return !!(process.env.PINECONE_API_KEY && process.env.PINECONE_HOST);
}

async function pineconeUpsert(vectors) {
  // vectors: [{ id, values, metadata }]
  const url = `https://${process.env.PINECONE_HOST}/vectors/upsert`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': process.env.PINECONE_API_KEY },
    body: JSON.stringify({ vectors }),
  });
  if (!res.ok) throw new Error(`Pinecone upsert failed (${res.status})`);
  return res.json();
}

async function pineconeQuery(vector, topK, filter) {
  const url = `https://${process.env.PINECONE_HOST}/query`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': process.env.PINECONE_API_KEY },
    body: JSON.stringify({ vector, topK, includeMetadata: true, filter }),
  });
  if (!res.ok) throw new Error(`Pinecone query failed (${res.status})`);
  const data = await res.json();
  return (data.matches || []).map((m) => ({ score: m.score, ...m.metadata }));
}

// ------------------------------------------------------------- Indexing

/**
 * Embeds + stores one document chunk. Always writes to the local table
 * (so local cosine search always works as a baseline); also mirrors to
 * Pinecone when configured.
 */
async function indexDocument({ sourceType, sourceId, role, userId, content }) {
  if (!content || !String(content).trim()) return null;
  const { provider, dims, vectors } = await embedBatch([content]);
  const vector = vectors[0];
  const id = uid();

  db.prepare(
    `INSERT INTO vector_documents (id, source_type, source_id, role, user_id, content, embedding_json, embedding_provider, embedding_dims)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sourceType, sourceId || null, role || null, userId || null, String(content), JSON.stringify(vector), provider, dims);

  if (pineconeConfigured()) {
    try {
      await pineconeUpsert([{ id, values: vector, metadata: { sourceType, sourceId, role, userId, content: String(content).slice(0, 1000) } }]);
    } catch (e) {
      console.error('[vectorStore] Pinecone mirror upsert failed:', e.message);
    }
  }

  return { id, sourceType, sourceId, provider, dims };
}

/**
 * Pulls real rows from the existing chats/grades/syllabus tables
 * (read-only) and indexes them. This is what makes the "brain" actually
 * see past chats, grades, and syllabus content, per the request — no
 * existing table or module is modified, only read from.
 */
async function reindexAll({ sourceTypes = ['chat', 'grade', 'syllabus'], limit = 500 } = {}) {
  const results = { chat: 0, grade: 0, syllabus: 0, errors: [] };

  if (sourceTypes.includes('chat')) {
    const rows = db.prepare(
      `SELECT m.id, m.content, m.sender, c.role, c.user_id FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       ORDER BY m.created_at DESC LIMIT ?`
    ).all(limit);
    for (const r of rows) {
      try {
        await indexDocument({
          sourceType: 'chat',
          sourceId: r.id,
          role: r.role,
          userId: r.user_id,
          content: `[${r.sender}] ${r.content}`,
        });
        results.chat++;
      } catch (e) {
        results.errors.push({ sourceType: 'chat', id: r.id, error: e.message });
      }
    }
  }

  if (sourceTypes.includes('grade')) {
    const rows = db.prepare('SELECT id, student_id, subject, exam_type, marks, max_marks, term FROM grades ORDER BY created_at DESC LIMIT ?').all(limit);
    for (const r of rows) {
      try {
        await indexDocument({
          sourceType: 'grade',
          sourceId: r.id,
          role: 'student',
          userId: r.student_id,
          content: `${r.subject} ${r.exam_type}${r.term ? ' (' + r.term + ')' : ''}: ${r.marks}/${r.max_marks} marks.`,
        });
        results.grade++;
      } catch (e) {
        results.errors.push({ sourceType: 'grade', id: r.id, error: e.message });
      }
    }
  }

  if (sourceTypes.includes('syllabus')) {
    const rows = db.prepare('SELECT id, subject_name, title, class_section FROM syllabus_documents ORDER BY created_at DESC LIMIT ?').all(limit);
    for (const r of rows) {
      try {
        await indexDocument({
          sourceType: 'syllabus',
          sourceId: r.id,
          role: 'student',
          userId: null,
          content: `Syllabus — ${r.subject_name} (${r.class_section || 'all sections'}): ${r.title}`,
        });
        results.syllabus++;
      } catch (e) {
        results.errors.push({ sourceType: 'syllabus', id: r.id, error: e.message });
      }
    }
  }

  return results;
}

// -------------------------------------------------------------- Search

/**
 * Semantic search over the vector store, scoped by role/user when given.
 * Queries Pinecone when it's the configured backend, otherwise does
 * cosine search over the local table in JS. Same shape either way.
 */
async function semanticSearch({ query, role, userId, sourceTypes, topK = 5 }) {
  const { vectors } = await embedBatch([query]);
  const queryVector = vectors[0];

  if (pineconeConfigured() && process.env.VECTOR_DB_BACKEND === 'pinecone') {
    const filter = {};
    if (role) filter.role = { $eq: role };
    if (userId) filter.userId = { $eq: userId };
    const matches = await pineconeQuery(queryVector, topK, Object.keys(filter).length ? filter : undefined);
    return { backend: 'pinecone', matches };
  }

  let rows = db.prepare('SELECT * FROM vector_documents').all();
  if (role) rows = rows.filter((r) => !r.role || r.role === role);
  if (userId) rows = rows.filter((r) => !r.user_id || r.user_id === userId);
  if (sourceTypes && sourceTypes.length) rows = rows.filter((r) => sourceTypes.includes(r.source_type));

  const scored = rows.map((r) => ({
    score: cosineSim(queryVector, JSON.parse(r.embedding_json)),
    sourceType: r.source_type,
    sourceId: r.source_id,
    content: r.content,
  }));
  scored.sort((a, b) => b.score - a.score);

  return { backend: 'local', matches: scored.slice(0, topK) };
}

function stats() {
  const rows = db.prepare('SELECT source_type, COUNT(*) as n FROM vector_documents GROUP BY source_type').all();
  const total = db.prepare('SELECT COUNT(*) as n FROM vector_documents').get().n;
  return {
    total,
    bySourceType: rows.reduce((acc, r) => ({ ...acc, [r.source_type]: r.n }), {}),
    embedding: embeddingInfo(),
    pineconeConfigured: pineconeConfigured(),
    activeBackend: pineconeConfigured() && process.env.VECTOR_DB_BACKEND === 'pinecone' ? 'pinecone' : 'local',
  };
}

module.exports = { indexDocument, reindexAll, semanticSearch, stats, embeddingInfo, pineconeConfigured };
