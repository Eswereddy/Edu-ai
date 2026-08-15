// AI governance & analytics: read-only visibility into how the AI
// features of the platform are actually being used — conversation/
// message volume by role, knowledge-base coverage, and a live preview
// of what src/rag.js's retrieve() would return for a given role+query
// (handy for an AI administrator tuning KB content without needing to
// fire an actual model call). Every function here reads through
// rag.js's existing exports or does a plain SELECT on the
// conversations/messages/kb_entries tables that memory.js and rag.js
// already own and write to — nothing in either module is changed, and
// no model call is ever made by this module.

const { db } = require('./db');
const rag = require('./rag');
const { ROLE_PROMPTS } = require('./rolePrompts');

const ROLES = ['student', 'faculty', 'parent', 'admin', 'ai-admin'];

function usageByRole() {
  return ROLES.map((role) => {
    const conv = db.prepare('SELECT COUNT(*) c FROM conversations WHERE role = ?').get(role).c;
    const msgs = db
      .prepare(`SELECT COUNT(*) c FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE role = ?)`)
      .get(role).c;
    const activeUsers = db.prepare('SELECT COUNT(DISTINCT user_id) c FROM conversations WHERE role = ?').get(role).c;
    return { role, conversations: conv, messages: msgs, activeUsers };
  });
}

function mostActiveUsers(limit = 10) {
  const cap = Math.max(1, Math.min(50, Number(limit) || 10));
  return db
    .prepare(
      `SELECT u.id, u.name, u.role, COUNT(m.id) as messageCount
       FROM conversations c
       JOIN users u ON u.id = c.user_id
       JOIN messages m ON m.conversation_id = c.id
       GROUP BY u.id
       ORDER BY messageCount DESC
       LIMIT ?`
    )
    .all(cap);
}

function kbCoverage() {
  return ROLES.map((role) => {
    const entries = rag.listKbEntries(role);
    const tagCounts = {};
    for (const e of entries) {
      const tags = (e.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
      for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    return { role, entryCount: entries.length, tags: tagCounts };
  });
}

function memoryFactsByRole() {
  // memory_facts isn't role-scoped itself (it's per-user, portal-agnostic),
  // so this reports counts grouped by the fact-owner's account role.
  return db
    .prepare(
      `SELECT u.role, COUNT(f.id) as factCount
       FROM memory_facts f JOIN users u ON u.id = f.user_id
       GROUP BY u.role`
    )
    .all();
}

// Live RAG preview: shows an AI administrator exactly which KB snippets
// retrieve() would inject for a given role+query, without spending a
// model call. Pure read — calls the existing retrieve() unchanged.
function previewRetrieval(role, query, topK = 4) {
  if (!query || !String(query).trim()) {
    const err = new Error('query is required');
    err.status = 400;
    throw err;
  }
  const snippets = rag.retrieve(role, String(query).trim(), Math.max(1, Math.min(8, Number(topK) || 4)));
  return { role, query, snippets };
}

function rolePromptsOverview() {
  return ROLE_PROMPTS;
}

function overview() {
  return {
    generatedAt: new Date().toISOString(),
    usageByRole: usageByRole(),
    mostActiveUsers: mostActiveUsers(5),
    kbCoverage: kbCoverage(),
    memoryFactsByRole: memoryFactsByRole(),
  };
}

module.exports = { overview, usageByRole, mostActiveUsers, kbCoverage, memoryFactsByRole, previewRetrieval, rolePromptsOverview };
