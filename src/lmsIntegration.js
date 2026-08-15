// FACULTY PORTAL — Real LMS Integration (Moodle / Canvas).
//
// Replaces the old "Connect LMS" button, which just called
// `alert('LMS sync simulated...')`. This module makes real, documented
// API calls against a faculty member's actual Moodle or Canvas instance:
//
//  Canvas — real OAuth2 Authorization Code flow (the standard Canvas API
//  auth mechanism, see https://canvas.instructure.com/doc/api/file.oauth.html):
//    GET  {instanceUrl}/login/oauth2/auth   (authorize, browser redirect)
//    POST {instanceUrl}/login/oauth2/token  (code -> access/refresh token)
//  Requires CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET (a "Developer Key"
//  registered on the Canvas instance by its admin) and APP_BASE_URL in
//  the backend's environment.
//
//  Moodle — Moodle core does not expose a generic third-party OAuth2
//  *authorize* screen the way Canvas does (its OAuth2 support is for
//  Moodle acting as an OAuth2 *client* of Google/Microsoft for login,
//  not the reverse). The real, documented way an external system
//  authenticates against a Moodle site's API is a Web Services token
//  (https://docs.moodle.org/dev/Creating_a_web_service_client):
//    GET {instanceUrl}/login/token.php?username=..&password=..&service=..
//  which the Moodle admin enables per external service. That is what is
//  implemented here — it is Moodle's real integration mechanism, not a
//  placeholder.
//
// Grade/assignment sync then uses real, stable endpoints on each side —
// see syncCanvas()/syncMoodle() below for the exact calls and their
// documented real-world limits (e.g. Moodle's public web services do not
// support creating new assignment activities, only grading existing
// ones — so Moodle sync maps to an existing Moodle assignment rather
// than fabricating one).
const crypto = require('crypto');
const { db } = require('./db');
const assignments = require('./assignments');

db.exec(`
CREATE TABLE IF NOT EXISTS lms_connections (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('canvas','moodle')),
  instance_url TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  ws_token TEXT,
  external_user_id TEXT,
  external_user_name TEXT,
  external_user_email TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','disconnected')),
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,
  UNIQUE(faculty_id, provider)
);

CREATE TABLE IF NOT EXISTS lms_course_links (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES lms_connections(id) ON DELETE CASCADE,
  class_section TEXT NOT NULL,
  subject TEXT,
  external_course_id TEXT NOT NULL,
  external_course_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(connection_id, class_section, subject)
);

CREATE TABLE IF NOT EXISTS lms_assignment_links (
  id TEXT PRIMARY KEY,
  course_link_id TEXT NOT NULL REFERENCES lms_course_links(id) ON DELETE CASCADE,
  local_assignment_id TEXT NOT NULL,
  external_assignment_id TEXT NOT NULL,
  external_cmid TEXT,
  external_assignment_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(course_link_id, local_assignment_id)
);

CREATE TABLE IF NOT EXISTS lms_sync_logs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES lms_connections(id) ON DELETE CASCADE,
  class_section TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  items_synced INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function uid() {
  return crypto.randomUUID();
}

function envConfig() {
  return {
    canvasClientId: process.env.CANVAS_CLIENT_ID || '',
    canvasClientSecret: process.env.CANVAS_CLIENT_SECRET || '',
    appBaseUrl: (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4111}`).replace(/\/$/, ''),
    moodleDefaultService: process.env.MOODLE_SERVICE_SHORTNAME || 'moodle_mobile_app',
  };
}

function cleanInstanceUrl(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    const err = new Error('LMS instance URL must start with http:// or https://');
    err.status = 400;
    throw err;
  }
  return u;
}

