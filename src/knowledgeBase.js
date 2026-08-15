// A small, dependency-free "RAG" knowledge base.
//
// The frontend's callBackendAiBridge() sends { useRag, ragTopK, query, role }.
// Rather than standing up a vector database for a prototype, this module does
// simple keyword-overlap retrieval over a curated set of platform facts, one
// set per portal ("phase"). It's cheap, has zero external dependencies, and
// is easy to extend — add more entries as the real policies get finalized.
//
// Swap this out for a real vector store (pgvector, Pinecone, etc.) later by
// keeping the same retrieve(role, query, topK) -> string[] contract.

const KB = {
  student: [
    'Minimum attendance requirement to sit for semester exams is 75%.',
    'CGPA is calculated on a 10-point scale across all completed semesters.',
    'Backlog papers must be cleared within the next two subsequent semesters.',
    'Fee payment deadlines are typically the 10th of the month a semester starts; late payment incurs a fine.',
    'Students can request official documents (bonafide, transcript, migration certificate) through Document Services.',
  ],
  faculty: [
    'Faculty must mark daily attendance before 6 PM; unmarked days are flagged in Attendance Mgmt.',
    'Continuous assessment (internal marks) typically covers assignments, quizzes, and mid-term exams.',
    'Mentorship load is usually 10-15 students per faculty mentor per semester.',
    'Research publication metadata should be logged under Research & Publications for institutional reporting.',
    'Feedback and analytics scores below 3.5/5 typically trigger a teaching-effectiveness review.',
  ],
  parent: [
    'Parents can view attendance, marks, and fee status in real time through the Parent Portal.',
    'Attendance below 75% typically triggers an automatic notification to the registered parent contact.',
    'Fee payment can be made online through the Fee Payment section; receipts are auto-generated.',
    'Quiet hours can be configured so non-urgent notifications are held until a preferred window.',
  ],
  admin: [
    'Institutional dashboards aggregate attendance, CGPA, and fee-collection trends across departments.',
    'Fee defaulters are typically flagged after 30 days overdue for administrative follow-up.',
    'Scholarship and waiver approvals should be logged for audit purposes.',
    'Cross-department risk summaries help prioritize which student cohorts need intervention.',
  ],
  'ai-admin': [
    'AI governance covers model performance monitoring, provider failover, and response quality checks.',
    'Dropout-risk prediction combines attendance trend, CGPA trend, and fee-payment delays as leading indicators.',
    'Skill roadmaps and task generation should stay role-appropriate (student vs faculty vs parent tone).',
    'AI API Settings controls which providers/models are used and whether the secure backend bridge is active.',
  ],
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function scoreOverlap(queryTokens, doc) {
  const docTokens = new Set(tokenize(doc));
  let hits = 0;
  for (const t of queryTokens) if (docTokens.has(t)) hits += 1;
  return hits;
}

/**
 * Retrieve up to topK relevant knowledge snippets for a role + query.
 * Falls back to the first few role facts if nothing scores > 0, so the
 * model still gets some grounding context rather than none.
 */
function retrieve(role, query, topK = 4) {
  const docs = KB[role] || KB.student;
  const queryTokens = tokenize(query);
  const scored = docs
    .map((doc) => ({ doc, score: scoreOverlap(queryTokens, doc) }))
    .sort((a, b) => b.score - a.score);

  const withHits = scored.filter((s) => s.score > 0).slice(0, topK);
  if (withHits.length) return withHits.map((s) => s.doc);
  return docs.slice(0, Math.min(topK, docs.length));
}

module.exports = { retrieve, KB };
