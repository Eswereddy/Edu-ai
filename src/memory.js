// Long-term conversation memory, per logged-in user + portal role.
// Every /api/ai/instant call from an authenticated user gets its turn
// saved here; the next call for that user+role pulls the recent history
// back in as extra system-prompt context, so the AI "remembers" prior
// sessions instead of starting cold every time (which is what the old
// stateless-only endpoint did).

const { db } = require('./db');
const { uid } = require('./auth');

const MAX_TURNS_IN_CONTEXT = 8; // ~4 user/assistant pairs

function getOrCreateActiveConversation(userId, role) {
  const existing = db
    .prepare('SELECT * FROM conversations WHERE user_id = ? AND role = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId, role);
  if (existing) return existing;

  const id = uid();
  db.prepare('INSERT INTO conversations (id, user_id, role, title) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    role,
    `${role} session`
  );
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function saveTurn(userId, role, userText, assistantText) {
  if (!userId) return; // anonymous callers: no persistence, unchanged old behavior
  const conv = getOrCreateActiveConversation(userId, role);
  const now = new Date().toISOString();

  const insert = db.prepare('INSERT INTO messages (id, conversation_id, sender, content) VALUES (?, ?, ?, ?)');
  insert.run(uid(), conv.id, 'user', String(userText || '').slice(0, 4000));
  insert.run(uid(), conv.id, 'assistant', String(assistantText || '').slice(0, 4000));
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conv.id);
}

function getRecentContext(userId, role, limit = MAX_TURNS_IN_CONTEXT) {
  if (!userId) return [];
  const conv = db
    .prepare('SELECT * FROM conversations WHERE user_id = ? AND role = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId, role);
  if (!conv) return [];

  // Order by rowid (insertion order), not created_at alone — multiple turns
  // saved within the same second would otherwise tie and sort unpredictably.
  const rows = db
    .prepare('SELECT sender, content FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?')
    .all(conv.id, limit);
  return rows.reverse(); // chronological order
}

function getHistory(userId, role) {
  if (!userId) return [];
  const conv = db
    .prepare('SELECT * FROM conversations WHERE user_id = ? AND role = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId, role);
  if (!conv) return [];
  return db
    .prepare('SELECT sender, content, created_at FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
    .all(conv.id);
}

function clearMemory(userId, role) {
  if (!userId) return;
  const convs = db.prepare('SELECT id FROM conversations WHERE user_id = ? AND role = ?').all(userId, role);
  const del = db.prepare('DELETE FROM conversations WHERE id = ?');
  convs.forEach((c) => del.run(c.id));
}

// Long-lived "facts" a user explicitly wants remembered forever (e.g.
// "I struggle with calculus", "my son's roll number is 21CS045") —
// separate from rolling chat history, never auto-pruned.
function addFact(userId, fact) {
  if (!userId || !fact) return null;
  const id = uid();
  db.prepare('INSERT INTO memory_facts (id, user_id, fact) VALUES (?, ?, ?)').run(id, userId, String(fact).slice(0, 500));
  return { id, fact };
}

function getFacts(userId) {
  if (!userId) return [];
  return db.prepare('SELECT id, fact, created_at FROM memory_facts WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function deleteFact(userId, factId) {
  db.prepare('DELETE FROM memory_facts WHERE id = ? AND user_id = ?').run(factId, userId);
}

function formatContextForPrompt(userId, role) {
  const facts = getFacts(userId);
  const recent = getRecentContext(userId, role);
  let block = '';
  if (facts.length) {
    block += `\n\nThings this user has asked you to remember:\n- ${facts.map((f) => f.fact).join('\n- ')}`;
  }
  if (recent.length) {
    const lines = recent.map((m) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
    block += `\n\nRecent conversation history (for continuity, do not repeat verbatim):\n${lines.join('\n')}`;
  }
  return block;
}

module.exports = { saveTurn, getRecentContext, getHistory, clearMemory, addFact, getFacts, deleteFact, formatContextForPrompt };
