// AI Study Tool: text summarizer and Mermaid flow/diagram generator.
// Quiz generation already exists (quiz.js's AI-draft-questions) and the
// weekly planner already exists (studyPlanner.js / /api/study-plan) —
// both untouched. This fills the two missing pieces. Fully additive —
// own table, own file.

const crypto = require('crypto');
const { db } = require('./db');
const { callAnthropic } = require('./anthropicClient');

db.exec(`
CREATE TABLE IF NOT EXISTS study_tool_outputs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  tool_type TEXT NOT NULL CHECK(tool_type IN ('summary','diagram')),
  input_text TEXT,
  output TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_study_tool_student ON study_tool_outputs(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

async function summarize({ apiKey, model, studentId, text, length }) {
  if (!text || String(text).trim().length < 20) {
    throw Object.assign(new Error('text (at least 20 characters) is required'), { status: 400 });
  }
  const targetLength = ['short', 'medium', 'long'].includes(length) ? length : 'medium';
  const wordTarget = { short: '~60 words', medium: '~150 words', long: '~300 words' }[targetLength];

  let output;
  let aiGenerated = false;
  try {
    output = await callAnthropic({
      apiKey,
      model,
      system: `You summarize study material for a student. Plain text, no markdown, ${wordTarget}, focused on the key concepts a student should remember for an exam.`,
      messages: [{ role: 'user', content: String(text).slice(0, 12000) }],
      temperature: 0.3,
      maxTokens: 600,
    });
    aiGenerated = true;
  } catch (e) {
    // Deterministic fallback: first few sentences, trimmed.
    const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
    output = sentences.slice(0, 3).join(' ');
  }

  const id = uid();
  db.prepare(`INSERT INTO study_tool_outputs (id, student_id, tool_type, input_text, output, ai_generated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, studentId, 'summary', String(text).slice(0, 4000), output, aiGenerated ? 1 : 0);
  return { id, aiGenerated, summary: output };
}

async function generateDiagram({ apiKey, model, studentId, topic, diagramType }) {
  if (!topic) throw Object.assign(new Error('topic is required'), { status: 400 });
  const type = ['flowchart', 'sequence', 'mindmap'].includes(diagramType) ? diagramType : 'flowchart';

  let mermaid;
  let aiGenerated = false;
  try {
    const text = await callAnthropic({
      apiKey,
      model,
      system: `Produce a single valid Mermaid.js ${type === 'flowchart' ? 'flowchart (graph TD)' : type === 'sequence' ? 'sequenceDiagram' : 'mindmap'} diagram explaining the given study topic. Reply with ONLY the raw Mermaid code, no markdown fences, no prose.`,
      messages: [{ role: 'user', content: topic }],
      temperature: 0.3,
      maxTokens: 500,
    });
    mermaid = text.replace(/```mermaid|```/g, '').trim();
    aiGenerated = true;
  } catch (e) {
    mermaid = `graph TD\n  A["${String(topic).slice(0, 40)}"] --> B["Key concept 1"]\n  A --> C["Key concept 2"]\n  A --> D["Key concept 3"]`;
  }

  const id = uid();
  db.prepare(`INSERT INTO study_tool_outputs (id, student_id, tool_type, input_text, output, ai_generated) VALUES (?, ?, ?, ?, ?)`)
    .run(id, studentId, 'diagram', topic, mermaid, aiGenerated ? 1 : 0);
  return { id, aiGenerated, diagramType: type, mermaid };
}

function history(studentId, { toolType } = {}) {
  const rows = toolType
    ? db.prepare('SELECT * FROM study_tool_outputs WHERE student_id = ? AND tool_type = ? ORDER BY created_at DESC').all(studentId, toolType)
    : db.prepare('SELECT * FROM study_tool_outputs WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
  return rows;
}

module.exports = { summarize, generateDiagram, history };
