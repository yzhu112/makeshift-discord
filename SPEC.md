# Makeshift DC — voice chat MVP

> Spec doc for the project. Future Claude should read this end-to-end before helping the user on any ticket. User is learning by hand — do NOT write code for them unless they explicitly ask. Hints, pointers, and reviewing their work are in scope.

## Context (for future Claude)

- **User** is a frontend engineer (works with Next.js/shadcn/Tailwind at their day job). Strong React/TS background, but doing backend / sysadmin / WebRTC for the first time.
- **Goal**: voice chat for ~5 friends across Japan, Canada, China. Tokyo VPS so China friends get a predictable Tokyo path instead of internet roulette.
- **Posture**: learning project. User wants to understand each piece. Avoid vibe coding on the backend. Frontend ticket (T15+) is explicitly OK to vibe code — user knows that space.
- **Budget**: ~$2–12/year (domain only). Hosting free via Oracle Cloud Free Tier ARM instance.

## Architecture

```
Browser (JP/CA/CN)
    │
    │  HTTPS :443
    ▼
Caddy (reverse proxy + TLS)
    │
    ├──  / + /assets/*    → static frontend bundle (served by Caddy)
    ├──  /api/*           → Express backend (localhost:3000)
    └──  /livekit/*       → LiveKit server WebSocket (localhost:7880)
                                  │
                                  └─ media (UDP, separate port range)
```

Single Oracle ARM VPS in Tokyo runs Caddy + Express + LiveKit + SQLite, all as systemd units.

## Tech stack (locked in)

**Backend**
- Node 22 LTS, **plain JavaScript** (ES modules via `"type": "module"`), `node --watch` for dev. No tsc, no build step.
- Optional `// @ts-check` + JSDoc per file for type-aware editor without TS syntax.
- Express 4
- better-sqlite3 (synchronous, single-file SQLite)
- express-session + connect-sqlite3 (sessions live in same DB)
- bcrypt (cost 12)
- zod (input validation)
- livekit-server-sdk (issuing LiveKit JWTs)
- pino (structured logging — pairs nicely with `journalctl` later)
- dotenv (local dev only; prod uses systemd `EnvironmentFile=`)

**Frontend** — locked in: Vite + React + `@livekit/components-react` + `@livekit/components-styles`. Styling and TS-vs-JS decided inside T15.

