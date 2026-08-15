# Remaining student-portal feature list: gap-fill pass (this pass)

You gave a specific 20-item feature list for the student portal. This pass
audited every existing module against it and added ONLY the pieces that
were genuinely missing — nothing existing was changed. Ground rule is the
same as every pass above: new files, new `CREATE TABLE IF NOT EXISTS`
tables, new `require(...)`/`app.use(...)` lines in `server.js` only.

## Already fully covered before this pass (verified, not touched)
Dashboard (`studentDashboard.js`), Marks CRUD + CGPA calculator + transcript
(`academics.js`), Certifications (`certificates.js`), Resume Builder (ATS/
PDF/DOCX/fallback, `resumeBuilder.js`), Timetable slots (`timetable.js`),
Leave apply/cancel (`leave.js`), Achievements badges+leaderboard
(`gamification.js`), Career Prep mock interviews (`mockInterviews.js`),
Attendance base records (`dataRoutes.js`/`db.js`).

## Added in this pass

| Feature (from your list) | New file(s) | Mounted at |
|---|---|---|
| Profile — bio, social links, theme/lang/accessibility | `studentProfile.js` | `/api/student/profile` |
| Skills — technical & soft, radar chart | `skills.js` | `/api/student/skills` |
| Roadmap — current vs target, AI-generated steps | `skills.js` (same file) | `/api/student/skills/roadmap` |
| Semesters & Syllabus — view/download, exam schedule ICS | `syllabus.js`, `icsHelper.js` | `/api/syllabus` |
| Holidays — ICS export | `holidays.js` | `/api/holidays` |
| Document Services — requests, SLAs, medical letter generator | `documentServices.js` | `/api/document-services` |
| Backlog Manager — add/clear/delete | `backlogManager.js` | `/api/student/backlog` |
| Attendance — deficit calculator, PDF report, recovery AI | `attendanceTools.js` | `/api/attendance-tools` |
| Grade Engine — batch comparison, risk assessment | `gradeEngine.js` | `/api/grade-engine` |
| Achievements — reward store | `rewardStore.js` | `/api/rewards` |
| Goals & Wellness — progress bars, mood chart | `wellness.js` | `/api/student/wellness` |
| Job Tracker — Applied → Interview → Offer | `jobTracker.js` | `/api/student/job-tracker` |
| Career Prep — cover letter | `careerPrep.js` | `/api/career-prep` |
| AI Study Tool — summarize, Mermaid flow/diagram | `studyTool.js` | `/api/study-tool` |
| Leave & Meetings — suggest slot | `meetings.js` | `/api/meetings` |
| Timetable — CSV export | `timetableCsv.js` | `/api/timetable-export` |

Each module reuses existing infrastructure where it made sense instead of
duplicating it:
- `skills.js`, `documentServices.js`, `attendanceTools.js`, `careerPrep.js`,
  `studyTool.js` all call the existing `anthropicClient.callAnthropic()` —
  same pattern as `quiz.js`'s AI-draft-questions and `resumeBuilder.js` —
  and every one has a deterministic non-AI fallback so the feature never
  just breaks if no `ANTHROPIC_API_KEY` is set or the call fails.
- `attendanceTools.js` reads the existing `attendance` table (from
  `db.js`/`dataRoutes.js`) — no schema change, no write access.
- `gradeEngine.js` reads the existing `results`/`semesters` tables from
  `academics.js` via its exported `sgpaFor()` — no duplicate grade logic.
- `rewardStore.js` deducts/refunds points through the existing
  `gamification.awardPoints()` (a negative amount is a normal ledger
  entry, same function, unmodified) instead of a second points system.
- `syllabus.js` and `holidays.js` share one small `icsHelper.js` for the
  plain-text ICS format — no new npm dependency needed.
- `timetableCsv.js` reads through `timetable.js`'s existing
  `listForSection`/`listForFaculty` exports rather than querying the
  table directly.

## Full new API surface