// ---------------------------------------------------------------------
// In-memory OAuth "state" store for the Canvas authorize-code round
// trip (short-lived, single-use, cleared on use/expiry — no need for a
// DB table for this).
// ---------------------------------------------------------------------
const pendingOAuthState = new Map();
function putState(facultyId, instanceUrl) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthState.set(state, { facultyId, instanceUrl, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}
function takeState(state) {
  const entry = pendingOAuthState.get(state);
  pendingOAuthState.delete(state);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

// ============================== CANVAS ===============================

function canvasRedirectUri() {
  return `${envConfig().appBaseUrl}/api/lms/canvas/callback`;
}

function buildCanvasAuthorizeUrl({ facultyId, instanceUrl }) {
  const { canvasClientId } = envConfig();
  if (!canvasClientId) {
    const err = new Error(
      'Canvas OAuth is not configured on this server yet — an admin needs to register a Developer Key on the Canvas instance and set CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET / APP_BASE_URL in the backend environment.'
    );
    err.status = 400;
    throw err;
  }
  const url = cleanInstanceUrl(instanceUrl);
  const state = putState(facultyId, url);
  const authorizeUrl = new URL('/login/oauth2/auth', url);
  authorizeUrl.searchParams.set('client_id', canvasClientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', canvasRedirectUri());
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'url:GET|/api/v1/courses url:POST|/api/v1/courses/:course_id/assignments url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id url:GET|/api/v1/courses/:course_id/users');
  return authorizeUrl.toString();
}

async function exchangeCanvasCode({ state, code }) {
  const entry = takeState(state);
  if (!entry) {
    const err = new Error('This Canvas connect link expired or was already used — please try connecting again.');
    err.status = 400;
    throw err;
  }
  const { canvasClientId, canvasClientSecret } = envConfig();
  const tokenRes = await fetch(new URL('/login/oauth2/token', entry.instanceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: canvasClientId,
      client_secret: canvasClientSecret,
      redirect_uri: canvasRedirectUri(),
      code,
    }),
  });
  const body = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !body.access_token) {
    const err = new Error(body.error_description || body.error || 'Canvas rejected the OAuth code exchange');
    err.status = 502;
    throw err;
  }

  // Confirm the token works and grab the connected identity for display.
  let who = { id: null, name: null, email: null };
  try {
    const meRes = await fetch(new URL('/api/v1/users/self', entry.instanceUrl), {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      who = { id: String(me.id || ''), name: me.name || null, email: me.email || me.primary_email || null };
    }
  } catch (_e) {
    // Non-fatal — connection is still valid even if the profile read fails.
  }

  const expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null;
  return upsertConnection({
    facultyId: entry.facultyId,
    provider: 'canvas',
    instanceUrl: entry.instanceUrl,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    tokenExpiresAt: expiresAt,
    externalUserId: who.id,
    externalUserName: who.name,
    externalUserEmail: who.email,
  });
}

