# AlphaPost clone

A working clone of [alphapost.io](https://alphapost.io/) — free social-media
automation, AI content generation and a creator community — rebuilt as a
**zero-dependency Node.js app**. No `npm install` is required to run it: it uses
only the Node standard library and the built-in `fetch`.

> For lawful, authorized use only. See the original project's disclaimer.

## What it does

- **One account, everything.** Email signup, sessions, profile.
- **Connect 9 publishers** (Facebook Page, Instagram, X, Pinterest, Telegram,
  TikTok, YouTube, Dailymotion, Blogger) with opt-in, encrypted credentials.
- **Composer** — write one post, send it to many accounts now or on a schedule.
- **Automation orders** — pick a topic + a cron schedule; it writes and posts
  by itself. Optional GitHub Actions workflow is generated for scheduling on
  your own account (the original site's model).
- **16 free tools** — AI video maker, Shorts Maker, Video Translator, Carousel
  maker, Blogger automation, Facebook/Instagram/X/Telegram/Pinterest/TikTok/
  YouTube auto post, Keyword Research, AEO Checker, Website-to-social,
  Community.
- **AI engine** with a signature **humanizer**, plus **offline mock mode** so
  every feature is testable without spending API quota.
- **Community** — threads, replies, votes, views.

See [`FEATURES.md`](./FEATURES.md) for the A→Z feature + logic map.

## Requirements

- **Node.js 22+** (uses the global `fetch`, ESM, and `node:crypto`).
- Nothing else. No database, no build step, no npm dependencies.

## Run it

```bash
cd alphapost-clone
cp .env.example .env      # optional; a safe default config works with no .env

# optional demo data (community posts + big "live numbers")
node scripts/seed.js

npm start                  # or: node src/server.js
```

Then open the URL it prints (http://localhost:3000).

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP server bind |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | used in generated workflow links |
| `APP_SECRET` | dev placeholder | **change this in production**; signs sessions + derives the AES key |
| `DATA_DIR` | `./data` | where JSON datastore files live |
| `GEMINI_MODEL` | `gemini-2.0-flash` | default Gemini model |
| `OPENAI_MODEL` | `gpt-4o-mini` | default OpenAI fallback model |
| `MOCK_PUBLISHING` | `true` | simulate platform APIs instead of calling them |

Per-user keys (Gemini / OpenAI / GitHub) are entered in **Settings** and stored
**AES‑256‑GCM encrypted** in the datastore; they are never returned to the client.

## Try the AI without a key

Leave Settings empty and every AI feature falls back to the deterministic
**offline mock writer**, so the whole app is demoable end‑to‑end. Add a free
Google Gemini key (Google AI Studio) in **Settings** to get real generations.

## Security model

- Passwords: **scrypt** with per-user salt.
- Sessions: **HMAC‑SHA256 signed** cookies, HttpOnly + SameSite=Lax.
- Platform tokens / API keys: **AES‑256‑GCM** at rest, two independent keys
  derived from `APP_SECRET`.
- A tiny **humanizer** post-processor removes AI tells (see FEATURES.md).

> The JSON datastore is fine for a single self-hosted instance. Before running
> multiple instances or real traffic, move to a real database and a proper
> secret manager.

## Project layout

```
alphapost-clone/
├─ src/
│  ├─ server.js            # HTTP server + router wiring + scheduler tick
│  ├─ config.js            # env + paths (.env loader)
│  ├─ lib/
│  │  ├─ crypto.js         # AES-256-GCM, scrypt, signed sessions
│  │  ├─ store.js          # JSON datastore + counters + activity log
│  │  ├─ http.js           # request/response, cookies, static files
│  │  ├─ router.js         # tiny pattern router
│  │  ├─ auth.js           # session attach + guards
│  │  └─ accounts.js       # encrypted account credentials
│  ├─ services/
│  │  ├─ ai.js             # Gemini/OpenAI + mock + prompt builder
│  │  ├─ humanizer.js      # AI-tell removal + readability
│  │  ├─ connectors.js     # 9 publishers (real API shapes + mock)
│  │  ├─ scheduler.js      # cron, GitHub workflow, order runs
│  │  └─ tools.js          # keyword/AEO/video/shorts/carousel/w2s
│  └─ routes/              # auth, accounts, composer, automation, tools, community, dashboard
├─ public/                 # index.html, styles.css, app.js (SPA, no build)
└─ scripts/seed.js
```

## API (quick reference)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | auth |
| GET | `/api/auth/me` · `/api/dashboard` · `/api/stats` | profile + counters |
| GET/POST | `/api/accounts` | list / connect accounts |
| POST | `/api/accounts/:id/authorize` | "Authorize Blogger" |
| PUT | `/api/keys` | store encrypted AI/GitHub keys |
| POST | `/api/composer/write` · `/api/composer/publish` | generate / publish |
| GET/POST | `/api/orders` | automation jobs |
| POST | `/api/orders/:id/run` · `/pause` | run now / pause |
| GET | `/api/orders/:id/workflow` | GitHub Actions file |
| GET | `/api/cron/preview?expr=` | cron → words + next run |
| POST | `/api/tools/:id/run` | run any tool |
| GET/POST | `/api/community…` | threads, replies, votes |

## Extending

- **Real OAuth**: replace the `/oauth/*` placeholder in `src/server.js` with the
  provider redirect + token exchange, then store the token via
  `/api/accounts/:id/authorize`.
- **Real video rendering**: `tools.js` returns an edit *plan*; wire it to
  `ffmpeg` in a worker to actually cut/translate.
- **Real scheduler at scale**: the in-process ticker is fine for one instance;
  for many, run the generated GitHub Actions workflow (already supported) or an
  external cron hitting `/api/orders/:id/run`.

MIT licensed. Built as a study/reconstruction of the AlphaPost product.
