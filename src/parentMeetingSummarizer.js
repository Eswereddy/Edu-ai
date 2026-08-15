// AI ADMIN PORTAL ADD-ON (8/11) — AI Auto-Parent Meeting Summarizer
// Reads a faculty-parent chat log (pasted in by the caller — this
// environment has no live call-transcription pipeline) and generates
// a 1-page summary with clear outcomes/action items for the
// admin/principal. Optionally links to an existing meetings.js
// meeting_requests row for context, read-only. Fully additive — own
// table, own file, own routes.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropicJson } = require('./aiJsonHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS parent_meeting_summaries (
  id TEXT PRIMARY KEY,
  meeting_ref TEXT,
  student_name TEXT,
  chat_log TEXT NOT NULL,
  summary TEXT,
  outcomes_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pms_meetingref ON parent_meeting_summaries(meeting_ref);
`);

function uid() { return crypto.randomUUID(); }

async function summarize({ apiKey, model, chatLog, meetingRef, studentName, createdBy }) {
  if (!chatLog || String(chatLog).trim().length < 20) {
    throw Object.assign(new Error('chatLog must be at least 20 characters'), { status: 400 });
  }

  const ai = await callAnthropicJson({
    apiKey,
    model,
    system: 'Summarize a faculty-parent meeting chat log into a concise 1-page report for a school admin/principal. Return JSON: {"summary":"3-5 sentence narrative summary","outcomes":["action item 1","action item 2"]}.',
    prompt: `${studentName ? `Student: ${studentName}\n` : ''}Chat log:\n${String(chatLog).slice(0, 8000)}`,
    maxTokens: 700,
  });

  const result = ai.ok ? ai.data : { summary: 'AI summarization unavailable right now — please review the raw chat log.', outcomes: [] };

  const id = uid();
  db.prepare(
    `INSERT INTO parent_meeting_summaries (id, meeting_ref, student_name, chat_log, summary, outcomes_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, meetingRef || null, studentName || null, String(chatLog).slice(0, 6000), result.summary || null, JSON.stringify(result.outcomes || []), createdBy || null);

  return getSummary(id);
}

function getSummary(id) {
  const row = db.prepare('SELECT * FROM parent_meeting_summaries WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, outcomes: JSON.parse(row.outcomes_json || '[]') };
}

function listSummaries({ meetingRef } = {}) {
  const rows = meetingRef
    ? db.prepare('SELECT id, meeting_ref, student_name, summary, created_at FROM parent_meeting_summaries WHERE meeting_ref = ? ORDER BY created_at DESC').all(meetingRef)
    : db.prepare('SELECT id, meeting_ref, student_name, summary, created_at FROM parent_meeting_summaries ORDER BY created_at DESC').all();
  return rows;
}

module.exports = { summarize, getSummary, listSummaries };