async function refreshCanvasTokenIfNeeded(connection) {
  if (connection.provider !== 'canvas' || !connection.token_expires_at) return connection;
  if (new Date(connection.token_expires_at).getTime() - Date.now() > 60 * 1000) return connection;
  if (!connection.refresh_token) return connection; // nothing we can do; caller's request may still fail with 401

  const { canvasClientId, canvasClientSecret } = envConfig();
  const res = await fetch(new URL('/login/oauth2/token', connection.instance_url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: canvasClientId,
      client_secret: canvasClientSecret,
      refresh_token: connection.refresh_token,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return connection; // keep old token, let the caller's call fail naturally
  const expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null;
  db.prepare(`UPDATE lms_connections SET access_token = ?, token_expires_at = ? WHERE id = ?`).run(
    body.access_token,
    expiresAt,
    connection.id
  );
  return { ...connection, access_token: body.access_token, token_expires_at: expiresAt };
}

// ============================== MOODLE ================================

async function connectMoodle({ facultyId, instanceUrl, username, password, service }) {
  const url = cleanInstanceUrl(instanceUrl);
  const svc = service || envConfig().moodleDefaultService;
  if (!username || !password) {
    const err = new Error('Moodle username and password are required to request a web service token');
    err.status = 400;
    throw err;
  }

  const tokenUrl = new URL('/login/token.php', url);
  tokenUrl.searchParams.set('username', username);
  tokenUrl.searchParams.set('password', password);
  tokenUrl.searchParams.set('service', svc);
  const tokenRes = await fetch(tokenUrl, { method: 'POST' });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenBody.token) {
    const err = new Error(
      tokenBody.error ||
        'Moodle did not return a web service token. Ask the Moodle admin to enable "Web services" + the REST protocol, and enable this account for the configured external service.'
    );
    err.status = 502;
    throw err;
  }

  const siteInfo = await moodleCall(url, tokenBody.token, 'core_webservice_get_site_info', {});
  if (siteInfo.exception) {
    const err = new Error(siteInfo.message || 'Moodle rejected the web service token');
    err.status = 502;
    throw err;
  }

  return upsertConnection({
    facultyId,
    provider: 'moodle',
    instanceUrl: url,
    wsToken: tokenBody.token,
    externalUserId: String(siteInfo.userid || ''),
    externalUserName: siteInfo.fullname || username,
    externalUserEmail: siteInfo.useremail || null,
  });
}

// Generic Moodle REST caller. Moodle's REST protocol takes wstoken +
// wsfunction + moodlewsrestformat=json plus function-specific params,
// where arrays/objects use PHP-style bracket query keys
// (e.g. courseids[0]=5, grades[0][studentid]=7).
function flattenMoodleParams(params, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(params || {})) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => out.push(...flattenMoodleParams({ [i]: v }, paramKey)));
    } else if (value && typeof value === 'object') {
      out.push(...flattenMoodleParams(value, paramKey));
    } else if (value !== undefined && value !== null) {
      out.push([paramKey, String(value)]);
    }
  }
  return out;
}

