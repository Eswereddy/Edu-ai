// Automated smoke/integration tests for the new features added in this
// pass (real-time notifications, WebSocket push, AI study planner, rate
// limiting) plus a couple of pre-existing core flows, to make sure this
// pass didn't regress anything. Run with: npm test
//
// Uses Node's built-in test runner (node:test) — no new devDependency
// needed. Each run gets its own throwaway SQLite file via DB_PATH so it
// never touches your real ./data/eduai.db.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const TEST_DB = path.join(__dirname, '.test-eduai.db');
if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB);
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret';
process.env.PORT = '0'; // ephemeral port — avoids clashing with a dev server

const { start } = require('../src/server');

let server;
let baseUrl;

test.before(async () => {
  server = start();
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB);
});

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function registerAndLogin(role, email) {
  await api('POST', '/api/auth/register', { body: { name: role, email, password: 'pass123', role } });
  const { json } = await api('POST', '/api/auth/login', { body: { email, password: 'pass123' } });
  return json.token;
}

test('health check responds ok', async () => {
  const { status, json } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('register + login for all core roles', async () => {
  const studentToken = await registerAndLogin('student', 'stu@t.com');
  const facultyToken = await registerAndLogin('faculty', 'fac@t.com');
  const adminToken = await registerAndLogin('admin', 'adm@t.com');
  assert.ok(studentToken);
  assert.ok(facultyToken);
  assert.ok(adminToken);
});

test('assignment grading triggers a persisted notification for the student', async () => {
  const studentToken = await registerAndLogin('student', 'stu2@t.com');
  const facultyToken = await registerAndLogin('faculty', 'fac2@t.com');
  const { json: me } = await api('GET', '/api/auth/me', { token: studentToken });
  const studentId = me.user.id;

  const { json: created } = await api('POST', '/api/assignments', {
    token: facultyToken,
    body: { classSection: '10A', subject: 'Math', title: 'HW1', dueDate: '2030-01-01', maxMarks: 100 },
  });
  assert.ok(created.assignment.id);

  await api('POST', `/api/assignments/${created.assignment.id}/submit`, {
    token: studentToken,
    body: { content: 'my work' },
  });

  const { json: graded } = await api('POST', `/api/assignments/${created.assignment.id}/submissions/${studentId}/grade`, {
    token: facultyToken,
    body: { marks: 88, feedback: 'Nice job' },
  });
  assert.equal(graded.ok, true);

  const { json: notifs } = await api('GET', '/api/notifications', { token: studentToken });
  const hasGradeNotif = notifs.records?.some((n) => n.title === 'Assignment graded');
  assert.equal(hasGradeNotif, true, 'expected an "Assignment graded" notification');
});

test('forum reply notifies the original thread author', async () => {
  const authorToken = await registerAndLogin('student', 'author@t.com');
  const replierToken = await registerAndLogin('faculty', 'replier@t.com');

  const { json: thread } = await api('POST', '/api/forum/threads', {
    token: authorToken,
    body: { title: 'Need help', body: 'stuck', tags: ['general'] },
  });
  await api('POST', `/api/forum/threads/${thread.thread.id}/replies`, {
    token: replierToken,
    body: { body: 'here is help' },
  });

  const { json: notifs } = await api('GET', '/api/notifications', { token: authorToken });
  const hasReplyNotif = notifs.records?.some((n) => n.title === 'New reply to your thread');
  assert.equal(hasReplyNotif, true);
});

test('event creation notifies only the targeted role', async () => {
  const studentToken = await registerAndLogin('student', 'evtstu@t.com');
  const facultyToken = await registerAndLogin('faculty', 'evtfac@t.com');
  const adminToken = await registerAndLogin('admin', 'evtadm@t.com');

  await api('POST', '/api/events', {
    token: adminToken,
    body: { title: 'Science Fair', eventDate: '2030-03-01', targetRole: 'student' },
  });

  const { json: studentNotifs } = await api('GET', '/api/notifications', { token: studentToken });
  const { json: facultyNotifs } = await api('GET', '/api/notifications', { token: facultyToken });

  assert.equal(studentNotifs.records?.some((n) => n.title.includes('Science Fair')), true);
  assert.equal(facultyNotifs.records?.some((n) => n.title.includes('Science Fair')), false);
});

test('direct message is delivered and appears in inbox', async () => {
  const senderToken = await registerAndLogin('student', 'sender@t.com');
  const recipientToken = await registerAndLogin('faculty', 'recipient@t.com');
  const { json: recipientMe } = await api('GET', '/api/auth/me', { token: recipientToken });

  const { json: sent } = await api('POST', `/api/messages/with/${recipientMe.user.id}`, {
    token: senderToken,
    body: { body: 'hello there' },
  });
  assert.equal(sent.ok, true);

  const { json: inbox } = await api('GET', '/api/messages/inbox', { token: recipientToken });
  assert.ok(JSON.stringify(inbox).includes('hello there'));
});

test('AI study planner generates and lists a plan for a student', async () => {
  const studentToken = await registerAndLogin('student', 'planner@t.com');
  const { status, json: generated } = await api('POST', '/api/study-plan/generate', {
    token: studentToken,
    body: {},
  });
  assert.equal(status, 201);
  assert.ok(generated.plan.id);
  assert.ok(Array.isArray(generated.plan.schedule));
  assert.equal(generated.plan.schedule.length, 7);

  const { json: list } = await api('GET', '/api/study-plan', { token: studentToken });
  assert.ok(list.plans.some((p) => p.id === generated.plan.id));
});

test('study planner rejects non-students', async () => {
  const facultyToken = await registerAndLogin('faculty', 'notplanner@t.com');
  const { status } = await api('POST', '/api/study-plan/generate', { token: facultyToken, body: {} });
  assert.equal(status, 403);
});

test('forum route rate limiter rejects after the per-minute cap', async () => {
  const token = await registerAndLogin('student', 'ratelimit@t.com');
  let lastStatus = 200;
  // WRITE_RATE_LIMIT_PER_MINUTE defaults to 30 — fire one over that.
  for (let i = 0; i < 31; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { status } = await api('POST', '/api/forum/threads', {
      token,
      body: { title: `t${i}`, body: 'x', tags: [] },
    });
    lastStatus = status;
  }
  assert.equal(lastStatus, 429);
});

test('WebSocket connection authenticates via JWT and receives a live push', async () => {
  const { WebSocket } = require('ws');
  const senderToken = await registerAndLogin('student', 'wssender@t.com');
  const recipientToken = await registerAndLogin('faculty', 'wsrecipient@t.com');

  const wsUrl = baseUrl.replace('http://', 'ws://') + `/ws?token=${recipientToken}`;
  const ws = new WebSocket(wsUrl);

  const result = await new Promise((resolve, reject) => {
    let connected = false;
    const timer = setTimeout(() => reject(new Error('WS test timed out')), 5000);
    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.kind === 'connected' && !connected) {
        connected = true;
        await api('POST', `/api/messages/with/${msg.userId}`, {
          token: senderToken,
          body: { body: 'live ping' },
        });
      }
      if (msg.kind === 'direct_message') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    ws.on('error', reject);
  });

  assert.equal(result.message.body, 'live ping');
  ws.close();
});

test('unauthenticated WebSocket connection is rejected', async () => {
  const { WebSocket } = require('ws');
  const wsUrl = baseUrl.replace('http://', 'ws://') + '/ws?token=not-a-real-token';
  const ws = new WebSocket(wsUrl);
  const closeCode = await new Promise((resolve) => {
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => {}); // a close is expected, not an error path
  });
  assert.equal(closeCode, 4401);
});

