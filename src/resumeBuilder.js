// AI Resume Builder: turns a student's profile into a structured,
// ATS-friendly resume via the same Anthropic client the rest of the app
// already uses, plus a heuristic ATS checker (works even with no API key
// configured, so the feature degrades gracefully rather than breaking).

const { callAnthropic, UpstreamAIError } = require('./anthropicClient');

const ACTION_VERBS = [
  'built', 'built,', 'developed', 'designed', 'implemented', 'led', 'created', 'optimized',
  'improved', 'automated', 'launched', 'engineered', 'architected', 'reduced', 'increased',
  'deployed', 'integrated', 'analyzed', 'mentored', 'delivered', 'shipped', 'trained',
];

function safeJsonParse(text) {
  try {
    const cleaned = String(text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (_e) {
    return null;
  }
}

// Deterministic fallback if there's no API key or the model call fails —
// so "Generate Resume" never just breaks with an error screen.
function assembleFallback(profile, targetRole) {
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const experience = Array.isArray(profile.experience) ? profile.experience : [];
  const education = Array.isArray(profile.education) ? profile.education : [];
  const certifications = Array.isArray(profile.certifications) ? profile.certifications : [];

  return {
    name: profile.name || 'Your Name',
    contact: {
      email: profile.email || '',
      phone: profile.phone || '',
      linkedin: profile.linkedin || '',
      github: profile.github || '',
      portfolio: profile.portfolio || '',
      location: profile.location || '',
    },
    summary:
      profile.summary ||
      `${targetRole ? targetRole + ' focused' : 'Motivated'} ${profile.degree || 'engineering'} student with hands-on project experience in ${skills.slice(0, 4).join(', ') || 'software development'}.`,
    skills,
    experience: experience.map((e) => ({
      title: e.title || e.role || 'Role',
      org: e.org || e.company || '',
      dates: e.dates || '',
      bullets: Array.isArray(e.bullets) ? e.bullets : e.description ? [e.description] : [],
    })),
    projects: projects.map((p) => ({
      name: p.name || 'Project',
      dates: p.dates || '',
      bullets: Array.isArray(p.bullets) ? p.bullets : p.description ? [p.description] : [],
      tech: p.tech || p.stack || '',
    })),
    education: education.map((ed) => ({
      degree: ed.degree || '',
      institution: ed.institution || ed.college || '',
      dates: ed.dates || '',
      score: ed.score || ed.cgpa || '',
    })),
    certifications,
  };
}

/**
 * Uses the model to draft resume copy (summary + punchy, quantified bullet
 * points) from raw profile facts. Falls back to a deterministic assembly
 * if no API key is configured or the call fails, so the feature always
 * returns something usable.
 */
async function generateResumeContent({ apiKey, model, profile, targetRole }) {
  const fallback = assembleFallback(profile || {}, targetRole);
  if (!apiKey) return { content: fallback, aiGenerated: false };

  const system = `You are an expert resume writer for engineering students and new grads. Rewrite the given raw profile facts into a concise, ATS-friendly resume. Use strong action verbs, quantify impact wherever plausible from the given facts (do not invent numbers that contradict given facts), and keep bullets to one line each. Respond with ONLY valid JSON matching this exact shape, no markdown fences, no preamble:
{
  "name": string,
  "contact": {"email": string, "phone": string, "linkedin": string, "github": string, "portfolio": string, "location": string},
  "summary": string (2-3 sentences, tailored to the target role if given),
  "skills": string[],
  "experience": [{"title": string, "org": string, "dates": string, "bullets": string[]}],
  "projects": [{"name": string, "dates": string, "bullets": string[], "tech": string}],
  "education": [{"degree": string, "institution": string, "dates": string, "score": string}],
  "certifications": string[]
}`;

  const userMsg = `Target role: ${targetRole || '(general software engineering)'}\n\nRaw profile facts (JSON):\n${JSON.stringify(profile, null, 2)}`;

  try {
    const text = await callAnthropic({
      apiKey,
      model,
      system,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0.4,
      maxTokens: 1200,
    });
    const parsed = safeJsonParse(text);
    if (parsed && parsed.name) return { content: parsed, aiGenerated: true };
    return { content: fallback, aiGenerated: false };
  } catch (error) {
    if (error instanceof UpstreamAIError) {
      return { content: fallback, aiGenerated: false, warning: error.message };
    }
    throw error;
  }
}

/**
 * Heuristic ATS-style check — no model call required, so it's instant and
 * free. Scores 0-100 across common resume-screening signals and returns
 * concrete, actionable feedback.
 */
function checkResumeAts(content, jobDescription) {
  const issues = [];
  const wins = [];
  let score = 100;

  const allBullets = [
    ...(content.experience || []).flatMap((e) => e.bullets || []),
    ...(content.projects || []).flatMap((p) => p.bullets || []),
  ];
  const bulletText = allBullets.join(' ').toLowerCase();

  // Contact completeness
  const contact = content.contact || {};
  const missingContact = ['email', 'phone'].filter((k) => !contact[k]);
  if (missingContact.length) {
    score -= 10 * missingContact.length;
    issues.push(`Missing ${missingContact.join(' and ')} in contact info — many ATS parsers reject resumes without both.`);
  } else {
    wins.push('Contact info complete (email + phone present).');
  }

  // Summary present
  if (!content.summary || content.summary.length < 40) {
    score -= 8;
    issues.push('Summary is missing or too short — aim for 2-3 tailored sentences at the top.');
  } else {
    wins.push('Has a tailored summary section.');
  }

  // Quantified achievements
  const numberBullets = allBullets.filter((b) => /\d/.test(b)).length;
  if (allBullets.length && numberBullets / allBullets.length < 0.3) {
    score -= 15;
    issues.push('Few bullets contain numbers — quantify impact (%, time saved, users, scale) wherever possible.');
  } else if (allBullets.length) {
    wins.push('Good use of quantified, measurable bullets.');
  }

  // Action verbs
  const startsWithVerb = allBullets.filter((b) => ACTION_VERBS.some((v) => b.toLowerCase().trim().startsWith(v))).length;
  if (allBullets.length && startsWithVerb / allBullets.length < 0.5) {
    score -= 12;
    issues.push('Many bullets don\'t open with a strong action verb (Built, Led, Designed, Optimized...).');
  } else if (allBullets.length) {
    wins.push('Bullets consistently lead with strong action verbs.');
  }

  // Bullet length (too long = not scannable)
  const longBullets = allBullets.filter((b) => b.split(' ').length > 28).length;
  if (longBullets > 0) {
    score -= Math.min(10, longBullets * 2);
    issues.push(`${longBullets} bullet(s) are too long — keep each to roughly one line (under ~25 words).`);
  }

  // Skills section
  if (!content.skills || content.skills.length < 4) {
    score -= 10;
    issues.push('Skills section is thin — list 6-12 specific technologies/tools ATS keyword scanners look for.');
  } else {
    wins.push('Skills section has good keyword coverage.');
  }

  // Overall length (too short = under-filled, too long = 2nd page for a fresher)
  const totalBulletWords = allBullets.reduce((sum, b) => sum + b.split(' ').length, 0);
  if (totalBulletWords < 40) {
    score -= 10;
    issues.push('Resume content looks sparse — add more project/experience detail.');
  }

  // Job-description keyword match (optional)
  let keywordMatch = null;
  if (jobDescription && jobDescription.trim()) {
    const jdWords = new Set(
      jobDescription
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );
    const resumeWords = new Set(
      `${bulletText} ${(content.skills || []).join(' ')} ${content.summary || ''}`
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
    );
    const overlap = [...jdWords].filter((w) => resumeWords.has(w));
    keywordMatch = {
      matchedPercent: jdWords.size ? Math.round((overlap.length / jdWords.size) * 100) : 0,
      matchedKeywords: overlap.slice(0, 20),
      missingKeywords: [...jdWords].filter((w) => !resumeWords.has(w)).slice(0, 15),
    };
    if (keywordMatch.matchedPercent < 40) {
      score -= 15;
      issues.push(`Only ${keywordMatch.matchedPercent}% keyword overlap with the target job description — mirror more of its terminology.`);
    } else {
      wins.push(`${keywordMatch.matchedPercent}% keyword overlap with the target job description.`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, wins, issues, keywordMatch };
}

module.exports = { generateResumeContent, checkResumeAts, assembleFallback };