```
# Profile
GET   /api/student/profile
PUT   /api/student/profile
PATCH /api/student/profile/preferences

# Skills & roadmap
GET    /api/student/skills
PUT    /api/student/skills
DELETE /api/student/skills/:id
GET    /api/student/skills/radar
POST   /api/student/skills/roadmap          (calls the model)
GET    /api/student/skills/roadmap
GET    /api/student/skills/roadmap/:id

# Syllabus & exam schedule
GET    /api/syllabus/documents?classSection=&semesterId=
POST   /api/syllabus/documents               faculty/admin/ai-admin
DELETE /api/syllabus/documents/:id            faculty/admin/ai-admin
GET    /api/syllabus/exam-schedule/:classSection
GET    /api/syllabus/exam-schedule/:classSection/ics
POST   /api/syllabus/exam-schedule            admin/ai-admin
DELETE /api/syllabus/exam-schedule/:id        admin/ai-admin

# Holidays
GET    /api/holidays?year=
GET    /api/holidays/ics?year=
POST   /api/holidays                          admin/ai-admin
DELETE /api/holidays/:id                      admin/ai-admin

# Document services
POST   /api/document-services/requests        student
GET    /api/document-services/requests/mine    student
GET    /api/document-services/requests         admin/ai-admin
PATCH  /api/document-services/requests/:id      admin/ai-admin
POST   /api/document-services/medical-letter    student (calls the model)
GET    /api/document-services/medical-letter/:id/pdf   student

# Backlog manager
GET    /api/student/backlog
POST   /api/student/backlog
PATCH  /api/student/backlog/:id
POST   /api/student/backlog/:id/clear
DELETE /api/student/backlog/:id

# Attendance tools
GET  /api/attendance-tools/breakdown?studentId=
GET  /api/attendance-tools/deficit?requiredPercent=&studentId=
GET  /api/attendance-tools/report.pdf?requiredPercent=&studentId=
POST /api/attendance-tools/recovery-plan       (calls the model)

# Grade engine
GET /api/grade-engine/batch-comparison/:semesterId    faculty/admin/ai-admin
GET /api/grade-engine/risk/:semesterId/mine            student
GET /api/grade-engine/risk/:semesterId/:studentId       faculty/admin/ai-admin
GET /api/grade-engine/risk/:semesterId                  faculty/admin/ai-admin

# Reward store
GET   /api/rewards
POST  /api/rewards                            admin/ai-admin
POST  /api/rewards/:id/redeem
GET   /api/rewards/redemptions/mine
PATCH /api/rewards/redemptions/:id             admin/ai-admin

# Goals & wellness
GET    /api/student/wellness/goals
POST   /api/student/wellness/goals
PATCH  /api/student/wellness/goals/:id
DELETE /api/student/wellness/goals/:id
POST   /api/student/wellness/mood
GET    /api/student/wellness/mood?days=

# Job tracker
GET    /api/student/job-tracker?status=
GET    /api/student/job-tracker/summary
POST   /api/student/job-tracker
PATCH  /api/student/job-tracker/:id/status
DELETE /api/student/job-tracker/:id

# Career prep — cover letter
POST /api/career-prep/cover-letter             (calls the model)
GET  /api/career-prep/cover-letter
GET  /api/career-prep/cover-letter/:id

# AI study tool
POST /api/study-tool/summarize                 (calls the model)
POST /api/study-tool/diagram                   (calls the model, Mermaid output)
GET  /api/study-tool/history?toolType=

# Meetings
POST /api/meetings
GET  /api/meetings/mine
POST /api/meetings/:id/suggest-slot
POST /api/meetings/:id/confirm
POST /api/meetings/:id/decline
POST /api/meetings/:id/cancel

# Timetable CSV export
GET /api/timetable-export/section/:classSection.csv
GET /api/timetable-export/mine.csv              faculty
```

All routes require the same Bearer JWT as every other route in this
backend.

## How this was checked

No network access in this environment, so `npm install` / booting a live
server wasn't possible for this pass (unlike the hand-tested passes
above). Instead, every new file was verified statically:
- `node -c` syntax-checked on all 30 new files — zero errors.
- Every `require('../<module>')` in the new route files resolved against
  an actual file on disk.
- Every function each new route file calls was cross-checked against that
  module's `module.exports` list.