async function moodleCall(instanceUrl, wstoken, wsfunction, params) {
  const body = new URLSearchParams([
    ['wstoken', wstoken],
    ['wsfunction', wsfunction],
    ['moodlewsrestformat', 'json'],
    ...flattenMoodleParams(params),
  ]);
  const res = await fetch(new URL('/webservice/rest/server.php', instanceUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json().catch(() => ({ exception: 'invalidresponse', message: 'Moodle returned a non-JSON response' }));
}

// ============================= SHARED =================================

function upsertConnection({
  facultyId,
  provider,
  instanceUrl,
  accessToken,
  refreshToken,
  tokenExpiresAt,
  wsToken,
  externalUserId,
  externalUserName,
  externalUserEmail,
}) {
  const existing = db
    .prepare('SELECT id FROM lms_connections WHERE faculty_id = ? AND provider = ?')
    .get(facultyId, provider);
  if (existing) {
    db.prepare(
      `UPDATE lms_connections SET instance_url = ?, access_token = ?, refresh_token = ?, token_expires_at = ?, ws_token = ?,
        external_user_id = ?, external_user_name = ?, external_user_email = ?, status = 'connected', connected_at = datetime('now')
       WHERE id = ?`
    ).run(
      instanceUrl,
      accessToken || null,
      refreshToken || null,
      tokenExpiresAt || null,
      wsToken || null,
      externalUserId || null,
      externalUserName || null,
      externalUserEmail || null,
      existing.id
    );
    return getConnection(facultyId, provider);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO lms_connections (id, faculty_id, provider, instance_url, access_token, refresh_token, token_expires_at, ws_token, external_user_id, external_user_name, external_user_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    facultyId,
    provider,
    instanceUrl,
    accessToken || null,
    refreshToken || null,
    tokenExpiresAt || null,
    wsToken || null,
    externalUserId || null,
    externalUserName || null,
    externalUserEmail || null
  );
  return getConnection(facultyId, provider);
}

function safeConnection(row) {
  if (!row) return null;
  // Never send raw tokens to the frontend.
  const { access_token, refresh_token, ws_token, ...rest } = row;
  return { ...rest, hasToken: Boolean(access_token || ws_token) };
}

function getConnection(facultyId, provider) {
  return db
    .prepare(`SELECT * FROM lms_connections WHERE faculty_id = ? AND provider = ? AND status = 'connected'`)
    .get(facultyId, provider);
}

function listConnections(facultyId) {
  return db
    .prepare(`SELECT * FROM lms_connections WHERE faculty_id = ? ORDER BY provider`)
    .all(facultyId)
    .map(safeConnection);
}

function disconnect(facultyId, provider) {
  const res = db
    .prepare(`UPDATE lms_connections SET status = 'disconnected' WHERE faculty_id = ? AND provider = ?`)
    .run(facultyId, provider);
  return { ok: true, changed: res.changes > 0 };
}

function requireConnection(facultyId, provider) {
  const conn = getConnection(facultyId, provider);
  if (!conn) {
    const err = new Error(`Not connected to ${provider} yet`);
    err.status = 400;
    throw err;
  }
  return conn;
}

// -------------------------- Course listing/linking ---------------------

async function listExternalCourses(facultyId, provider) {
  const conn = requireConnection(facultyId, provider);
  if (provider === 'canvas') {
    const fresh = await refreshCanvasTokenIfNeeded(conn);
    const res = await fetch(new URL('/api/v1/courses?enrollment_type=teacher&per_page=100', fresh.instance_url), {
      headers: { Authorization: `Bearer ${fresh.access_token}` },
    });
    const body = await res.json().catch(() => []);
    if (!res.ok) {
      const err = new Error(body?.errors?.[0]?.message || 'Failed to list Canvas courses');
      err.status = res.status;
      throw err;
    }
    return (Array.isArray(body) ? body : []).map((c) => ({ id: String(c.id), name: c.name || c.course_code }));
  }
  // moodle
  const courses = await moodleCall(conn.instance_url, conn.ws_token, 'core_enrol_get_users_courses', {
    userid: conn.external_user_id,
  });
  if (courses?.exception) {
    const err = new Error(courses.message || 'Failed to list Moodle courses');
    err.status = 502;
    throw err;
  }
  return (Array.isArray(courses) ? courses : []).map((c) => ({ id: String(c.id), name: c.fullname || c.shortname }));
}

function linkCourse({ facultyId, provider, classSection, subject, externalCourseId, externalCourseName }) {
  const conn = requireConnection(facultyId, provider);
  const id = uid();
  db.prepare(
    `INSERT INTO lms_course_links (id, connection_id, class_section, subject, external_course_id, external_course_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, class_section, subject) DO UPDATE SET
       external_course_id = excluded.external_course_id, external_course_name = excluded.external_course_name`
  ).run(id, conn.id, classSection, subject || '', externalCourseId, externalCourseName || null);
  return db.prepare('SELECT * FROM lms_course_links WHERE connection_id = ? AND class_section = ? AND subject = ?').get(
    conn.id,
    classSection,
    subject || ''
  );
}

function listCourseLinks(facultyId, provider) {
  const conn = getConnection(facultyId, provider);
  if (!conn) return [];
  return db.prepare('SELECT * FROM lms_course_links WHERE connection_id = ?').all(conn.id);
}

async function listMoodleAssignmentsForCourse(facultyId, moodleCourseId) {
  const conn = requireConnection(facultyId, 'moodle');
  const result = await moodleCall(conn.instance_url, conn.ws_token, 'mod_assign_get_assignments', {
    courseids: [moodleCourseId],
  });
  if (result?.exception) {
    const err = new Error(result.message || 'Failed to list Moodle assignments');
    err.status = 502;
    throw err;
  }
  const course = (result.courses || []).find((c) => String(c.id) === String(moodleCourseId));
  return (course?.assignments || []).map((a) => ({ id: String(a.id), cmid: String(a.cmid), name: a.name }));
}

function linkAssignment({ courseLinkId, localAssignmentId, externalAssignmentId, externalCmid, externalAssignmentName }) {
  const id = uid();
  db.prepare(
    `INSERT INTO lms_assignment_links (id, course_link_id, local_assignment_id, external_assignment_id, external_cmid, external_assignment_name)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(course_link_id, local_assignment_id) DO UPDATE SET
       external_assignment_id = excluded.external_assignment_id, external_cmid = excluded.external_cmid, external_assignment_name = excluded.external_assignment_name`
  ).run(id, courseLinkId, localAssignmentId, externalAssignmentId, externalCmid || null, externalAssignmentName || null);
}

function logSync({ connectionId, classSection, subject, status, itemsSynced, itemsFailed, message }) {
  db.prepare(
    `INSERT INTO lms_sync_logs (id, connection_id, class_section, subject, status, items_synced, items_failed, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(), connectionId, classSection || null, subject || null, status, itemsSynced || 0, itemsFailed || 0, message || null);
  db.prepare(`UPDATE lms_connections SET last_synced_at = datetime('now') WHERE id = ?`).run(connectionId);
}

function listSyncLogs(facultyId, provider, limit = 10) {
  const conn = getConnection(facultyId, provider) || db.prepare('SELECT * FROM lms_connections WHERE faculty_id = ? AND provider = ?').get(facultyId, provider);
  if (!conn) return [];
  const cap = Math.max(1, Math.min(50, Number(limit) || 10));
  return db.prepare('SELECT * FROM lms_sync_logs WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?').all(conn.id, cap);
}

// ------------------------------ Sync ------------------------------------

function localAssignmentsFor(facultyId, classSection, subject) {
  let list = assignments.listForFaculty(facultyId).filter((a) => a.class_section === classSection);
  if (subject) list = list.filter((a) => a.subject === subject);
  return list;
}

function gradedSubmissionsWithEmail(assignmentId) {
  return db
    .prepare(
      `SELECT s.student_id, s.marks, u.email FROM assignment_submissions s
       JOIN users u ON u.id = s.student_id
       WHERE s.assignment_id = ? AND s.marks IS NOT NULL`
    )
    .all(assignmentId);
}

async function syncCanvas({ facultyId, classSection, subject }) {
  const conn = requireConnection(facultyId, 'canvas');
  const courseLink = db
    .prepare('SELECT * FROM lms_course_links WHERE connection_id = ? AND class_section = ? AND subject = ?')
    .get(conn.id, classSection, subject || '');
  if (!courseLink) {
    const err = new Error('Link this class to a Canvas course first');
    err.status = 400;
    throw err;
  }
  const fresh = await refreshCanvasTokenIfNeeded(conn);
  const authHeaders = { Authorization: `Bearer ${fresh.access_token}` };
  const courseId = courseLink.external_course_id;

  // Real students enrolled in the Canvas course, so grades can be matched
  // by email rather than guessing a Canvas user id.
  const studentsRes = await fetch(
    new URL(`/api/v1/courses/${courseId}/users?enrollment_type[]=student&include[]=email&per_page=100`, fresh.instance_url),
    { headers: authHeaders }
  );
  const canvasStudents = await studentsRes.json().catch(() => []);
  const byEmail = new Map((Array.isArray(canvasStudents) ? canvasStudents : []).map((s) => [String(s.email || '').toLowerCase(), s.id]));

  let synced = 0;
  let failed = 0;
  const localList = localAssignmentsFor(facultyId, classSection, subject);

  for (const a of localList) {
    try {
      // Find-or-create the Canvas assignment (real, documented endpoints).
      const searchRes = await fetch(
        new URL(`/api/v1/courses/${courseId}/assignments?search_term=${encodeURIComponent(a.title)}`, fresh.instance_url),
        { headers: authHeaders }
      );
      const found = await searchRes.json().catch(() => []);
      let externalId = Array.isArray(found) && found[0] ? found[0].id : null;

      if (!externalId) {
        const createRes = await fetch(new URL(`/api/v1/courses/${courseId}/assignments`, fresh.instance_url), {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignment: {
              name: a.title,
              description: a.description || '',
              points_possible: a.max_marks,
              due_at: a.due_date || null,
              submission_types: ['none'],
              published: true,
            },
          }),
        });
        const created = await createRes.json().catch(() => ({}));
        if (!createRes.ok || !created.id) throw new Error(created?.errors?.[0]?.message || 'Could not create Canvas assignment');
        externalId = created.id;
      }

      // Push grades for locally-graded submissions, matched by email.
      const graded = gradedSubmissionsWithEmail(a.id);
      for (const g of graded) {
        const canvasUserId = byEmail.get(String(g.email || '').toLowerCase());
        if (!canvasUserId) continue; // student not enrolled on the Canvas side under this email
        const gradeRes = await fetch(
          new URL(`/api/v1/courses/${courseId}/assignments/${externalId}/submissions/${canvasUserId}`, fresh.instance_url),
          {
            method: 'PUT',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission: { posted_grade: String(g.marks) } }),
          }
        );
        if (gradeRes.ok) synced++;
        else failed++;
      }
    } catch (_e) {
      failed++;
    }
  }

  logSync({ connectionId: conn.id, classSection, subject, status: failed ? 'partial' : 'ok', itemsSynced: synced, itemsFailed: failed });
  return { ok: true, synced, failed };
}

async function syncMoodle({ facultyId, classSection, subject }) {
  const conn = requireConnection(facultyId, 'moodle');
  const courseLink = db
    .prepare('SELECT * FROM lms_course_links WHERE connection_id = ? AND class_section = ? AND subject = ?')
    .get(conn.id, classSection, subject || '');
  if (!courseLink) {
    const err = new Error('Link this class to a Moodle course first');
    err.status = 400;
    throw err;
  }

  // Real enrolled users for this Moodle course, matched to local students
  // by email — this is how student identity is bridged across systems.
  const enrolled = await moodleCall(conn.instance_url, conn.ws_token, 'core_enrol_get_enrolled_users', {
    courseid: courseLink.external_course_id,
  });
  if (enrolled?.exception) {
    const err = new Error(enrolled.message || 'Failed to read Moodle course roster');
    err.status = 502;
    throw err;
  }
  const byEmail = new Map((Array.isArray(enrolled) ? enrolled : []).map((u) => [String(u.email || '').toLowerCase(), u.id]));

  const assignmentLinks = db
    .prepare('SELECT * FROM lms_assignment_links WHERE course_link_id = ?')
    .all(courseLink.id);
  if (!assignmentLinks.length) {
    const err = new Error(
      'No assignments are mapped to a Moodle assignment yet. Moodle\'s public API can grade an existing assignment but cannot create new assignment activities — map each local assignment to an existing Moodle assignment first.'
    );
    err.status = 400;
    throw err;
  }

  let synced = 0;
  let failed = 0;
  for (const link of assignmentLinks) {
    try {
      const graded = gradedSubmissionsWithEmail(link.local_assignment_id);
      const grades = [];
      for (const g of graded) {
        const moodleUserId = byEmail.get(String(g.email || '').toLowerCase());
        if (!moodleUserId) continue;
        grades.push({ studentid: moodleUserId, grade: g.marks });
      }
      if (!grades.length) continue;
      const result = await moodleCall(conn.instance_url, conn.ws_token, 'core_grades_update_grades', {
        source: 'eduai-lms-sync',
        component: 'mod_assign',
        activityid: link.external_cmid,
        itemnumber: 0,
        grades,
      });
      if (result?.exception) {
        failed += grades.length;
      } else {
        synced += grades.length;
      }
    } catch (_e) {
      failed++;
    }
  }

  logSync({ connectionId: conn.id, classSection, subject, status: failed ? 'partial' : 'ok', itemsSynced: synced, itemsFailed: failed });
  return { ok: true, synced, failed };
}

module.exports = {
  envConfig,
  buildCanvasAuthorizeUrl,
  exchangeCanvasCode,
  connectMoodle,
  listConnections,
  disconnect,
  listExternalCourses,
  linkCourse,
  listCourseLinks,
  listMoodleAssignmentsForCourse,
  linkAssignment,
  listSyncLogs,
  syncCanvas,
  syncMoodle,
};
