# EduAI Backend

A real Node/Express backend for the EduAI Platform frontend. It replaces
browser-side, key-in-localStorage "AI calls" with one secure server-side API
that powers **every AI phase in every portal** — Student, Faculty, Parent,
Admin, and AI Admin.

## Why one endpoint covers all 41 AI features

The frontend already funnels every AI feature (chat, student insights,
performance prediction, skill roadmaps, resume generation, presentation
generation, exam/question generation, financial advisor, translation,
mentorship advice, etc.) through a single JS function, `callClaude()`, which
in turn calls `callBackendAiBridge()`. That function was already coded to
`POST` to:

```
http://localhost:4111/api/ai/instant
```

...it just had nothing listening on the other end (`localAI()` — a
hand-written string-matching stub — ran instead). This backend implements
that exact contract with a real model call, so all 41 call sites become
genuinely functional at once, with no other frontend rewiring required.

## What's inside

```
eduai-backend/
├─ public/index.html      # the app frontend (served statically)
├─ src/
│  ├─ server.js           # Express app: routes, auth, rate limiting
│  ├─ anthropicClient.js  # Anthropic Messages API wrapper
│  ├─ rolePrompts.js      # per-portal system prompts
│  └─ knowledgeBase.js    # lightweight keyword-retrieval RAG
├─ package.json
└─ .env.example
```

## Setup

```bash
cd eduai-backend
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Open **http://localhost:4111** — the whole app (frontend + backend) is
served from one origin, so there's no CORS configuration to fight with.
Every AI button, chat panel, and "Generate ..." action across all five
portals now calls the real model.

## API

### `POST /api/ai/instant`
The endpoint the frontend already calls for every AI phase.

Request body:
```json
{
  "role": "student",
  "query": "Give me a study plan for my exams",
  "messages": [{ "role": "user", "content": "..." }],
  "useRag": true,
  "ragTopK": 4,
  "temperature": 0.4,
  "maxTokens": 700
}
```

Response:
```json
{ "ok": true, "text": "...", "model": "claude-sonnet-5", "role": "student" }
```
or on failure: `{ "ok": false, "error": "..." }` with a non-2xx status.

### `GET /api/ai/status`
Lightweight check used by the AI Settings page's status badge — reports
whether an API key is configured, which model is active, and whether a
bearer token is required. No model call is made.

### `GET /api/health`
Basic liveness check (uptime only).

## Security notes

- Your Anthropic key lives only in `.env` on the server — it is never sent
  to or stored in the browser.
- Set `AI_API_TOKEN` in `.env` to require a bearer token from callers; enter
  the same value in the app's **AI API Settings → Secure Backend Bridge →
  Bearer Token** field.
- `RATE_LIMIT_PER_MINUTE` and `MAX_TOKENS_CAP` bound cost/abuse per IP.
- CORS is currently open (`cors()` with defaults) for ease of local
  development. If you deploy this publicly, restrict `origin` in
  `src/server.js` to your actual frontend domain.

## "RAG" for the AI phases

`src/knowledgeBase.js` retrieves relevant platform facts (attendance
policy, grading scale, fee rules, etc.) per portal role using simple
keyword-overlap scoring, and folds them into the system prompt. It has no
external dependencies. Swap `retrieve()` for a real vector store
(pgvector, Pinecone, etc.) later without touching the API contract.

## Extending to other providers

`anthropicClient.js` is intentionally isolated — if you want the backend
itself to support OpenAI/Gemini/etc. as a server-side fallback chain, add
sibling client modules and branch on a `provider` field in
`server.js`'s `/api/ai/instant` handler. The frontend already passes
`provider` through in the request body.

## Deploying beyond localhost

1. Deploy this folder to any Node host (Render, Railway, Fly.io, a VPS...).
2. Set `ANTHROPIC_API_KEY` and (recommended) `AI_API_TOKEN` in that host's
   environment variables.
3. In the app, open **AI API Settings → Secure Backend Bridge**, set
   **Backend URL** to `https://your-domain/api/ai/instant`, paste the
   bearer token, and click **Save Bridge Settings** then
   **Test Backend Connection**.