- Every raw SQL column name (`req.user.id/name/role`, `users.name`,
  `attendance.subject/status`, `results`/`semesters` columns, etc.) was
  checked against the existing schema in `db.js`/`academics.js`/
  `timetable.js` rather than assumed.

Recommended before deploying: run `npm install` (network required) and a
manual pass through the new routes with a live server, the same way every
prior pass in this document was verified end-to-end.

## Not built (deliberately)

- Picture crop/resize is a frontend/canvas concern — the backend accepts
  an `avatarUploadId` (from the existing `/api/uploads` endpoint) and
  stores it; actual cropping UI belongs in `Edu.html`/`index.html`.
- Radar chart rendering itself is a frontend chart-library concern —
  `/api/student/skills/radar` returns the `{skill, value, target}` data
  points a frontend radar-chart component (e.g. Chart.js) would consume.
- Mermaid diagram *rendering* is a frontend concern — `/api/study-tool/diagram`
  returns raw Mermaid syntax for a `mermaid.js` component to render.

---

# Placement & Alumni: mock interview scheduling (added in this pass)

`src/mockInterviews.js` + `src/routes/mockInterviewRoutes.js`, mounted at
`/api/placements/mock-interviews` — a sub-path of the existing
`/api/placements`, which (along with `placements.js`) is untouched. New
table only (`interview_slots`).

**"Live job feeds" wasn't built, and here's why:** that means pulling
real listings from LinkedIn/Naukri/Indeed, which needs a paid job-board
API key this environment doesn't have. Faking that would mean either
hardcoded fake listings or a broken integration — neither is honest.
What already exists and works is `placements.js`'s job postings +
application pipeline, which is the placement cell's own listings (not
an external feed) and was already there before this pass.

**Mock interview scheduling** — the part of "Placement & Alumni" that
*is* fully buildable without external services:
- Faculty/admin, or any user already registered in the existing `alumni`
  table, can offer interview slots (type: technical/hr/group_discussion/
  resume_review). Overlapping slots for the same interviewer are
  rejected (409) — same clash-detection pattern as the exam cell's
  invigilator rostering.
- Students book an open slot; booking also checks the student isn't
  already booked into another overlapping slot elsewhere.
- Either side can cancel — a student cancelling reopens the slot for
  others; an interviewer cancelling closes it.
- The interviewer marks a booked slot `completed` with required written
  feedback and an optional 1–5 rating.
- There's deliberately no separate "alumni" login role (the system's
  `VALID_ROLES` is `student/faculty/parent/admin/ai-admin`) — alumni
  status is whatever's already in the `alumni` table, so someone
  self-registers there first (existing `POST /api/placements/alumni`)
  and can then offer slots.

Route list:
```
POST /api/placements/mock-interviews/slots                  faculty/admin/ai-admin or registered alumni
GET  /api/placements/mock-interviews/slots?interviewType=&fromDate=
GET  /api/placements/mock-interviews/slots/mine              interviewer (self)
POST /api/placements/mock-interviews/slots/:id/book          student
POST /api/placements/mock-interviews/slots/:id/cancel        booking student or owning interviewer
POST /api/placements/mock-interviews/slots/:id/complete      owning interviewer
GET  /api/placements/mock-interviews/bookings/mine            student
```

Tested end-to-end against a running server: a plain student blocked from
offering a slot (403) → faculty offers one, a second overlapping slot
from the same faculty rejected (409) → a not-yet-alumni user also
blocked (403) → same user self-registers via the existing alumni
endpoint → now allowed to offer a slot → a student books both slots
(different dates, so no clash) → a second student blocked from booking
an already-booked slot (409) → a non-owner blocked from cancelling
someone else's booking (403) → completing without feedback rejected
(400) → completed with feedback + rating → a student cancels their other
booking and it correctly reopens for others. Also specifically verified
the route-mounting order: `/api/placements/mock-interviews/*` correctly
falls through the base `placementRoutes` router (which has no matching
route) into the new sub-router, since both are mounted on overlapping
Express paths.

---

# Hostel Mess (added in this pass)

