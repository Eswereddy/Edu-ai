// Parent-facing "Wellness & Mental Health Alerts" — read-only analysis
// layered on top of the existing student wellness data (wellness.js,
// untouched). Reads mood_checkins + student_goals through wellness.js's
// own exported functions and derives simple, explainable alerts (low
// mood average, consecutive low-mood streaks, check-in gaps) for a
// parent to see about a linked child. No writes, no new tables beyond
// nothing at all — this module owns no schema of its own.

const wellness = require('./wellness');
const parentChildren = require('./parentChildren');

function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeAlerts(history) {
  const alerts = [];
  if (!history.length) return alerts;

  const recent = history.slice(-7);
  const avgRecent = round1(recent.reduce((s, h) => s + h.mood_score, 0) / recent.length);
  if (avgRecent <= 2.2) {
    alerts.push({ level: 'high', message: `Average mood over the last ${recent.length} check-ins is low (${avgRecent}/5). Consider a gentle, supportive conversation.` });
  } else if (avgRecent <= 3) {
    alerts.push({ level: 'medium', message: `Mood has been trending on the lower side recently (${avgRecent}/5).` });
  }

  let streak = 0;
  let maxStreak = 0;
  for (const h of history) {
    if (h.mood_score <= 2) { streak += 1; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  if (maxStreak >= 3) {
    alerts.push({ level: 'high', message: `${maxStreak} consecutive low-mood check-ins detected — this pattern may be worth checking in on.` });
  }

  if (history.length > 0 && history.length < 10) {
    alerts.push({ level: 'low', message: 'Only a few wellness check-ins logged recently — gently encourage regular check-ins for a fuller picture.' });
  }

  return alerts;
}

function wellnessForChild(parentUser, studentId) {
  const childIds = parentChildren.resolveChildrenIds(parentUser);
  if (!childIds.includes(studentId)) {
    const err = new Error('Not authorized for this student');
    err.status = 403;
    throw err;
  }
  const history = wellness.moodHistory(studentId, 30);
  const goals = wellness.listGoals(studentId);
  const avgOverall = history.length ? round1(history.reduce((s, h) => s + h.mood_score, 0) / history.length) : null;

  return {
    generatedAt: new Date().toISOString(),
    checkinCount: history.length,
    averageMood: avgOverall,
    history,
    goals,
    alerts: computeAlerts(history),
  };
}

module.exports = { wellnessForChild };