**Infra**
- Caddy 2 (reverse proxy + auto-TLS via Let's Encrypt)
- LiveKit server (single static Go binary)
- systemd for everything
- Oracle Cloud Always Free ARM Ampere A1 (4 cores, 24GB RAM), Tokyo region
- Porkbun domain (`.xyz` first year promo, or `.com` for stable pricing)

**Defer (NOT in MVP)**
- Recording
- Multiple rooms (one hardcoded room: `friends-chat`)
- Video (audio only)
- Mobile apps
- Test suite (manual testing only)
- CI/CD (manual deploy)

## Project layout

```
makeshift-dc/
├── SPEC.md                  (this file)
├── README.md                (user-facing: how to run locally, deploy)
├── .gitignore
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── server.js        (Express app entry)
│   │   ├── config.js        (env var loading)
│   │   ├── logger.js        (pino instance)
│   │   ├── db.js            (better-sqlite3 init + migrations)
│   │   ├── auth.js          (session middleware, login/logout/me)
│   │   ├── livekit.js       (token endpoint)
│   │   └── middleware/      (request logging, error handler, validate)
│   ├── migrations/
│   │   └── 001_init.sql
│   └── data/                (gitignored: voicechat.db)
├── frontend/
│   └── (Vite project, scaffolded in T15)
└── infra/
    ├── Caddyfile
    ├── livekit.yaml
    └── systemd/
        ├── voicechat-backend.service
        └── voicechat-livekit.service
```

## Phases & totals

| Phase | Tickets | Estimated hours |
|-------|---------|----------------|
| 1. Backend foundation | T1–T5 | ~5h |
| 2. SQLite + auth | T6–T11 | ~7h |
| 3. LiveKit (backend side + local server) | T12–T14 | ~4h |
| 4. Frontend | T15–T20 | ~8–12h |
| 5. Deployment | T21–T31 | ~10h |
| **Total** | 31 tickets | **~34–38h** |

Doable across 4–6 weekends if you want. Each ticket is sized for 1–3h with breaks.

---

# Tickets

## Phase 1 — Backend foundation

### T1. Project bootstrap (~1h)

**Goal:** Empty backend project that runs.

**Steps:**
- `cd backend && npm init -y`
- Edit `package.json`: set `"type": "module"`, add scripts: `"dev": "node --watch src/server.js"`, `"start": "node src/server.js"`
- Create folder structure: `src/`, `migrations/`, `scripts/`, `data/`
- `.gitignore` for `node_modules/`, `data/*.db`, `.env`
- Create `.env.example` with placeholder vars (we'll fill in as we add features)
- Make `src/server.js` print "hello" and exit, run with `npm run dev`

**Hints:**
- ESM in Node: use `import x from 'pkg'` everywhere. No `require()`. File extensions required in relative imports: `import x from './foo.js'`.
- `node --watch` (built-in since Node 18.11) replaces nodemon for our needs.

**Acceptance:** `npm run dev` prints "hello", live-reloads when you edit `server.js`.

---

### T2. Express skeleton + health check (~1h)

**Goal:** A running Express app with one route.

**Steps:**
- `npm i express`
- In `src/server.js`: create app, listen on port from env (default 3000)
- Add `GET /api/health` returning `{ ok: true, uptime: process.uptime() }`
- Use `express.json()` middleware (parse JSON bodies)
- Use `cookie-parser` middleware: `npm i cookie-parser`

**Hints:**
- `app.use(express.json())` and `app.use(cookieParser())`
- `app.get('/api/health', (req, res) => res.json({ ok: true }))`

**Acceptance:** `curl localhost:3000/api/health` returns JSON.

---

### T3. Logging with pino (~1h)

**Goal:** Structured request logging and a global logger.

**Steps:**
- `npm i pino pino-http`
- Create `src/logger.js` exporting a pino instance with `level: 'info'` (or env-driven)
- For dev, use `pino-pretty` (`npm i -D pino-pretty`) so logs are readable
- Use `pino-http` middleware in `server.js` to log every request
- **Important:** configure pino-http's `serializers` to NOT log request body or full cookie header — write your own request serializer that strips these

**Hints:**
- `pinoHttp({ logger, serializers: { req: (req) => ({ method: req.method, url: req.url }) } })`
- For dev pretty-print, pipe through pino-pretty: `node src/server.js | pino-pretty` or use pino's transport config
- Why custom serializer: default logs cookies and bodies → password leaks. Don't trust defaults here.

**Acceptance:** Hitting `/api/health` produces a clean log line. Sending a fake `Cookie: secret=foo` header does NOT log the cookie value.

---

### T4. Config / env var module (~1h)

**Goal:** One typed (via JSDoc), validated config object. Fail fast on missing vars.

**Steps:**
- `npm i dotenv`
- Create `src/config.js` that calls `dotenv.config()` at top
- Read env vars: `PORT`, `NODE_ENV`, `SESSION_SECRET`, `SIGNUP_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `DB_PATH`
- Validate at startup: throw if `SESSION_SECRET`, `SIGNUP_SECRET`, or LiveKit vars missing in production
- Export a single `config` object
- Update `.env.example` to list every var

**Hints:**
- `dotenv` should only be called in dev. In prod, systemd sets env vars directly — but calling `dotenv.config()` is harmless if no `.env` exists.
- `process.env.PORT ?? 3000` (with `parseInt` if numeric)
- Consider `@ts-check` + JSDoc on this file specifically — it pays off because every other file imports config.

**Acceptance:** Starting the app without required env vars in `NODE_ENV=production` exits with a clear error. In dev, falls back to sensible defaults.

---

### T5. Error handling middleware (~1h)

**Goal:** Uncaught errors return JSON, not HTML stack traces.

**Steps:**
- Add an error middleware at the END of `server.js` (after all routes)
- Express knows it's an error handler because it takes 4 args: `(err, req, res, next)`
- Log the error via pino
- Return `{ error: 'Internal Server Error' }` with 500 — never leak stack traces to clients in production
- In dev (NODE_ENV !== 'production'), include `err.message` for easier debugging
- Add a 404 handler (catches unmatched routes) before the error handler

**Hints:**
- Error middleware must have exactly 4 params, even if `next` is unused.
- For async route handlers: Express 4 doesn't auto-catch promise rejections. Either wrap with `try/catch + next(err)` or install `express-async-errors` (`npm i express-async-errors`, import once at top of server.js — patches Express). Recommend `express-async-errors`.

**Acceptance:** A route that throws returns a 500 JSON response and logs the error. A nonexistent path returns 404 JSON.

---

## Phase 2 — SQLite + auth

### T6. SQLite setup + migrations (~1.5h)

**Goal:** A SQLite database that exists with the right schema after running migrations.

**Steps:**
- `npm i better-sqlite3`
- Create `migrations/001_init.sql` with `users` and `sessions` tables (see schema below)
- Create `src/db.js`:
  - Opens DB at `config.DB_PATH` (default `./data/voicechat.db`)
  - On startup, runs any `.sql` file in `migrations/` not yet applied
  - Tracks applied migrations in a `migrations` table
  - Exports the `db` instance
- Call db init from `server.js` before `app.listen()`

**Schema for `001_init.sql`:**
```
CREATE TABLE migrations (filename TEXT PRIMARY KEY, applied_at INTEGER);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- sessions table managed by connect-sqlite3 in T8, not here
```

**Hints:**
- better-sqlite3 is synchronous (no `await`). `const db = new Database(path)`.
- `db.exec(sqlString)` for schema. `db.prepare(sql).run(args)` for inserts, `.get()` for one row, `.all()` for many.
- Enable foreign keys: `db.pragma('foreign_keys = ON')`.
- Enable WAL mode for better concurrency: `db.pragma('journal_mode = WAL')`.

**Acceptance:** Starting the app creates `data/voicechat.db` with the tables. Restarting doesn't re-run migrations.

---

### T8. Session store with express-session + connect-sqlite3 (~1h)

> **Execution note:** T8 comes before T7 in the build order. T7 (signup) auto-logs the user in by writing `req.session.userId`, which requires session middleware to exist.

**Goal:** `req.session` available in every route, persisted across restarts.

**Steps:**
- `npm i express-session connect-sqlite3`
- Wire `express-session` middleware in `server.js` AFTER cookie-parser, BEFORE routes
- Use connect-sqlite3 as the store, pointing at the same SQLite file
- Cookie options: `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, `maxAge: 7 * 24 * 60 * 60 * 1000` (7 days)
- Use `config.SESSION_SECRET` (long random string)
- Confirm the `sessions` table appears in SQLite

**Hints:**
- `import session from 'express-session'`
- `import SQLiteStoreFactory from 'connect-sqlite3'` then `const SQLiteStore = SQLiteStoreFactory(session)`
- `new SQLiteStore({ db: 'voicechat.db', dir: './data' })`
- Generate a strong session secret: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`. Put in `.env`.
- `secure: true` in dev breaks the cookie (no HTTPS on localhost) — that's why it's env-gated.

**Acceptance:** Hit any endpoint with curl, observe `Set-Cookie: connect.sid=...; HttpOnly; SameSite=Lax` in response headers.

---

### T7. Signup endpoint (`POST /api/signup`) + bcrypt (~1.5h)

> **Execution note:** Do this after T8 — signup auto-logs the user in by setting `req.session.userId`, so session middleware must already be wired.

**Goal:** A public signup endpoint gated by a shared secret. Anyone with the secret can register; without it, signup is closed. Good enough for ~5 friends.

**Steps:**
- `npm i bcrypt`
- Add `SIGNUP_SECRET` to `src/config.js` and `.env.example` (already added in T4 update).
- Create `src/auth.js` (this is the same file used by T9–T10):
  - `POST /api/signup`: body `{ username, password, signupSecret }`
  - Inline validation for now (zod refactor lands in T11):
    - All three fields present and strings, else 400
    - `username` matches `/^[a-zA-Z0-9_]{1,32}$/`, else 400
    - `password` length 8–128, else 400
  - Constant-time compare `signupSecret` against `config.SIGNUP_SECRET` using `crypto.timingSafeEqual`. On mismatch → 401 `{error: 'Invalid signup secret'}`.
  - `await bcrypt.hash(password, 12)` (async, since this is a request handler not a CLI).
  - Insert into `users`. Catch `SQLITE_CONSTRAINT_UNIQUE` (`err.code === 'SQLITE_CONSTRAINT_UNIQUE'`) → 409 `{error: 'Username taken'}`.
  - Auto-login on success: `req.session.userId = result.lastInsertRowid`. Respond 201 with `{id, username}`.
- Mount `auth.js` routes in `server.js`.

**Hints:**
- Constant-time compare for the secret:
  ```js
  const a = Buffer.from(provided);
  const b = Buffer.from(config.SIGNUP_SECRET);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  ```
  Buffers must be the same length or `timingSafeEqual` throws — hence the length check.
- `bcrypt.hash` is async (returns a promise). `bcrypt.hashSync` exists but blocks the event loop for ~100ms at cost 12 — fine for a CLI, bad for a request handler.
- Better-sqlite3 throws `SqliteError` with a `.code` property — match on `'SQLITE_CONSTRAINT_UNIQUE'`.
- Don't log the password or the signup secret. Pino's request serializer (T3) already strips bodies, but the endpoint code shouldn't pull either into a log line either.
- The signup secret is *not* per-user. It's a single shared string in `.env`. Rotate it by changing the env var and telling your friends the new one.

**Acceptance:**
- `curl -X POST /api/signup` with valid body and correct secret → 201 + `Set-Cookie` header.
- Same request again → 409 (username taken).
- Wrong secret → 401.
- Missing/short password → 400.

---

### T9. Login / logout endpoints (~2h)

**Goal:** Working `POST /api/login`, `POST /api/logout`, and an `auth` middleware that protects routes.

**Steps:**
- Create `src/auth.js`:
  - `POST /api/login`: take `{username, password}`, look up user, `bcrypt.compare`, set `req.session.userId` on success
  - `POST /api/logout`: destroy session
  - `requireAuth` middleware: if `req.session?.userId`, call `next()`; else 401
- Return consistent JSON shapes: `{ok: true}` on success, `{error: '...'}` on failure
- Use **the same error message** for "user not found" and "wrong password" — never leak which is wrong (timing-safe comparison via bcrypt is automatic; just don't branch your messaging)
- Mount auth routes in `server.js`

**Hints:**
- `bcrypt.compare(plaintext, hash)` returns a promise — `await` it (or use `compareSync`)
- `req.session.userId = user.id` — express-session handles persisting it
- `req.session.destroy((err) => ...)` — uses a callback, not a promise (older API)
- Don't bother with refresh tokens, remember-me, password reset, etc. — defer all of it

**Acceptance:** curl flow works: login with right password → success + cookie. Login with wrong password → 401. Logout destroys the session.

---

### T10. `/api/me` endpoint (~1h)

**Goal:** Frontend can check "am I logged in, and as whom?"

**Steps:**
- `GET /api/me` protected by `requireAuth`
- Look up the user by `req.session.userId`
- Return `{username, id}` — never return `password_hash` (just don't `SELECT *`)
- If user was deleted but session exists, treat as logged out (destroy session, return 401)

**Hints:**
- Write the query as `SELECT id, username FROM users WHERE id = ?` — explicit columns, no `*`.
- This is your "session validity" check from the frontend's perspective.

**Acceptance:** curl with cookie → `{username: "alice", id: 1}`. curl without cookie → 401.

---

### T11. Input validation with zod (~1h)

**Goal:** All endpoints with request bodies validate input. Bad input → 400 with safe message.

**Steps:**
- `npm i zod`
- Create `src/middleware/validate.js`: a higher-order middleware that takes a zod schema and returns Express middleware
- On parse failure: 400 with a sanitized error (don't echo the bad input back unfiltered)
- Apply to `/api/login` with a schema like `{username: string min 1 max 64, password: string min 1 max 128}`
- Apply to `/api/signup` (refactor the inline checks from T7 — schema is `{username, password, signupSecret}`)
- Apply to other future endpoints as you add them

**Hints:**
- `z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) })`
- `schema.safeParse(req.body)` → returns `{success, data, error}`
- If success, replace `req.body` with `data` (zod can transform/coerce)
- Why max length on password: defends against bcrypt slowdown attacks (bcrypt has a 72-byte input limit anyway)

**Acceptance:** Sending non-JSON or missing fields to `/api/login` returns 400. Valid input still works.

---

## Phase 3 — LiveKit

### T12. Run LiveKit locally with Docker (~1h)

**Goal:** A LiveKit server running on `ws://localhost:7880` with dev credentials.