`src/hostelMess.js` + `src/routes/hostelMessRoutes.js`, mounted at
`/api/hostel-mess` — separate path from the existing `/api/hostel`
(rooms/allocation), which is completely untouched. New tables only
(`mess_menu`, `mess_attendance`, `hostel_complaints`).

- **Menu** — admin sets a recurring weekly menu (day of week × meal
  type → items). `GET /menu` returns the full week, `GET /menu/today`
  resolves the server's current day automatically.
- **Meal tracking** — `POST /attendance` marks a student present for a
  date+meal. This is the software half of "RFID scanning": there's no
  physical reader here, but the endpoint is idempotent per
  student/date/meal (a duplicate scan returns 409, not a double count),
  which is exactly what a real card reader would need to call into. A
  `GET /attendance/report` gives the kitchen a headcount + roster for a
  given date/meal.
- **Complaints** — students file a complaint (room/mess/maintenance/
  other), staff assign it (auto-moves `open` → `in_progress`) and walk
  it through `resolved`/`closed`. Resolving or closing requires
  resolution notes. A closed complaint is locked — no further status
  changes.

Route list:
```
PUT   /api/hostel-mess/menu                                  admin/ai-admin
GET   /api/hostel-mess/menu
GET   /api/hostel-mess/menu/today
GET   /api/hostel-mess/menu/:dayOfWeek

POST  /api/hostel-mess/attendance                            admin/ai-admin
GET   /api/hostel-mess/attendance/mine                        student
GET   /api/hostel-mess/attendance/report?mealDate=&mealType=  admin/ai-admin

POST  /api/hostel-mess/complaints                              student
GET   /api/hostel-mess/complaints/mine                         student
GET   /api/hostel-mess/complaints?status=&category=          admin/ai-admin
GET   /api/hostel-mess/complaints/:id                        self or admin/ai-admin
POST  /api/hostel-mess/complaints/:id/assign                 admin/ai-admin
PATCH /api/hostel-mess/complaints/:id                        admin/ai-admin
```

Tested end-to-end against a running server: student blocked from setting
the menu (403) → weekly + single-day menu reads verified → meal
attendance marked for two students → duplicate scan correctly rejected
(409) → kitchen headcount report verified (count=2, correct roster) →
student's own meal history correct → complaint filed → invalid category
rejected (400) → a second student blocked from reading the first
student's complaint (403) → admin lists/assigns it (auto-transitions to
`in_progress`) → resolving without notes rejected (400) → resolved with
notes → closed → further edits on the closed complaint rejected (409) →
student's own complaint history reflects the final state.

---

# HR/Payroll: self-service, tax, Form-16 (added in this pass)

`src/payrollTax.js` + `src/routes/payrollTaxRoutes.js`, mounted on the same
`/api/payroll` base path as the existing payroll routes but in their own
file/router — `payroll.js` and `payrollRoutes.js` are untouched. New
tables only (`staff_bank_details`, `staff_tax_declarations`,
`payroll_tax_breakdown`).

**Read this before treating any of it as real payroll or tax advice:**
the slab rates in `computeAnnualTax()` are simplified/illustrative, not
current CBDT-notified brackets for a specific assessment year, and the
"Form 16" PDF is a plain-language summary — not a statutory
TRACES-certified Form 16 (Parts A & B) and cannot be used for actual tax
filing. Both say so, in the code and on the PDF itself. Get a qualified
CA/HR professional to verify actual numbers before using this for a real
disbursement or filing.

- **Faculty self-service** — staff can update their own bank details and
  submit/update their own annual tax declaration (regime + 80C/80D/HRA
  claims) without admin involvement. Admins still control salary and
  designation (unchanged, in `payroll.js`) so staff can't self-elevate pay.
- **Tax deductions** — `POST /generate-with-tax` is a wrapper around the
  existing, unmodified `payroll.generatePayroll()`: it looks up the
  staff's declaration for the relevant Indian financial year (Apr–Mar),
  computes monthly TDS from annualized basic+allowances using old-regime
  (with 80C/80D/HRA/standard deduction) or new-regime (standard deduction
  only, as per current law) slabs plus 4% cess and the Section 87A
  rebate, folds it into `deductions`, then calls the original function —
  so its duplicate-run-per-month guard still applies unchanged. The
  per-run tax math is stored separately for later audit/Form-16 use.