// --------------------------------------------------------------------
// Semester / subjects / results (academics module)
// --------------------------------------------------------------------

test('faculty can create a semester with subjects, and enter a result', async () => {
  const facultyToken = await registerAndLogin('faculty', 'semfac@t.com');
  const studentToken = await registerAndLogin('student', 'semstu@t.com');
  const { json: me } = await api('GET', '/api/auth/me', { token: studentToken });

  const { status: semStatus, json: sem } = await api('POST', '/api/academics/semesters', {
    token: facultyToken,
    body: { name: 'Semester 1', classSection: '10A' },
  });
  assert.equal(semStatus, 201);
  assert.ok(sem.semester.id);

  const { status: subjStatus, json: subj } = await api('POST', `/api/academics/semesters/${sem.semester.id}/subjects`, {
    token: facultyToken,
    body: { subjectName: 'Mathematics', subjectCode: 'MATH101', credits: 4 },
  });
  assert.equal(subjStatus, 201);
  assert.ok(subj.subject.id);

  const { status: resStatus, json: res } = await api('POST', '/api/academics/results', {
    token: facultyToken,
    body: {
      studentId: me.user.id,
      semesterId: sem.semester.id,
      subjectId: subj.subject.id,
      marksObtained: 92,
      maxMarks: 100,
    },
  });
  assert.equal(resStatus, 201);
  assert.equal(res.result.grade_letter, 'O');
  assert.equal(res.result.grade_point, 10);

  // student should be notified
  const { json: notifs } = await api('GET', '/api/notifications', { token: studentToken });
  assert.equal(notifs.records.some((n) => n.title.includes('Result published')), true);

  // student can see their own result + SGPA for the semester
  const { json: seen } = await api('GET', `/api/academics/results/${me.user.id}/${sem.semester.id}`, {
    token: studentToken,
  });
  assert.equal(seen.results.length, 1);
  assert.equal(seen.sgpa, 10);

  // full transcript via /me
  const { json: transcript } = await api('GET', '/api/academics/transcript/me', { token: studentToken });
  assert.equal(transcript.transcript.cgpa, 10);
  assert.equal(transcript.transcript.semesters.length, 1);
});