**Steps:**
- `infra/livekit.dev.yaml` with port 7880, dev key/secret
- `docker-compose.yml` (in repo root or `infra/`) that runs `livekit/livekit-server` image with that config
- Bring it up: `docker compose up -d`
- Verify: `curl http://localhost:7880` returns LiveKit's welcome message
- Add `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret` to your `.env`

**Hints:**
- LiveKit docs have a ready-made docker-compose example: https://docs.livekit.io/realtime/self-hosting/local/
- The dev key/secret in their example is literally `devkey` / `secret`. Use them as-is for local; you'll generate real ones for prod.
- LiveKit uses UDP for media. Locally this just works. Don't worry about port mapping nuances yet.

**Acceptance:** LiveKit responds on 7880. Docker container shows "running" in `docker ps`.

---

### T13. Backend `/api/livekit-token` endpoint (~1.5h)

**Goal:** Authenticated users can get a short-lived LiveKit JWT for the room.

**Steps:**
- `npm i livekit-server-sdk`
- `POST /api/livekit-token` protected by `requireAuth`
- Build an `AccessToken` with:
  - `identity`: the logged-in user's username
  - Grant: `{roomJoin: true, room: 'friends-chat', canPublish: true, canSubscribe: true}`
  - TTL: 30 minutes