- **Form-16** — `GET /form16/:staffUserId/:financialYear` (JSON) and
  `.../pdf` aggregate a financial year's payroll runs into gross paid,
  total TDS deducted, and a monthly breakdown.

Route list:
```
PUT  /api/payroll/self/bank-details                       faculty/admin/ai-admin (self)
GET  /api/payroll/self/bank-details                        faculty/admin/ai-admin (self)
GET  /api/payroll/bank-details/:userId                    admin/ai-admin
PUT  /api/payroll/self/tax-declaration                    faculty/admin/ai-admin (self)
GET  /api/payroll/self/tax-declaration/:financialYear     faculty/admin/ai-admin (self)
GET  /api/payroll/tax-declarations?financialYear=         admin/ai-admin
POST /api/payroll/generate-with-tax                       admin/ai-admin
GET  /api/payroll/:id/tax-breakdown                       any authenticated (data isn't sensitive beyond the run itself)
GET  /api/payroll/form16/:staffUserId/:financialYear       self or admin/ai-admin
GET  /api/payroll/form16/:staffUserId/:financialYear/pdf   self or admin/ai-admin
```

Tested end-to-end against a running server: two staff profiles (one high
salary in the old regime with 80C/80D/HRA declared, one modest salary
left on the default new regime) → self-service bank details saved →
bob correctly blocked from reading Alice's bank details (403) while
admin can → tax-aware payroll generated for both, verified the tax
math by hand (old regime: ₹1,155,000 taxable → ₹159,000 tax + ₹6,360
cess → ₹13,780/month TDS; new regime: ₹525,000 taxable, under the
₹1,200,000 rebate ceiling → ₹0 tax) → duplicate-month guard still
fires (409) through the wrapper → five months generated → Alice reads
her own tax breakdown and Form-16 summary, Bob blocked from reading
hers (403) → PDF downloaded and rendered to an image to confirm the
layout wasn't broken (it was, on the first pass — the disclaimer box
overlapped the title and a later section got trapped in a narrow
column because `doc.x` was left at a table column's position; both
fixed and re-verified visually).

---

# Exam Cell (added in this pass, on top of everything below)

`src/examCell.js` + `src/routes/examCellRoutes.js`, mounted at `/api/exam-cell`.
New tables only (`exams`, `exam_rooms`, `exam_seats`, `exam_invigilators`,
`exam_results`, `exam_revaluation_requests`) — the existing `grades` table
and `/api/quiz` (in-class quizzes) routes are untouched.

- **Exams** — admin/ai-admin schedule an exam (title, subject, class
  section, date, start/end time, max marks).
- **Rooms & seating** — admin adds rooms with a capacity to an exam, then
  `POST /exams/:id/seating/generate` with a student list auto-assigns
  seats. Students from the same class section are interleaved before
  rooms are filled, so a section isn't clustered in one room — a simple,
  explainable anti-copying heuristic, not a guarantee. Regenerating is
  idempotent (old seats are cleared first). Rejects with 409 if there
  aren't enough seats for the given student list.
- **Invigilation rostering** — admin assigns a faculty member to a room
  for an exam. Blocks double-booking: a faculty member can't be assigned
  to two exams with overlapping date/time windows (same clash-detection
  approach as `timetable.js`).