test('a second student cannot see another student\'s results', async () => {
  const facultyToken = await registerAndLogin('faculty', 'semfac2@t.com');
  const studentAToken = await registerAndLogin('student', 'semstuA@t.com');
  const studentBToken = await registerAndLogin('student', 'semstuB@t.com');
  const { json: meA } = await api('GET', '/api/auth/me', { token: studentAToken });

  const { json: sem } = await api('POST', '/api/academics/semesters', {
    token: facultyToken,
    body: { name: 'Semester 2', classSection: '10B' },
  });
  const { json: subj } = await api('POST', `/api/academics/semesters/${sem.semester.id}/subjects`, {
    token: facultyToken,
    body: { subjectName: 'Physics', credits: 3 },
  });
  await api('POST', '/api/academics/results', {
    token: facultyToken,
    body: { studentId: meA.user.id, semesterId: sem.semester.id, subjectId: subj.subject.id, marksObtained: 55, maxMarks: 100 },
  });

  const { status } = await api('GET', `/api/academics/results/${meA.user.id}/${sem.semester.id}`, {
    token: studentBToken,
  });
  assert.equal(status, 403);
});

test('re-entering a result for the same student+subject updates it instead of duplicating', async () => {
  const facultyToken = await registerAndLogin('faculty', 'semfac3@t.com');
  const studentToken = await registerAndLogin('student', 'semstu3@t.com');
  const { json: me } = await api('GET', '/api/auth/me', { token: studentToken });

  const { json: sem } = await api('POST', '/api/academics/semesters', {
    token: facultyToken,
    body: { name: 'Semester 3', classSection: '10C' },
  });
  const { json: subj } = await api('POST', `/api/academics/semesters/${sem.semester.id}/subjects`, {
    token: facultyToken,
    body: { subjectName: 'Chemistry', credits: 3 },
  });

  await api('POST', '/api/academics/results', {
    token: facultyToken,
    body: { studentId: me.user.id, semesterId: sem.semester.id, subjectId: subj.subject.id, marksObtained: 45, maxMarks: 100 },
  });
  await api('POST', '/api/academics/results', {
    token: facultyToken,
    body: { studentId: me.user.id, semesterId: sem.semester.id, subjectId: subj.subject.id, marksObtained: 78, maxMarks: 100 },
  });

  const { json: seen } = await api('GET', `/api/academics/results/${me.user.id}/${sem.semester.id}`, {
    token: studentToken,
  });
  assert.equal(seen.results.length, 1);
  assert.equal(seen.results[0].marks_obtained, 78);
  assert.equal(seen.results[0].grade_letter, 'A');
});

// --------------------------------------------------------------------
// Leave management
// --------------------------------------------------------------------

test('student applies for leave, admin approves, student is notified', async () => {
  const studentToken = await registerAndLogin('student', 'leavestu@t.com');
  const adminToken = await registerAndLogin('admin', 'leaveadm@t.com');

  const { status: applyStatus, json: applied } = await api('POST', '/api/leave', {
    token: studentToken,
    body: { leaveType: 'sick', fromDate: '2030-01-10', toDate: '2030-01-12', reason: 'Fever' },
  });
  assert.equal(applyStatus, 201);
  assert.equal(applied.request.status, 'pending');

  const { json: pending } = await api('GET', '/api/leave/pending', { token: adminToken });
  assert.ok(pending.requests.some((r) => r.id === applied.request.id));

  const { status: reviewStatus, json: reviewed } = await api('POST', `/api/leave/${applied.request.id}/review`, {
    token: adminToken,
    body: { status: 'approved', reviewNote: 'Get well soon' },
  });
  assert.equal(reviewStatus, 200);
  assert.equal(reviewed.request.status, 'approved');

  const { json: notifs } = await api('GET', '/api/notifications', { token: studentToken });
  assert.equal(notifs.records.some((n) => n.title === 'Leave request approved'), true);
});