- Return `{token, url: config.LIVEKIT_URL}`

**Hints:**
- `import { AccessToken } from 'livekit-server-sdk'`
- `const at = new AccessToken(apiKey, apiSecret, { identity: username, ttl: '30m' })`
- `at.addGrant({...})`
- `await at.toJwt()` — returns the JWT string
- The room name `friends-chat` is hardcoded for MVP. Don't take it from the request body — that would let any user join any future room.

**Acceptance:** Logged-in curl → returns a JWT. Decode it (jwt.io or `node -e`) and verify the claims look right.

---

### T14. Verify token works against local LiveKit (~1–2h)

**Goal:** Confirm end-to-end: backend issues a token → LiveKit accepts it → you can hear yourself.

**Steps:**
- Use LiveKit's hosted meet client: https://meet.livekit.io
- Set custom server URL: `ws://localhost:7880`
- Paste token from your backend
- Join → should work
- Open in a second browser, login as a different user, get a second token, join same room
- Confirm you can hear yourself / each other (talk into one mic, hear in the other tab's speaker)

**Hints:**
- If you don't have two users yet, run `scripts/add-user.js` for a second.
- If audio doesn't work locally: check mic permission in browser, check that the LiveKit URL in your token response matches what meet.livekit.io is connecting to.
- The official `lk` CLI tool is also useful for diagnostics: `lk room join --url ws://localhost:7880 --token <jwt> friends-chat`

**Acceptance:** Two tabs in the same room, voice flowing both directions. Backend is fully verified.

---

## Phase 4 — Frontend

> Vibe-code zone. User is comfortable here. Tickets are coarser. Be more hands-off on the code, focus help on integration points (auth flow, token refresh, LiveKit component props).

### T15. Frontend scaffolding + style decision (~1–2h)

**Goal:** A running Vite + React project with the styling stack chosen.

**Open decisions to make in this ticket:**
1. **TS or JS?** Recommendation: TS, since you'll be using AI assistance and LiveKit's React SDK is TS-first.
2. **Styling:** plain CSS + `@livekit/components-styles`, or Tailwind, or shadcn? Recommendation: plain CSS for MVP — LiveKit's stylesheet covers the room UI; you only style login + layout. Skip the setup overhead of Tailwind/shadcn unless you want polish from day one.

**Steps:**
- `cd frontend && npm create vite@latest . -- --template react-ts` (or react)
- Install LiveKit: `npm i @livekit/components-react @livekit/components-styles livekit-client`
- Configure Vite proxy: in `vite.config.ts`, `server.proxy: { '/api': 'http://localhost:3000' }`
- Strip the demo content from `App.tsx`
- (Optional) Set up Tailwind/shadcn per their respective install guides

**Hints:**
- LiveKit's React components docs: https://docs.livekit.io/reference/components/react/
- The proxy lets you `fetch('/api/login')` from React without CORS headaches.

**Acceptance:** `npm run dev` shows a blank page on `localhost:5173`. Network requests to `/api/health` succeed (via proxy).

---

### T16. Auth UI: login form + /me check (~2h)

**Goal:** App boots → checks `/api/me` → shows login form or "logged in" state.

**Steps:**
- Auth state in React (Context or a simple top-level useState)
- On mount: fetch `/api/me` with `credentials: 'include'`. If 200, save user; if 401, show login.
- Login form: username + password, POST to `/api/login` with `credentials: 'include'`, then re-fetch `/me`
- Display "Logged in as X" + a logout button (wires up in T19)
- Use `credentials: 'include'` on EVERY fetch — otherwise cookies don't go

**Hints:**
- `fetch('/api/me', { credentials: 'include' })`
- For POSTs: also set `headers: {'Content-Type': 'application/json'}` and `body: JSON.stringify(...)`
- Don't store anything auth-related in localStorage. The cookie is the auth state. `/api/me` is your source of truth.

**Acceptance:** Reload page → if logged in, see logged-in state; if not, see login form. Submit form → login → state updates.

---

### T17. Room UI with LiveKitRoom (~2h)

**Goal:** Logged-in user joins `friends-chat` and can talk.

**Steps:**
- When user is logged in, fetch `POST /api/livekit-token`
- Pass `token` and `serverUrl` to LiveKit's `<LiveKitRoom>` component
- Use their `<RoomAudioRenderer />` (renders remote audio) and a participant list of your choosing
- Set `audio={true}` (publish mic), `video={false}` (audio-only MVP)
- Connect on mount, disconnect on unmount

**Hints:**
- Quick start: https://docs.livekit.io/reference/components/react/component/livekitroom/
- Components you'll use: `LiveKitRoom`, `RoomAudioRenderer`, `useParticipants`, `useConnectionState`, `ControlBar` (gives mute/leave buttons)
- For audio-only chat, `<ControlBar variation="minimal" controls={{ microphone: true, leave: true, screenShare: false, camera: false }} />` is enough.

**Acceptance:** Logged in → audio flowing. Browser prompts for mic permission. You can hear remote participants in a second tab.

---

### T18. Token refresh (~1h)

**Goal:** Long calls don't drop when the 30-min token expires.

**Steps:**
- LiveKitRoom emits events on disconnect / reconnect
- Implement a callback that re-fetches `/api/livekit-token` and reconnects
- Alternatively (simpler): refetch the token every 25 minutes via `setInterval` while connected

**Hints:**
- LiveKit's React SDK has an `onTokenExpired` or similar callback — check current docs
- The simplest approach: set token expiry on the backend to 60 min, refetch on `LiveKitRoom` disconnect callback. Don't over-engineer.

**Acceptance:** Calls lasting > 30 min don't disconnect. (Test by setting expiry low — 2 min — and confirming reconnection.)

---

### T19. Logout + polish (~1h)

**Goal:** Working logout button, basic visual polish.

**Steps:**
- Logout button: calls `POST /api/logout`, clears local user state, disconnects from LiveKit
- Disconnect from LiveKit BEFORE clearing state (otherwise the token-based connection lingers)
- Show participant count, your own name, a simple connection indicator
- Set the document title

**Acceptance:** Logout returns you to the login screen, no audio leaks out. UI doesn't look like a bug bounty submission.

---

### T20. End-to-end manual test (~1h)

**Goal:** Confidence that the local stack works before deploy.

**Steps:** Run through:
- Login as user A in browser, user B in private window → both in room, hear each other
- Wrong password → friendly error
- No mic permission → graceful UI (not a crash)
- Refresh during call → reconnects (or at least relogs cleanly)
- Logout → audio stops
- Check backend logs: no errors, no secrets leaked

**Acceptance:** All flows work. You'd be willing to deploy this.

---

## Phase 5 — Deployment

### T21. Buy domain + initial DNS (~30min)

**Goal:** A domain you own with DNS configurable. (VPS IP set in T22, then come back to point DNS here.)

**Steps:**
- Porkbun (`.xyz` for $1–3 first year, or `.com` for ~$11 flat)
- Use their default DNS — no nameserver changes needed
- Leave DNS records empty for now (we don't have a VPS IP yet)

**Acceptance:** Domain shows up in your Porkbun dashboard.

---

### T22. Provision Oracle Cloud Free Tier VPS (~1–2h)

**Goal:** SSH access to an ARM Ampere A1 instance in Tokyo.

**Steps:**
- Sign up at oracle.com/cloud/free (requires credit card for verification, won't be charged)
- Create a VCN (Virtual Cloud Network) — wizard works
- Launch instance: shape `VM.Standard.A1.Flex`, 4 OCPU, 24GB RAM, Ubuntu 22.04 or 24.04 LTS
- Region: Tokyo (`ap-tokyo-1`)
- Add your SSH public key during creation
- Note the public IP
- SSH in: `ssh ubuntu@<ip>`

**Hints:**
- ARM A1 capacity has historically been hard to get. If "Out of capacity," retry. Some people script the retry. Worst case, fall back to AMD `VM.Standard.E2.1.Micro` (1 OCPU, 1GB) — works but slower.
- Open firewall ports in Oracle's web console AND in Ubuntu's UFW. Two layers, both must allow.
- Required ports: 22 (SSH, source: your IP only ideally), 80 (HTTP, for Caddy ACME), 443 (HTTPS), 7882/UDP (LiveKit RTC — confirm exact range from livekit.yaml in T25)

**Acceptance:** SSH works. `apt update` works.

---

### T23. System setup: user, firewall, security basics (~1h)

**Goal:** A hardened-enough box.

**Steps:**
- Create a `voicechat` system user: `sudo adduser --system --group voicechat`
- Enable `ufw`: allow 22, 80, 443, and LiveKit's UDP range
- Enable `unattended-upgrades` for security patches: `sudo apt install unattended-upgrades && sudo dpkg-reconfigure unattended-upgrades`
- Optional but recommended: install `fail2ban` (blocks SSH brute force)
- Set up swap (Oracle's ARM disk image may not have any): 2GB swap file
- Set hostname to something memorable

**Hints:**
- `ufw allow 22/tcp`, `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw allow 7882/udp` (or whatever LiveKit needs)
- `ufw enable` (will warn about disconnecting SSH — you're allowing 22 first, you'll be fine)
- Don't `ufw allow from any` indiscriminately. Be specific.

**Acceptance:** Reboot the VPS, SSH still works. `ufw status` shows the right rules.

---

### T24. Install runtime: Node, Caddy, LiveKit binary (~1h)

**Goal:** All three binaries present and version-checked.

**Steps:**
- Node 22: install via Nodesource (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` then `apt install nodejs`) or `nvm` if you prefer
- Caddy: official Cloudsmith repo (see https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
- LiveKit: download the latest release binary from https://github.com/livekit/livekit/releases (ARM64 build), put in `/usr/local/bin/livekit-server`, chmod +x

**Hints:**
- `node -v` should show v22.x
- `caddy version` should run
- `livekit-server --version` should run

**Acceptance:** All three binaries respond to version checks.

---

### T25. Deploy LiveKit server (~1.5h)

**Goal:** LiveKit running as a systemd service with production keys.

**Steps:**
- Generate real API key/secret: `livekit-server generate-keys` (or use `openssl rand`)
- Create `/etc/livekit/livekit.yaml` based on https://docs.livekit.io/realtime/self-hosting/deployment/ with:
  - real keys
  - `port: 7880` (signaling)
  - `rtc.tcp_port: 7881`
  - `rtc.udp_port: 7882`
  - `rtc.use_external_ip: true` (auto-detects public IP)
  - Caddy will TLS-terminate, so LiveKit itself stays plain HTTP/WS on localhost
- Create `/etc/systemd/system/livekit.service` (use `infra/systemd/voicechat-livekit.service` as template)
- `systemctl daemon-reload && systemctl enable --now livekit`
- Open the RTC UDP port in UFW

**Hints:**
- LiveKit binds 0.0.0.0 by default for RTC ports (must be reachable from internet for media). Signaling (7880) can be localhost-only since Caddy proxies it.
- Verify with `ss -tunlp | grep livekit`
- Logs: `journalctl -u livekit -f`

**Acceptance:** LiveKit service running, listening on the right ports.

---

### T26. Deploy backend (~1.5h)

**Goal:** Express backend running as systemd service.

**Steps:**
- On laptop: `cd backend && npm ci && (your build/bundle step if any — for plain JS, just rsync the src)`
- `rsync -av --exclude node_modules backend/ ubuntu@vps:/home/voicechat/backend/`
- On VPS: `cd /home/voicechat/backend && npm ci --omit=dev`
- Create `/etc/voicechat/env` (chmod 600, owned by voicechat user) with real env vars
- Create systemd unit `/etc/systemd/system/voicechat-backend.service`:
  - `User=voicechat`
  - `WorkingDirectory=/home/voicechat/backend`
  - `ExecStart=/usr/bin/node src/server.js`
  - `EnvironmentFile=/etc/voicechat/env`
  - `Restart=always`
- `systemctl enable --now voicechat-backend`

**Hints:**
- Run migrations on startup (already wired in T6) — first start creates the DB.
- Verify health: `curl localhost:3000/api/health` from the VPS
- Add at least one user via the CLI script before testing login.

**Acceptance:** Service running. Health check works locally on VPS.

---

### T27. Build & deploy frontend (~1h)

**Goal:** Static bundle on the VPS, ready for Caddy to serve.

**Steps:**
- Local: `cd frontend && npm run build` → produces `dist/`
- `rsync -av frontend/dist/ ubuntu@vps:/var/www/voicechat/`
- Set ownership: `chown -R caddy:caddy /var/www/voicechat` (or whatever user Caddy runs as)

**Acceptance:** `ls /var/www/voicechat` on VPS shows `index.html` and `assets/`.

---

### T28. Caddyfile + TLS (~1h)

**Goal:** HTTPS works, all paths route correctly.

**Steps:**
- Update DNS at Porkbun: A record `voicechat.xyz` → VPS IP. Wait for propagation (test with `dig voicechat.xyz`).
- Create `/etc/caddy/Caddyfile`:

```
voicechat.xyz {
    root * /var/www/voicechat
    encode gzip

    handle /api/* {
        reverse_proxy localhost:3000
    }

    handle /livekit/* {
        uri strip_prefix /livekit
        reverse_proxy localhost:7880
    }

    handle {
        try_files {path} /index.html
        file_server
    }
}
```

- `systemctl reload caddy`
- Caddy auto-fetches a Let's Encrypt cert on first request to the domain
- Update `LIVEKIT_URL` in backend `.env` to `wss://voicechat.xyz/livekit`

**Hints:**
- The `try_files {path} /index.html` line is for SPA routing — falls back to index.html if a route doesn't match a file.
- Caddy auto-handles WebSocket upgrades for `/livekit/*` because `reverse_proxy` is WebSocket-aware.
- If TLS fails: check that port 80 is open (Let's Encrypt's HTTP challenge needs it).
- Logs: `journalctl -u caddy -f`

**Acceptance:** `https://voicechat.xyz` loads the frontend. `https://voicechat.xyz/api/health` returns JSON. Browser shows valid TLS cert.

---

### T29. Production end-to-end test (~1h)

**Goal:** Real call works, you and at least one friend.

**Steps:**
- Add real user accounts via the CLI script
- You log in, friend in another country logs in
- Talk for a few minutes
- Check `journalctl -u livekit -u voicechat-backend` for errors
- Try mobile browser (iPhone Safari is the historically tricky one for WebRTC)

**Acceptance:** Voice works across countries. No error spam in logs.

---

### T30. Daily backup script (~1h)

**Goal:** Daily SQLite snapshot somewhere safe.

**Steps:**
- Write a shell script that copies `voicechat.db` to a timestamped tarball
- Push to Oracle Object Storage (free tier includes 20GB) OR scp to your laptop OR upload to a private GitHub repo
- Use SQLite's `.backup` command (creates a consistent snapshot even while DB is in use), not just `cp`
- Cron entry: daily at 4am
- Keep last 14 days, delete older

**Hints:**
- `sqlite3 voicechat.db ".backup '/tmp/backup.db'"` — safe even with live writes
- Oracle CLI: `oci os object put --bucket-name ... --file ...` (set up `oci` config first)
- Backup file should NOT include `.env` files separately — keep secrets out of routine backups

**Acceptance:** Cron runs daily. Manual `ls` of backup destination shows recent files.

---

### T31. Monitoring basics (~1h)

**Goal:** You find out when it's down before your friends do.

**Steps:**
- Pick: Uptime Kuma (self-hosted, runs on the same VPS) or external (UptimeRobot free tier)
- If Uptime Kuma: install via Docker or npm, set up monitors for `/api/health`, the frontend root, and the LiveKit signal port
- Add email/Discord webhook alert
- Optional: install `htop` and `netdata` for real-time stats

**Acceptance:** Stop the backend (`systemctl stop voicechat-backend`) → get an alert within a few minutes. Restart → recovers.

---

# Notes for future Claude

- Most tickets are designed to be self-contained. If the user is on T9, they shouldn't need to read T15.
- If the user gets stuck on a ticket, ask them what they've tried before suggesting next steps. They want to figure things out, not be handed answers.
- Watch for "should I refactor this?" temptation. The MVP doesn't need it. Ship first.
- Anything tagged "Defer" at the top is genuinely deferred — don't sneak it in.
- When the user says "vibe code," they mean the frontend tickets (T15–T20). Backend is hand-coded.
