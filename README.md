# EduAI — Full-Stack College Management Platform

A single Node/Express backend that powers **five portals** — Student, Faculty,
Parent, Admin, and AI-Admin — for a complete college management system. It
started as one AI-relay endpoint and has grown, additively, into a real
backend with authentication, a SQLite database, and **99 mounted API route
groups** covering everything from attendance and grading to hostel
allocation, payroll, and blockchain-anchored certificates.

The whole app — frontend and backend — is served from a single origin, so
there's nothing to deploy separately and no CORS configuration to fight.

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Portals & features](#portals--features)
- [AI layer](#ai-layer)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API overview](#api-overview)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Design principle: additive-only](#design-principle-additive-only)
- [Roadmap](#roadmap)

---

## Why this exists

The frontend originally called a single AI bridge endpoint
(`/api/ai/instant`) from every portal, backed by nothing but a hand-written
string-matching stub. This project replaced that stub with a real backend —
and then kept growing, in the same additive style, until it covered the
full operational surface of a college: admissions, academics, attendance,
fees, hostel, transport, placements, payroll, exams, and more, all wired to
real AI features (chat, resume generation, interview coaching, study
planning, career prep) rather than canned responses.

## Architecture

- **One Express app, one origin.** `public/index.html` (a large single-page
  frontend) is served statically alongside the API, so the browser talks to
  one host for everything.
- **SQLite** (`src/db.js`) as the database — every feature module owns its
  own tables, created via `CREATE TABLE IF NOT EXISTS` in that module's own
  file. No shared migrations to break.
- **JWT-based auth** (`src/auth.js`) with `attachUserIfPresent` middleware,
  plus real OAuth2 sign-in (Google, LinkedIn, GitHub).
- **Role-scoped routing.** Every route group is locked to the portal(s) it
  belongs to (`student`, `faculty`, `parent`, `admin`, `ai-admin`), and to
  the caller's own records where relevant.
- **WebSocket layer** (`src/ws.js`) for real-time notifications and live bus
  GPS tracking.
- **Background scheduler** (`src/scheduler.js`) for things like overdue
  library reminders.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 22.5 |
| Framework | Express 4 |
| Database | SQLite |
| Auth | JSON Web Tokens + bcrypt, OAuth2 (Google/LinkedIn/GitHub) |
| AI | Gemini (primary) → Anthropic Claude (fallback) |
| Real-time | `ws` (WebSocket) |
| PDF generation | PDFKit |
| Documents | `docx` (Word document generation) |
| Email | Nodemailer (SMTP) |
| Push notifications | Firebase Cloud Messaging |
| Payments | Demo UPI/Card gateway |
| Blockchain | `ethers` — certificate hash anchoring (Sepolia testnet) |
| Rate limiting | `express-rate-limit` |

## Portals & features

### 🎓 Student Portal
Profile & bio, skills radar + AI-generated roadmap, syllabus & exam
schedule (with ICS calendar export), holiday calendar, document requests
(with AI-drafted medical letters), backlog/arrear manager, attendance
deficit calculator with AI recovery plan, grade engine (batch comparison +
risk assessment), reward store (redeem points), wellness goals + mood
check-ins, personal job tracker, AI cover letter generator, AI study
summarizer + diagram generation, AI live interview bot + DSA practice,
meeting requests, timetable CSV export, personal to-do planner, personal
notes/bookmarks, daily study-streak tracker, and a one-call aggregated
dashboard pulling from attendance, assignments, quizzes, library, fees,
academics, notifications, gamification, and events.

### 👨‍🏫 Faculty Portal
Personal to-do planner, private lesson/student notes, read-only gradebook
analytics, class analytics dashboard, full read-only student profiles, and
an aggregated faculty dashboard.

### 👪 Parent Portal
Verified multi-child linking, live bus GPS tracking, wellness & mental
health alerts, personal reminders, a demo payment gateway for fees, and a
read-only dashboard (all-children overview + per-child detail).

### 🛠️ Admin Portal
Unified pending-approvals inbox (leave, certificates, admissions, parent
links), platform-wide KPI dashboard, real-time broadcast announcements, and
a searchable audit log.

### 🤖 AI-Admin Portal
AI governance controls and administration of the AI memory system across
users.

### 🏫 Institution-wide modules
Admissions & enrollment (applications, seat matrix, auto-enroll, interview
scheduling), exam cell (scheduling, seating, invigilation, results,
revaluation), hostel (room inventory + allocation, mess menu, meal
attendance, complaints), transport (routes, stops, subscriptions, live GPS
tracking), payroll & HR (staff profiles, payroll runs, payslip PDFs, Indian
TDS-aware tax calculation, Form-16 summaries, faculty self-service),
placements & alumni (job postings, applications, alumni registry, live job
feed via Adzuna, an AI placement autopilot), inventory & asset management
(with depreciation and work orders), canteen ordering, campus security
(visitor QR passes, CCTV registry, parking), library, timetable, gradebook,
messaging, forum, gamification, and blockchain-anchored certificate
verification.

## AI layer

Every AI-powered feature across all portals routes through one contract:

```
POST /api/ai/instant
```

- **Provider chain:** Gemini is tried first (free tier); Anthropic Claude is
  the fallback if Gemini is unset or its call fails.
- **RAG:** `src/rag.js` provides TF-IDF-based retrieval over platform facts
  (attendance policy, grading scale, fee rules, etc.), with an optional
  upgrade path to a real vector store (`src/vectorStore.js`, backed by
  Pinecone + Voyage embeddings) via `vectorDbRoutes.js`.
- **Per-user AI memory:** `src/memory.js` persists context across a user's
  sessions.
- **Role-specific prompts:** `src/rolePrompts.js` tailors the system prompt
  per portal.
- **Multilingual:** `src/i18n.js` + Google Translate support UI and AI
  responses in multiple languages, with text-to-speech via Google Cloud TTS.

## Getting started

```bash
git clone <this-repo>
cd eduai-backend
npm install
cp .env.example .env
# edit .env — at minimum set JWT_SECRET, and GEMINI_API_KEY or ANTHROPIC_API_KEY
npm start
```

Open **http://localhost:4111** — frontend and backend are served from the
same origin.

```bash
npm run dev    # auto-restart on file changes
npm test       # run the test suite
```

## Environment variables

Only `JWT_SECRET` is strictly required to boot. Every other integration
degrades gracefully — if its variables are unset, that feature is simply
disabled rather than crashing the server.

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | **Required.** Signs auth tokens. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Primary AI provider. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Fallback AI provider. |
| `PORT`, `DB_PATH` | Server port and SQLite file location. |
| `SMTP_*` | Email for password resets and notifications. |
| `FIREBASE_SERVICE_ACCOUNT[_PATH]` | Push notifications (FCM). |
| `GOOGLE_TRANSLATE_API_KEY` | Multilingual UI/AI responses. |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY` | Live job feed. |
| `GOOGLE_TTS_API_KEY` | Text-to-speech for the parent voice assistant. |
| `PINECONE_API_KEY`, `PINECONE_HOST`, `VOYAGE_API_KEY`, `OPENAI_API_KEY` | Vector-DB RAG upgrade. |
| `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, `BLOCKCHAIN_ANCHOR_ADDRESS`, `BLOCKCHAIN_EXPLORER_BASE` | Certificate blockchain anchoring (testnet only). |
| `RATE_LIMIT_PER_MINUTE`, `WRITE_RATE_LIMIT_PER_MINUTE` | Abuse/cost limits. |
| `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | OAuth2 "Continue with..." sign-in. |

See `.env.example` for the full annotated list.

## API overview

**Core AI bridge**

```
POST /api/ai/instant     — the single endpoint every AI feature calls
GET  /api/ai/status      — reports provider/model without making a call
GET  /api/health         — liveness check
```

**Everything else** is organized into 99 role-scoped route groups under
`src/routes/`, one per feature area (`authRoutes`, `admissionRoutes`,
`examCellRoutes`, `payrollRoutes`, `hostelRoutes`, `placementRoutes`,
`blockchainVerifyRoutes`, and so on). Each is self-contained: its own file,
its own database tables, its own auth scope.

## Security

- API keys and secrets live only in `.env` on the server — never sent to or
  stored in the browser.
- JWT-based auth with bcrypt password hashing.
- Every route is scoped to the roles that should access it, and further
  scoped to the caller's own records where applicable (a parent only sees
  their own linked children, a faculty member only their own classes, etc.).
- Rate limiting on both general requests and write operations.
- Blockchain integration is testnet-only by design (`Sepolia` recommended;
  mainnet keys explicitly discouraged in `.env.example`).
- CORS is open by default for local development — restrict `origin` in
  `src/server.js` before deploying publicly.

## Testing

```bash
npm test
```

Runs `tests/features.test.js` via Node's built-in test runner.

## Deployment

1. Deploy this folder to any Node host (Render, Railway, Fly.io, a VPS...).
2. Set `JWT_SECRET` and your chosen AI provider key(s) in that host's
   environment variables — add the other integrations as needed.
3. If using OAuth sign-in, register each provider's redirect URI as:
   `<PUBLIC_BASE_URL>/api/auth/oauth/<provider>/callback`
4. Point the frontend's AI bridge settings at your deployed
   `/api/ai/instant` URL if it isn't served from the same origin.

## Project structure

```
eduai-backend/
├─ public/
│  └─ index.html          # the full frontend — all five portals, one file
├─ src/
│  ├─ server.js            # Express app: mounts all 99 route groups
│  ├─ db.js                # SQLite connection
│  ├─ auth.js               # JWT auth middleware
│  ├─ oauth.js               # Google/LinkedIn/GitHub OAuth2
│  ├─ anthropicClient.js    # Claude API wrapper
│  ├─ rolePrompts.js        # per-portal AI system prompts
│  ├─ rag.js / vectorStore.js  # retrieval-augmented generation
│  ├─ memory.js             # per-user AI memory
│  ├─ scheduler.js          # background jobs (e.g. library reminders)
│  ├─ ws.js                  # WebSocket real-time layer
│  ├─ routes/                # 99 route-group files, one per feature area
│  └─ ...                    # ~113 files total; one module per feature
├─ tests/
│  └─ features.test.js
├─ .env.example
└─ package.json
```

## Design principle: additive-only

This codebase was built under a strict rule enforced across every
development pass: **no existing code is ever modified, only added to.**
Every new feature is a new file with its own database tables and its own
route mounts. This is why the module count is high — it's a deliberate
trade-off that keeps every past feature provably untouched as new ones are
added.

## Roadmap

Ideas noted as "still worth adding" during development but not yet built:
a production-grade vector database as the default (rather than opt-in),
broader LMS integration, and deeper reporting/analytics across portals.