test('leave request cannot be reviewed twice', async () => {
  const studentToken = await registerAndLogin('student', 'leavestu2@t.com');
  const adminToken = await registerAndLogin('admin', 'leaveadm2@t.com');
  const { json: applied } = await api('POST', '/api/leave', {
    token: studentToken,
    body: { fromDate: '2030-02-01', toDate: '2030-02-02' },
  });
  await api('POST', `/api/leave/${applied.request.id}/review`, { token: adminToken, body: { status: 'rejected' } });
  const { status } = await api('POST', `/api/leave/${applied.request.id}/review`, { token: adminToken, body: { status: 'approved' } });
  assert.equal(status, 409);
});

// --------------------------------------------------------------------
// Fee receipts (PDF)
// --------------------------------------------------------------------

test('fee receipt PDF is only available once a fee is marked paid', async () => {
  const studentToken = await registerAndLogin('student', 'feestu@t.com');
  const adminToken = await registerAndLogin('admin', 'feeadm@t.com');
  const { json: me } = await api('GET', '/api/auth/me', { token: studentToken });

  const { json: fee } = await api('POST', '/api/fees', {
    token: adminToken,
    body: { studentId: me.user.id, amount: 5000, dueDate: '2030-01-01' },
  });

  const unpaidRes = await fetch(`${baseUrl}/api/fees/${fee.id}/receipt.pdf`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(unpaidRes.status, 409);

  await api('POST', `/api/fees/${fee.id}/pay`, { token: studentToken });

  const paidRes = await fetch(`${baseUrl}/api/fees/${fee.id}/receipt.pdf`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(paidRes.status, 200);
  assert.equal(paidRes.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await paidRes.arrayBuffer());
  assert.ok(buf.length > 500, 'expected a non-trivial PDF buffer');
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});

test('another student cannot download a receipt that is not theirs', async () => {
  const ownerToken = await registerAndLogin('student', 'feeowner@t.com');
  const otherToken = await registerAndLogin('student', 'feeother@t.com');
  const adminToken = await registerAndLogin('admin', 'feeadm2@t.com');
  const { json: owner } = await api('GET', '/api/auth/me', { token: ownerToken });

  const { json: fee } = await api('POST', '/api/fees', { token: adminToken, body: { studentId: owner.user.id, amount: 1000 } });
  await api('POST', `/api/fees/${fee.id}/pay`, { token: ownerToken });

  const res = await fetch(`${baseUrl}/api/fees/${fee.id}/receipt.pdf`, { headers: { Authorization: `Bearer ${otherToken}` } });
  assert.equal(res.status, 403);
});

// --------------------------------------------------------------------
// Certificate requests (PDF)
// --------------------------------------------------------------------

test('student requests a certificate, admin approves, PDF downloads', async () => {
  const studentToken = await registerAndLogin('student', 'certstu@t.com');
  const adminToken = await registerAndLogin('admin', 'certadm@t.com');

  const { status: reqStatus, json: reqd } = await api('POST', '/api/certificates', {
    token: studentToken,
    body: { certType: 'bonafide', purpose: 'Bank loan application' },
  });
  assert.equal(reqStatus, 201);
  assert.equal(reqd.request.status, 'pending');

  // Not downloadable until approved.
  const beforeRes = await fetch(`${baseUrl}/api/certificates/${reqd.request.id}/download.pdf`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(beforeRes.status, 409);

  const { json: reviewed } = await api('POST', `/api/certificates/${reqd.request.id}/review`, {
    token: adminToken,
    body: { status: 'approved' },
  });
  assert.equal(reviewed.request.status, 'approved');

  const { json: notifs } = await api('GET', '/api/notifications', { token: studentToken });
  assert.equal(notifs.records.some((n) => n.title === 'Certificate request approved'), true);

  const afterRes = await fetch(`${baseUrl}/api/certificates/${reqd.request.id}/download.pdf`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(afterRes.status, 200);
  assert.equal(afterRes.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await afterRes.arrayBuffer());
  assert.equal(buf.slice(0, 4).toString(), '%PDF');
});
