// AI memory governance: lets an AI administrator look up or clear a
// specific user's AI memory (conversation history + long-term facts)
// for compliance/privacy requests (e.g. "delete everything the AI
// remembers about me" under a data-protection request) or to
// investigate a reported issue. Every function here is a thin,
// audited wrapper around memory.js's existing exports
// (getHistory/getFacts/clearMemory/deleteFact) — those functions
// already accepted an arbitrary userId argument by design; this module
// doesn't change memory.js, it just gives an authorized admin a way to
// call them for someone other than themselves, with every access
// logged to the audit trail for accountability.

const { db } = require('./db');
const memory = require('./memory');
const audit = require('./audit');

function findUser(userId) {
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId);
}

function inspectUser(userId, actingAdminId) {
  const user = findUser(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const byRole = ['student', 'faculty', 'parent', 'admin', 'ai-admin'].map((role) => ({
    role,
    history: memory.getHistory(userId, role),
  })).filter((r) => r.history.length);

  const facts = memory.getFacts(userId);

  audit.record(actingAdminId, 'view', 'user_memory', userId, { historyRoles: byRole.map((r) => r.role), factCount: facts.length });

  return { user, conversationsByRole: byRole, facts };
}

function clearUserMemory(userId, role, actingAdminId) {
  const user = findUser(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!role) {
    const err = new Error('role is required (which portal history to clear)');
    err.status = 400;
    throw err;
  }
  memory.clearMemory(userId, role);
  audit.record(actingAdminId, 'clear', 'user_memory', userId, { role });
  return { userId, role, cleared: true };
}

function deleteUserFact(userId, factId, actingAdminId) {
  const user = findUser(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  memory.deleteFact(userId, factId);
  audit.record(actingAdminId, 'delete', 'user_memory_fact', factId, { userId });
  return { userId, factId, deleted: true };
}

module.exports = { inspectUser, clearUserMemory, deleteUserFact };
