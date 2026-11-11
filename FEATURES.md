# AlphaPost clone — A→Z feature & logic map

This document explains **what** each part of the clone does and **how the logic
works**, feature by feature, so you can understand or extend it. It mirrors the
real AlphaPost product surface (landing, community, 16 tools, connections,
composer, automation, dashboard) and its stated mechanics (BYO keys, AES‑256
encryption, Gemini writing + humanizer, GitHub‑Actions scheduling).

Legend: 🤖 = AI-backed · 🧩 = deterministic · 🌐 = makes network calls ·
🔒 = handles secrets.

---

## 0. Architecture at a glance

- **Zero dependencies.** Node 22+ standard library only; global `fetch` for
  outbound calls. No build step; the frontend is one vanilla‑JS SPA.
- **Store** (`src/lib/store.js`): each collection is a JSON file in `data/`.
  Reads are cached in memory; writes are atomic (`tmp` + `rename`) and
  serialized per collection to avoid corruption.
- **Router** (`src/lib/router.js`): pattern router with `:params`.
- **Server** (`src/server.js`): serves `/api/*`, static assets, the SPA shell,
  and runs a 1‑minute scheduler tick.

---

## A. Accounts & authentication
🔒 `src/routes/auth.js`, `src/lib/crypto.js`

- **Register**: validates email + password (≥8 chars), rejects duplicates,
  hashes the password with **scrypt** (per‑user salt), creates the user, sets a
  signed session cookie, increments the `members` counter.
- **Login**: constant‑time password compare (`timingSafeEqual`).
- **Sessions**: `HMAC‑SHA256` signed, `base64url` payload, `exp` claim,
  HttpOnly + SameSite=Lax cookie.
- **Guard**: `requireUser()` returns 401 for protected API routes.

## B. Blog automation
🤖🌐 `src/services/ai.js`, `src/services/connectors.js` (`blogger`)

- An order writes a full article, then publishes to **Blogger v3 API**
  (`/blogs/{blogId}/posts`) with title, HTML body and labels.
- Markdown → HTML conversion is handled by `mdToHtml()` (headings, bold, links).
- Requirements mirror the real product: Blogger API key + Blog ID, plus an
  OAuth access token from "Authorize Blogger".

## C. Composer
🤖 `src/routes/composer.js`, `public/app.js` (Composer view)

- **Write**: builds a prompt (topic, tone, length, category, audience, extra),
  calls the AI engine, humanizes, extracts title/tags, computes readability.
- **Publish**: sends to every selected account immediately, **or** stores a
  `scheduled` post when a future time is given.
- **History**: `GET /api/posts`, filter by status.

## D. Dashboard & live numbers
🧩 `src/routes/dashboard.js`

- Public `/api/stats` powers the landing page's "live numbers" (members,
  articles, posts, videos, community posts, countries).
- Authenticated `/api/dashboard` returns counts, recent posts and upcoming runs.

## E. Encryption & secrets
🔒 `src/lib/crypto.js`, `src/lib/accounts.js`

- **AES‑256‑GCM** field encryption with two independent keys derived from
  `APP_SECRET` (session signing vs. field encryption never share material).
- Account credentials and AI/GitHub keys are stored as encrypted blobs; the API
  only ever returns which fields are *set*, never their values.
- Matches the product claim "keys encrypted with AES‑256 before saving".

## F. Facebook Page auto post
🌐 `connectors.js` (`facebook_page`) → Graph `/{pageId}/feed`.

## G. Gemini integration
🤖 `src/services/ai.js`

- `resolveProvider()` picks, in order: a per‑call inline key → the user's
  encrypted Gemini key → the user's OpenAI key → **mock**.
- Gemini calls `/v1beta/models/{model}:generateContent` with a system
  instruction that forbids AI tells; supports JSON mode for structured tools.
- A 45s abort timeout guards slow responses.

## H. Humanizer (signature feature)
🧩 `src/lib/humanizer.js`

Six deterministic passes over raw model output:
1. **Word swaps** — replaces AI‑favourite words (`leverage`→`use`,
   `delve`→`look`, `robust`→`solid`, ~45 entries).
2. **Phrase strip** — removes stock openers/closers (`in conclusion`,
   `in today's fast-paced world`, `first and foremost`).
3. **Dash removal** — converts em/en dashes to commas.
4. **Punctuation cleanup** — collapses doubled spaces/punctuation.
5. **Rhythm mixing** — splits overly long sentences at safe connectors.
6. **Whitespace normalisation**.
Returns the text **plus a change list** and a **readability** score
(Flesch‑style). This is what makes output "read like a human wrote it".

## I. Instagram
🌐 `connectors.js` (`instagram`) → container `/{igUserId}/media` then
`/media_publish`. Needs a hosted media URL (captions alone are stored as a draft).

## J. JADX / native RE note
ℹ️ Not part of the product; the REA/Ghidra tooling from earlier is unrelated and
cannot run in this sandbox. This clone is pure web‑app logic.

## K. Keyword research
🧩🤖 `tools.js` → `keywordResearch()`

- Expands the seed with modifiers (`how to`, `best`, `near me`, `2026`, …),
  estimates **volume** and **difficulty** heuristically, and infers **intent**
  (informational/commercial/transactional/navigational).
- If the user has an AI key, asks the model for extra long‑tail terms (JSON
  mode) and merges/dedupes them.