- **Results** — faculty/admin record marks per student (validated against
  the exam's max marks); students can see their own.
- **Revaluation** — a student can request a recheck on a recorded result
  (one open request per exam at a time). Faculty/admin move it through
  `pending → under_review → approved/rejected/completed`; marking it
  `completed` requires `revisedMarks` and atomically updates the stored
  result.

Full route list:
```
POST   /api/exam-cell/exams                              admin/ai-admin
GET    /api/exam-cell/exams?classSection=&upcoming=true
GET    /api/exam-cell/exams/:id
DELETE /api/exam-cell/exams/:id                           admin/ai-admin

POST   /api/exam-cell/exams/:id/rooms                     admin/ai-admin
GET    /api/exam-cell/exams/:id/rooms                     faculty/admin/ai-admin

POST   /api/exam-cell/exams/:id/seating/generate          admin/ai-admin
GET    /api/exam-cell/exams/:id/seating                   faculty/admin/ai-admin
GET    /api/exam-cell/exams/:id/seating/mine               student

POST   /api/exam-cell/exams/:id/invigilators              admin/ai-admin
DELETE /api/exam-cell/invigilators/:id                    admin/ai-admin
GET    /api/exam-cell/exams/:id/invigilators              faculty/admin/ai-admin
GET    /api/exam-cell/invigilators/mine                    faculty

POST   /api/exam-cell/exams/:id/results                   faculty/admin
GET    /api/exam-cell/exams/:id/results                   faculty/admin/ai-admin
GET    /api/exam-cell/exams/:id/results/mine                student
GET    /api/exam-cell/results/mine                          student

POST   /api/exam-cell/exams/:id/revaluation                 student
GET    /api/exam-cell/revaluation/mine                      student
GET    /api/exam-cell/revaluation?status=                 faculty/admin/ai-admin
PATCH  /api/exam-cell/revaluation/:id                      faculty/admin
```

Tested end-to-end against a running server: register/login every role →
create exam → student blocked from creating one (403) → add rooms →
seating rejected when over capacity (409) → seating generated and
verified section-interleaved → regenerate is idempotent → student reads
own seat → invigilators assigned → same faculty blocked from a
time-overlapping exam elsewhere (409) → faculty records a result →
student requests revaluation → duplicate open request blocked (409) →
faculty completes it with revised marks → result confirmed updated.

Not built (deliberately): auto-seating that also accounts for physical
room layout/aisles (only room+seat-number capacity is modeled), and any
plagiarism-detection signal — those need real classroom floor plans and
invigilator input this backend doesn't have.

---

# New features added (this pass)

Same ground rule as `ENHANCEMENTS.md`: everything below is **additive**.
No existing file had code removed or behavior changed — `public/index.html`
is untouched, and every route that existed before still works exactly as
it did. `src/server.js` only gained new `require(...)` lines and new
`app.use(...)` mounts; nothing already there was reordered or edited.

Every new module was hand-tested end-to-end against a running server
(register → login → exercise every route → verify DB state) before being
included here — see the "How this was tested" section at the bottom.

## What's inside

| Module | File(s) | What it does |
|---|---|---|
| **Timetable** | `src/timetable.js`, `routes/timetableRoutes.js` | Weekly period grid per class-section. Prevents double-booking a faculty member in the same day/period. Views by section or by faculty. |
| **Assignments** | `src/assignments.js`, `routes/assignmentRoutes.js` | Faculty post coursework with a due date and max marks; students submit text and/or an uploaded file; auto-flags late submissions; faculty grade with feedback; per-assignment stats (average, ungraded count, late count). |
| **Quizzes / exams** | `src/quiz.js`, `routes/quizRoutes.js` | MCQ quiz authoring, publish/unpublish, timed attempts, auto-grading on submit. Includes an **AI-draft-questions** endpoint that reuses the same `anthropicClient` the rest of the app already calls — it returns a batch of draft questions for a teacher to review and add one at a time, so nothing AI-written lands in a quiz unreviewed. |
| **Library** | `src/library.js`, `routes/libraryRoutes.js` | Book catalog with copy counts, issue/return workflow, automatic overdue fine calculation (₹5/day past a 14-day loan, both configurable in code), overdue report. |
| **Events / calendar** | `src/events.js`, `routes/eventRoutes.js` | School-wide or role-targeted events, RSVP (going/maybe/declined) with a summary count. |
| **Messaging** | `src/messaging.js`, `routes/messageRoutes.js` | Direct messages between any two accounts (student↔faculty, parent↔faculty, etc.), inbox view with unread counts per thread. Polling-based by design — see "Still worth adding." |
| **Forum** | `src/forum.js`, `routes/forumRoutes.js` | Threaded discussion with tags, replies, upvote/downvote, faculty/admin moderation (lock/delete). |
| **Gamification** | `src/gamification.js`, `routes/gamificationRoutes.js` | Points ledger, auto-awarded badges at point thresholds, leaderboard. Wired into assignments (points on grading) and quizzes (points on submission) and forum (points for posting/replying) automatically — no frontend change needed for the awards to start accruing once those routes are used. |
| **File uploads** | `src/uploads.js`, `routes/uploadRoutes.js` | Authenticated file upload (multipart/form-data) backing assignment submissions, forum attachments, avatars, etc. Blocks executable file extensions, caps size (15MB default, configurable). |
| **Platform settings** | `src/settings.js`, `routes/settingsRoutes.js` | Key/value feature flags and a banner message, readable by any logged-in user, writable by admin/ai-admin only. |
| **Unified search** | `routes/searchRoutes.js` | One query across knowledge-base entries, announcements, forum threads, and the library catalog. |
| **Reports** | `routes/reportRoutes.js` | CSV export of attendance, grades, fees, library issues, quiz attempts, and users; a JSON `/summary` endpoint with platform-wide counts for an admin dashboard tile. |
| **Audit log** | `src/audit.js` | Shared helper the modules above call on every write (create/update/delete/grade/publish/etc.) — who did what, when, to which record. Queryable by entity or user. |

Every module creates its own tables via `CREATE TABLE IF NOT EXISTS` in its
own file, using the same shared SQLite connection from `src/db.js` — so
`db.js` itself needed zero edits.

## New dependency

- `multer` (file uploads) — pinned to the `2.x` line, since `1.x` carries
  published vulnerabilities. Added to `package.json`; run `npm install`.
- New env vars in `.env.example`: `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`.

## Full new API surface

```
# Timetable
POST   /api/timetable                          admin/ai-admin
GET    /api/timetable/section/:classSection
GET    /api/timetable/faculty/:facultyId
GET    /api/timetable/mine                      faculty
GET    /api/timetable/sections
PATCH  /api/timetable/:id                        admin/ai-admin
DELETE /api/timetable/:id                        admin/ai-admin

# Assignments
POST   /api/assignments                          faculty/admin
GET    /api/assignments/section/:classSection
GET    /api/assignments/mine                     faculty
GET    /api/assignments/:id
DELETE /api/assignments/:id                       faculty/admin
POST   /api/assignments/:id/submit                student
GET    /api/assignments/mine/submissions          student
GET    /api/assignments/:id/submissions           faculty/admin
GET    /api/assignments/:id/submissions/me        student
POST   /api/assignments/:id/submissions/:studentId/grade   faculty/admin

# Quizzes
POST   /api/quiz                                  faculty/admin
POST   /api/quiz/:id/questions                     faculty/admin
POST   /api/quiz/:id/ai-draft-questions             faculty/admin (calls the model)
POST   /api/quiz/:id/publish                        faculty/admin
GET    /api/quiz/section/:classSection
GET    /api/quiz/mine                               faculty/admin
GET    /api/quiz/:id
POST   /api/quiz/:id/start                          student
POST   /api/quiz/:id/submit                         student
GET    /api/quiz/mine/attempts                      student
GET    /api/quiz/:id/attempts                       faculty/admin

# Library
GET    /api/library/books
POST   /api/library/books                          admin/ai-admin
PATCH  /api/library/books/:id                       admin/ai-admin
POST   /api/library/issue                           admin/ai-admin/faculty
POST   /api/library/return/:issueId                  admin/ai-admin/faculty
GET    /api/library/my-loans                        student
GET    /api/library/loans/:studentId                admin/ai-admin/faculty/parent
GET    /api/library/active                          admin/ai-admin/faculty
GET    /api/library/overdue                         admin/ai-admin/faculty

# Events
POST   /api/events                                  admin/ai-admin/faculty
GET    /api/events/upcoming
GET    /api/events/range?start=YYYY-MM-DD&end=YYYY-MM-DD
GET    /api/events/:id
PATCH  /api/events/:id                               admin/ai-admin/faculty
DELETE /api/events/:id                               admin/ai-admin/faculty
POST   /api/events/:id/rsvp

# Messaging
GET    /api/messages/inbox
GET    /api/messages/with/:userId
POST   /api/messages/with/:userId

# Forum
POST   /api/forum/threads
GET    /api/forum/threads?tag=&sort=top|recent
GET    /api/forum/threads/:id
DELETE /api/forum/threads/:id                        owner or faculty/admin
POST   /api/forum/threads/:id/lock                    faculty/admin
POST   /api/forum/threads/:id/replies
POST   /api/forum/threads/:id/vote                    { value: 1 | -1 }

# Gamification
GET    /api/gamification/me
GET    /api/gamification/badges
GET    /api/gamification/leaderboard
POST   /api/gamification/award                       faculty/admin/ai-admin

# Uploads
POST   /api/uploads                                   multipart/form-data, field "file"
GET    /api/uploads/mine
GET    /api/uploads/:id/download
DELETE /api/uploads/:id

# Settings
GET    /api/settings
PUT    /api/settings/:key                             admin/ai-admin

# Search
GET    /api/search?q=...

# Reports
GET    /api/reports/attendance.csv                    admin/ai-admin/faculty
GET    /api/reports/grades.csv                        admin/ai-admin/faculty
GET    /api/reports/fees.csv                           admin/ai-admin
GET    /api/reports/library-issues.csv                 admin/ai-admin
GET    /api/reports/quiz-attempts.csv                  admin/ai-admin/faculty
GET    /api/reports/users.csv                           admin/ai-admin
GET    /api/reports/summary                             admin/ai-admin
```

All routes require a Bearer JWT (`Authorization: Bearer <token>` from
`/api/auth/login`), same as the existing `/api/attendance` etc. routes.

## How this was tested

Not just "should work" — actually run:

1. `npm install` picked up `multer` cleanly against the existing lockfile.
2. Booted the real server (`node src/server.js`) against a fresh SQLite
   file and confirmed every table auto-creates with no errors.
3. Scripted an end-to-end pass through **every** new route: register/login
   three roles → create a timetable slot (and confirmed the double-booking
   conflict correctly returns 409) → post an assignment → submit → grade
   (confirms points are awarded) → author a quiz → publish → attempt → auto
   -grade → add a library book → issue → confirm re-issue is blocked →
   return → create an event → RSVP → send a direct message → check the
   inbox → open a forum thread → reply → upvote → check gamification
   totals/leaderboard → read/write a setting → run a cross-entity search →
   pull the admin summary report → upload a real file and download the
   listing back.
4. That pass caught two real bugs — both **Express route-ordering**
   shadowing bugs (`GET /api/assignments/mine/submissions` and
   `GET /api/quiz/mine/attempts` were being swallowed by the
   `GET /:id/submissions` and `GET /:id/attempts` routes registered
   before them, because Express matches routes in declaration order and
   `:id` happily matches the literal string `"mine"`). Fixed by moving the
   literal routes above the parameterized ones, with a comment at each
   spot so it doesn't regress if more routes are added later.
5. Re-ran the full pass after the fix — everything green.

## Still worth adding (not done in this pass)

Being upfront about what's left, same spirit as the equivalent section in
`ENHANCEMENTS.md`:

- **Automated tests.** This was verified by hand-scripted HTTP calls
  against a live server, not a checked-in `tests/` suite. `node --test`
  (built into Node 22, no new dependency) would be the natural fit —
  it would need `server.js` refactored slightly to export the `app`
  before `.listen()` is called, which I deliberately didn't do here to
  keep this pass 100% non-invasive to the existing file.
- **WebSocket/SSE push** for messaging and notifications instead of
  client-side polling.
- **Rate limiting** on the new write-heavy routes (forum posts, messages)
  — currently only `/api/ai/*` has a limiter.
- **Frontend wiring.** Like the resume builder before it, none of this
  forces a UI change today — every route above is available to call, but
  `public/index.html` doesn't render any of it yet. Happy to wire up
  timetable/assignments/quiz/library/events/forum panels into the
  existing portals next, matching how `Edu.html`'s panels already work.