## L. Lazy/local mode (offline mock)
🧩 `ai.js` `mockWrite()`, `connectors.js` `mock()`

- With no keys and `MOCK_PUBLISHING=true`, the app writes content and "publishes"
  with simulated IDs/URLs. Every feature is testable offline; results are
  flagged `mocked: true` in the UI.

## M. Metrics & counters
🧩 `store.js` → `bumpStat()`, `getStats()`

- Global counters (`members`, `posts_sent`, `articles_published`,
  `videos_made`, `community_posts`, `countries`, `tool_runs`,
  `connections_made`) drive the landing page.

## N. Network capture safety
🔒 Outbound calls only happen when **not** mocking; the AEO checker and
Website‑to‑social fetchers use a clear `User-Agent` and cap response size
(`400 KB`) to avoid abuse.

## O. Orders (automation jobs)
🤖 `src/routes/automation.js`, `src/services/scheduler.js`

- Fields: name, topic/prompt, tone, words, category, audience, **cron
  schedule**, target accounts, optional `runOnGitHub`.
- **Free tier cap** of 5 orders (as in the product FAQ).
- **Run now** executes immediately; **Pause/Resume** toggles status; next run is
  computed from the cron expression.

## P. Publishers (connectors)
🌐 `src/services/connectors.js`

A registry of 9 platforms, each declaring metadata, required credential fields
and a `publish()` that performs the real API call: **Telegram, Blogger,
Facebook Page, Instagram, X, Pinterest, TikTok, YouTube, Dailymotion**.
`publishToAccount()` never throws — it returns `{ok, error}` so a partial run is
recorded per target.

## Q. Quiet failures & resilience
🧩 Every publish is wrapped; failures are stored on the post record and shown as
`failed` in the dashboard, matching the product's "tries again" behaviour
conceptually (retry can be layered on the generated GitHub workflow).

## R. Rate limits, BYO keys
ℹ️ The product is free because **you bring your own keys** and scheduling runs
on **your own GitHub Actions** (2000 free minutes/month). The clone reproduces
both: per‑user keys in Settings, and a generated `alphapost-cron` workflow file.

## S. Scheduling & cron
🧩 `scheduler.js`

- 5‑field cron parser/validator, `cronMatches()`, `nextRun()` and a
  human‑readable `describeCron()`.
- `generateWorkflow(order)` produces a GitHub Actions YAML that POSTs to
  `/api/orders/:id/run` with a bearer token — exactly the "workflow in your
  account" model.
- An in‑process 60s ticker runs due orders and due **scheduled** composer posts.

## T. Tools catalogue
🧩🤖 `src/services/tools.js` → `TOOL_CATALOG`

All 16 tools with their `kind` (`ai` / `video` / `seo` / `app`) so the UI and
`POST /api/tools/:id/run` dispatch generically. Each run is logged with a
redacted input and a summary.

## U. UX / UI
🎨 `public/`

- Single‑page app: landing, auth, tools grid + detail, community, composer,
  connections, automation, dashboard, settings.
- Client router with `history.pushState`, data‑route links, toast notifications,
  inline loading spinners, accessible forms.

## V. Video tools (AI video / Shorts / Translator)
🤖 `tools.js`

- Produce an **edit plan + AI script** (scenes, timings, aspect 9:16, hooks).
  Real transcoding is a rendering concern (wire to `ffmpeg`) — the logic and
  data model are complete so a worker can execute them.

## W. Website → social
🌐 `tools.js` → `websiteToSocial()`

- Discovers articles from `sitemap.xml` or RSS/Atom feeds, falling back to
  homepage link scraping; produces ready‑to‑share captions per article.

## X. X (Twitter) auto post
🌐 `connectors.js` (`x`) → `POST /2/tweets` with the body + hashtags, trimmed to
280 chars.

## Y. (Y)ou & profile
🧩 `src/routes/accounts.js`

- Profile name + avatar colour; per‑user key status endpoint (`/api/keys`).

## Z. Zero‑dependency guarantee
🧩 No `node_modules`, no bundler, no framework. `npm start` (or `node
src/server.js`) is the entire runtime. Portable to any Node 22+ host.

---

## Data model (collections in `data/*.json`)

| Collection | Key fields |
|---|---|
| `users` | email, name, passwordHash, avatarColor, `geminiKeyEnc`, `openaiKeyEnc`, `githubTokenEnc`, `orderToken` |
| `accounts` | userId, platform, label, handle, status, `credentialsEnc` |
| `orders` | userId, topic, prompt, tone, words, category, schedule, accountIds, status, runOnGitHub |
| `posts` | userId, accountId(s), platform(s), title, body, tags, status, scheduledFor, error |
| `tools` | userId, toolId, input (redacted), summary |
| `community` | userId, parentId, slug, title, body, votes, views |
| `logs` | userId, action, meta |
| `stats` | key, value |

## Security checklist

- [x] scrypt password hashing + timing‑safe compare
- [x] signed, expiring, HttpOnly session cookies
- [x] AES‑256‑GCM at rest for all credentials
- [x] secrets never returned by the API (only "set / not set")
- [x] `nosniff`, `X-Frame-Options`, `Referrer-Policy` headers
- [x] bounded request bodies (1 MB) and bounded outbound reads (400 KB)
- [ ] swap JSON store for a DB + real secret manager before production
