// ── AlphaPost clone — single-page frontend (vanilla, no build step) ─────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const state = { user: null, platforms: [], tools: [] };

// ── tiny API client ─────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = raw ? await res.text() : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ── toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtRel = (iso) => {
  if (!iso) return '—';
  const d = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(d);
  const units = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  for (const [u, s] of units) {
    if (abs >= s || u === 's') {
      const n = Math.round(abs / s);
      return d >= 0 ? `in ${n}${u}` : `${n}${u} ago`;
    }
  }
};

// ── navigation ──────────────────────────────────────────────────────────────
function go(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

function renderNav() {
  const path = location.pathname;
  $$('.mainnav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === path));
  const tr = $('#topright');
  if (state.user) {
    tr.innerHTML = `
      <a class="btn small ghost" href="/composer" data-route>New post</a>
      <a href="/settings" data-route class="avatar" style="background:${esc(state.user.avatarColor)}" title="${esc(state.user.name)}">${initials(state.user.name)}</a>`;
  } else {
    tr.innerHTML = `<a class="btn small ghost" href="/login" data-route>Log in</a><a class="btn small primary" href="/register" data-route>Start free</a>`;
  }
}

// ── router ──────────────────────────────────────────────────────────────────
async function render() {
  renderNav();
  const path = location.pathname;
  const routes = [
    [/^\/$/, viewHome],
    [/^\/login$/, viewLogin],
    [/^\/register$/, viewRegister],
    [/^\/tools$/, viewTools],
    [/^\/tools\/([\w-]+)$/, (m) => viewToolDetail(m[1])],
    [/^\/community$/, viewCommunity],
    [/^\/community\/([\w-]+)$/, (m) => viewCommunityThread(m[1])],
    [/^\/composer$/, viewComposer],
    [/^\/connections$/, viewConnections],
    [/^\/automation$/, viewAutomation],
    [/^\/dashboard$/, viewDashboard],
    [/^\/settings$/, viewSettings],
  ];
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try { await fn(m); } catch (err) { view.innerHTML = `<div class="wrap"><div class="card"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div></div>`; }
      return;
    }
  }
  view.innerHTML = `<div class="wrap center" style="padding:80px 0"><h1>404</h1><p class="muted">No page here.</p><a class="btn primary" href="/" data-route>Back home</a></div>`;
}

function requireLogin() {
  if (state.user) return true;
  view.innerHTML = `<div class="wrap center" style="padding:80px 0"><h1>Please log in</h1><p class="muted">This area needs an account.</p><div class="inline center" style="justify-content:center"><a class="btn primary" href="/login" data-route>Log in</a><a class="btn" href="/register" data-route>Create account</a></div></div>`;
  return false;
}

// ── landing ─────────────────────────────────────────────────────────────────
async function viewHome() {
  const [stats, tools] = await Promise.all([api('/api/stats'), api('/api/tools')]);
  state.tools = tools.tools;
  const featured = state.tools.slice(0, 6);
  view.innerHTML = `
  <section class="hero wrap">
    <span class="eyebrow">Free to use, no card needed</span>
    <h1>Free tools and a community for people who publish online</h1>
    <p class="lead">Auto post to eight social sites, write full articles on your own blog, make AI videos and shorts, and ask other creators what is actually working. One free account for all of it.</p>
    <ul class="checks"><li>${stats.tools} free tools</li><li>No monthly plan</li><li>One account for everything</li></ul>
    <div class="inline">
      <a class="btn primary" href="/register" data-route>Start free</a>
      <a class="btn" href="/community" data-route>Open the community</a>
    </div>
  </section>

  <section class="wrap">
    <h2 class="center muted">Live numbers</h2>
    <div class="stats">
      ${[['members', 'members'], ['articles_published', 'articles published'], ['posts_sent', 'posts sent'], ['videos_made', 'videos made'], ['community_posts', 'community posts'], ['countries', 'countries']]
        .map(([k, label]) => `<div class="stat"><b>${Number(stats[k] || 0).toLocaleString()}</b><span>${label}</span></div>`).join('')}
    </div>
  </section>

  <section class="wrap">
    <h2>Everything AlphaPost does</h2>
    <p class="muted">Sixteen free tools on one account, and each one has its own page.</p>
    <div class="grid" id="toolgrid">${featured.map(toolTile).join('')}</div>
    <p style="margin-top:16px"><a class="btn" href="/tools" data-route>See all 16 tools →</a></p>
  </section>

  <section class="wrap">
    <h2>How it works</h2>
    <div class="steps">
      <div class="step"><h3>Make a free account</h3><p class="muted">One account opens every tool and the community. No card.</p></div>
      <div class="step"><h3>Connect what you have</h3><p class="muted">Facebook Page, Instagram, Blogger, Pinterest, Telegram, X, TikTok, YouTube.</p></div>
      <div class="step"><h3>Add your free Gemini key</h3><p class="muted">From Google AI Studio, in about a minute. Stays encrypted.</p></div>
      <div class="step"><h3>Set it and leave it</h3><p class="muted">Pick a topic and a time. AlphaPost writes, makes and posts.</p></div>
    </div>
  </section>

  <section class="wrap">
    <h2>Questions people ask</h2>
    <div class="grid wide">
      ${[['Is AlphaPost free?', 'Yes. Every tool is free, no card. AI features run on your own free Google Gemini key.'],
        ['What can it do?', 'Auto post to Facebook, Instagram, X, Pinterest, Telegram, TikTok, YouTube and Dailymotion; write Blogger articles; make videos, shorts and carousels; research keywords; check AEO.'],
        ['Do I need one account?', 'Yes, one free account opens the tools and the community.'],
        ['Where do my videos go?', 'Made on your device and sent to the platform you pick.'],
        ['Is my data safe?', 'Keys and tokens are AES-256 encrypted before saving and used only to post for you.'],
        ['Is there an app?', 'The website works everywhere. Wrap it as a PWA or build the Android shell.']]
        .map(([q, a]) => `<div class="card"><h3>${esc(q)}</h3><p class="muted">${esc(a)}</p></div>`).join('')}
    </div>
  </section>

  <section class="wrap center">
    <h2>Start with one free account</h2>
    <p class="muted">Every tool, the community, no card and no trial.</p>
    <a class="btn primary" href="/register" data-route>Start free</a>
  </section>`;
}

function toolTile(t) {
  return `<a class="tile" href="/tools/${esc(t.id)}" data-route><h3>${esc(t.name)}</h3><p class="muted small">${esc(t.desc)}</p></a>`;
}

// ── auth ────────────────────────────────────────────────────────────────────
function authShell(title, sub, formHtml) {
  view.innerHTML = `<div class="wrap" style="max-width:460px;padding-top:60px">
    <div class="card">
      <h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p>
      ${formHtml}
    </div></div>`;
}

function viewRegister() {
  authShell('Make your account', 'Free, and it takes one minute.', `
    <form id="f">
      <label>Name</label><input name="name" autocomplete="name" placeholder="Your name" />
      <label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
      <label>Password</label><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters" />
      <p style="margin-top:16px"><button class="btn primary" style="width:100%" type="submit">Create free account</button></p>
    </form>
    <p class="muted small">Already have one? <a href="/login" data-route>Log in</a>.</p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { user } = await api('/api/auth/register', { method: 'POST', body });
      state.user = user; toast('Welcome!', 'ok'); go('/dashboard');
    } catch (err) { toast(err.message, 'err'); }
  });
}

function viewLogin() {
  authShell('Welcome back', 'Log in to your tools and community.', `
    <form id="f">
      <label>Email</label><input name="email" type="email" required autocomplete="email" />
      <label>Password</label><input name="password" type="password" required autocomplete="current-password" />
      <p style="margin-top:16px"><button class="btn primary" style="width:100%" type="submit">Log in</button></p>
    </form>
    <p class="muted small">New here? <a href="/register" data-route>Create a free account</a>.</p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body });
      state.user = user; toast('Logged in', 'ok'); go('/dashboard');
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── tools ───────────────────────────────────────────────────────────────────
async function viewTools() {
  const { tools } = await api('/api/tools');
  state.tools = tools;
  view.innerHTML = `<div class="wrap">
    <section><h1>All the tools</h1><p class="muted">Sixteen free tools on one account. Nothing costs money and nothing needs a card.</p>
    <div class="grid">${tools.map(toolTile).join('')}</div></section></div>`;
}

const TOOL_FORMS = {
  'keyword-research': () => `<label>Seed keyword</label><input name="seed" placeholder="e.g. blog automation" required /><p class="muted small">Adds modifiers + long-tail variants and scores difficulty.</p>`,
  'aeo-checker': () => `<label>Page URL</label><input name="url" placeholder="https://example.com/post" required /><p class="muted small">Checks whether AI answer engines can quote your page.</p>`,
  'website-to-social': () => `<label>Site URL</label><input name="site" placeholder="https://myblog.com" required /><label>Max articles</label><input name="limit" type="number" value="5" min="1" max="20" />`,
  'shorts-maker': () => `<label>Source video URL or file name</label><input name="source" placeholder="long-video.mp4" /><label>Topic / hook</label><input name="topic" placeholder="best tips for X" /><label>How many shorts</label><input name="count" type="number" value="3" min="1" max="10" />`,
  'ai-video-maker': () => `<label>Idea</label><input name="idea" placeholder="a 30s reel about morning routines" required /><label>Length (seconds)</label><input name="seconds" type="number" value="30" min="15" max="180" />`,
  'video-translator': () => `<label>Video URL or file name</label><input name="video" placeholder="clip.mp4" /><label>Target language</label><select name="language"><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="hi">Hindi</option><option value="ur">Urdu</option><option value="ar">Arabic</option><option value="pt">Portuguese</option><option value="id">Indonesian</option></select>`,
  'instagram-carousel': () => `<label>Topic</label><input name="topic" placeholder="5 ways to grow on Instagram" required /><label>Slides</label><input name="slides" type="number" value="6" min="3" max="10" />`,
};

async function viewToolDetail(id) {
  const tool = state.tools.find((t) => t.id === id) || (await api('/api/tools')).tools.find((t) => t.id === id);
  if (!tool) { view.innerHTML = `<div class="wrap center" style="padding:80px"><h1>Unknown tool</h1></div>`; return; }
  const form = TOOL_FORMS[id] || (() => `<label>Topic</label><input name="topic" required placeholder="What should it write about?" /><label>Extra instructions (optional)</label><textarea name="extra" placeholder="Tone, length, must-mention points..."></textarea>`);
  view.innerHTML = `<div class="wrap">
    <section>
      <a class="muted small" href="/tools" data-route>← All tools</a>
      <h1 style="margin-top:8px">${esc(tool.name)}</h1>
      <p class="muted">${esc(tool.desc)}</p>
      <div class="split">
        <div class="card">
          <form id="f">${form()}<p style="margin-top:16px"><button class="btn primary" id="run" type="submit">Run tool</button></p></form>
        </div>
        <div class="card" id="out"><p class="muted">Results appear here.</p></div>
      </div>
    </section></div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#run'); const prev = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Working…'; btn.disabled = true;
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { result } = await api(`/api/tools/${id}/run`, { method: 'POST', body });
      $('#out').innerHTML = renderToolResult(id, result);
    } catch (err) { $('#out').innerHTML = `<p class="pill err">${esc(err.message)}</p>`; toast(err.message, 'err'); }
    btn.innerHTML = prev; btn.disabled = false;
  });
}

function renderToolResult(id, r) {
  if (id === 'keyword-research') {
    return `<h3>${r.keywords.length} keywords for “${esc(r.seed)}”</h3>
      <table style="width:100%">${r.keywords.slice(0, 14).map((k) => `<tr><td>${esc(k.keyword)}</td><td class="muted small">${k.volume}/mo</td><td><span class="badge">KD ${k.difficulty}</span></td><td class="muted small">${esc(k.intent)}</td></tr>`).join('')}</table>`;
  }
  if (id === 'aeo-checker') {
    if (r.error) return `<p class="pill err">${esc(r.error)}</p>`;
    return `<h3>AEO score: ${r.score}/100 <span class="badge">${esc(r.grade)}</span></h3>
      <p class="muted small">${r.words} words · HTTP ${r.status}</p>
      <ul style="list-style:none;padding:0">${r.checks.map((c) => `<li>${c.pass ? '✅' : '❌'} ${esc(c.label)}</li>`).join('')}</ul>
      ${r.suggestions.length ? `<h3>Fix these</h3><ul>${r.suggestions.map((s) => `<li class="muted">${esc(s)}</li>`).join('')}</ul>` : '<p class="pill ok">Looks great for AI answers.</p>'}`;
  }
  if (id === 'website-to-social') {
    if (r.error) return `<p class="pill err">${esc(r.error)}</p>`;
    return `<h3>${r.shares.length} articles found</h3>${r.shares.map((s) => `<div class="thread"><b>${esc(s.title)}</b><p class="muted small">${esc(s.url)}</p><pre>${esc(s.caption)}</pre></div>`).join('') || '<p class="muted">No articles discovered.</p>'}`;
  }
  if (id === 'shorts-maker') {
    return `<h3>${r.shorts.length} shorts planned</h3>${r.shorts.map((s) => `<div class="thread"><b>#${s.index} ${esc(s.title)}</b><p class="muted small">${s.startSec}s–${s.endSec}s · ${s.aspect}</p><p>${esc(s.hook)}</p></div>`).join('')}<p class="muted small">Renderer: ${esc(r.renderer)}</p>`;
  }
  if (id === 'ai-video-maker') {
    return `<h3>${esc(r.title)}</h3><p class="muted small">${r.seconds}s · ${r.aspect} · ${r.scenes.length} scenes</p>${r.scenes.map((s) => `<div class="thread"><b>Scene ${s.scene}</b> <span class="muted small">(${s.durationSec}s)</span><p>${esc(s.voiceover)}</p><p class="muted small">${esc(s.visual)}</p></div>`).join('')}`;
  }
  if (id === 'video-translator') {
    return `<h3>Translation plan (${esc(r.language)})</h3><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><pre>${esc(r.script.body || '')}</pre>`;
  }
  if (id === 'instagram-carousel') {
    return `<h3>${r.slides.length}-slide carousel</h3>${r.slides.map((s) => `<div class="thread"><b>Slide ${s.slide}</b><p>${esc(s.text)}</p></div>`).join('')}<p class="muted small">${esc(r.caption)}</p>`;
  }
  // generic content tools
  return `<h3>${esc(r.title || 'Draft')}</h3>
    <p class="muted small">via ${esc(r.provider)}${r.mocked ? ' (offline mock — add a Gemini key in Settings for real AI)' : ''}</p>
    ${r.meta?.readability ? `<p class="muted small">Readability: ${r.meta.readability.grade} (${r.meta.readability.score}) · ${r.meta.readability.words} words${r.meta.humanized ? ' · humanized' : ''}</p>` : ''}
    <pre style="max-height:360px">${esc(r.body || '')}</pre>
    <button class="btn small" onclick="navigator.clipboard.writeText(${JSON.stringify(r.body || '').replace(/"/g, '&quot;')})">Copy</button>`;
}

// ── community ───────────────────────────────────────────────────────────────
async function viewCommunity() {
  const { threads } = await api('/api/community');
  const newForm = state.user
    ? `<div class="card"><h3>Start a discussion</h3><form id="nf"><label>Title</label><input name="title" required minlength="6" placeholder="What do you want to ask or share?" /><label>Body</label><textarea name="body" placeholder="Details, context, what you tried..."></textarea><p style="margin-top:12px"><button class="btn primary" type="submit">Post</button></p></form></div>`
    : `<div class="card"><p class="muted">Log in to post. <a href="/login" data-route>Log in</a> or <a href="/register" data-route>create an account</a>.</p></div>`;
  view.innerHTML = `<div class="wrap">
    <section>
      <h1>The community</h1>
      <p class="muted">Ask what is working, share what you built, and read before you post.</p>
      <div class="split">
        <div>${threads.map(threadCard).join('') || '<p class="muted">No posts yet. Be the first.</p>'}</div>
        <div>${newForm}</div>
      </div>
    </section></div>`;
  $('#nf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { thread } = await api('/api/community', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Posted', 'ok'); go(`/community/${thread.slug}`);
    } catch (err) { toast(err.message, 'err'); }
  });
}

function threadCard(t) {
  return `<a class="thread" href="/community/${esc(t.slug)}" data-route style="display:flex;gap:14px">
    <div class="votes"><b>${t.votes}</b><span class="muted small">votes</span></div>
    <div style="flex:1">
      <h3 style="margin-bottom:2px">${esc(t.title)}</h3>
      <p class="muted" style="margin:0 0 6px">${esc((t.body || '').slice(0, 140))}${(t.body || '').length > 140 ? '…' : ''}</p>
      <div class="meta"><span class="avatar" style="background:${esc(t.author.avatarColor)}">${initials(t.author.name)}</span>${esc(t.author.name)} · ${t.views} reads · ${fmtRel(t.createdAt)}</div>
    </div></a>`;
}

async function viewCommunityThread(slug) {
  const { thread, replies } = await api(`/api/community/${slug}`);
  const replyForm = state.user
    ? `<form id="rf"><label>Your reply</label><textarea name="body" required placeholder="Add your answer..."></textarea><p style="margin-top:12px"><button class="btn primary" type="submit">Reply</button></p></form>`
    : `<p class="muted">Log in to reply.</p>`;
  view.innerHTML = `<div class="wrap" style="max-width:820px">
    <section>
      <a class="muted small" href="/community" data-route>← Community</a>
      <div class="card" style="margin-top:12px">
        <h1 style="font-size:1.6rem">${esc(thread.title)}</h1>
        <div class="meta muted" style="display:flex;gap:10px;align-items:center"><span class="avatar" style="background:${esc(thread.author.avatarColor)}">${initials(thread.author.name)}</span>${esc(thread.author.name)} · ${fmtDate(thread.createdAt)}</div>
        <div class="hr"></div>
        <p style="white-space:pre-wrap">${esc(thread.body)}</p>
        <div class="inline"><button class="btn small" id="vote">▲ Upvote (${thread.votes})</button></div>
      </div>
      <h3 style="margin-top:24px">${replies.length} replies</h3>
      ${replies.map((r) => `<div class="thread"><div class="meta"><span class="avatar" style="background:${esc(r.author.avatarColor)}">${initials(r.author.name)}</span><b>${esc(r.author.name)}</b> · ${fmtRel(r.createdAt)}</div><p style="white-space:pre-wrap;margin-top:8px">${esc(r.body)}</p></div>`).join('') || '<p class="muted">No replies yet.</p>'}
      <div class="card" style="margin-top:20px">${replyForm}</div>
    </section></div>`;
  api(`/api/community/${slug}/view`, { method: 'POST', body: {} }).catch(() => {});
  $('#vote').addEventListener('click', async () => {
    const { votes } = await api(`/api/community/${slug}/vote`, { method: 'POST', body: { direction: 'up' } });
    $('#vote').textContent = `▲ Upvote (${votes})`;
  });
  $('#rf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/community/${slug}/reply`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); go(`/community/${slug}`); }
    catch (err) { toast(err.message, 'err'); }
  });
}

// ── composer ("write one post, send it everywhere") ─────────────────────────
async function viewComposer() {
  if (!requireLogin()) return;
  const { accounts } = await api('/api/accounts');
  if (!accounts.length) {
    view.innerHTML = `<div class="wrap center" style="padding:80px 0"><h1>Connect a channel first</h1><p class="muted">Add at least one account, then come back to compose.</p><a class="btn primary" href="/connections" data-route>Connect accounts</a></div>`;
    return;
  }
  view.innerHTML = `<div class="wrap">
    <section>
      <h1>Composer</h1>
      <p class="muted">Write one post. Send it everywhere, now or later.</p>
      <div class="split">
        <div class="card">
          <div class="tabs" id="tabs">
            <button class="active" data-kind="caption">Caption</button>
            <button data-kind="article">Article</button>
          </div>
          <form id="gen">
            <label>Topic / idea</label><input name="topic" required placeholder="What is this post about?" />
            <div class="row">
              <div><label>Tone</label><select name="tone"><option>friendly</option><option>professional</option><option>funny</option><option>bold</option><option>casual</option></select></div>
              <div><label>Length (words)</label><input name="words" type="number" value="60" min="20" max="3000" /></div>
            </div>
            <label>Extra instructions</label><input name="extra" placeholder="e.g. mention our free plan" />
            <p style="margin-top:14px"><button class="btn primary" type="submit">Generate with AI</button>
            <span class="muted small">Humanizer runs automatically.</span></p>
          </form>
          <div class="hr"></div>
          <label>Title</label><input id="title" placeholder="Post title (optional for captions)" />
          <label>Body</label><textarea id="body" placeholder="Your post text..."></textarea>
          <label>Tags / hashtags (comma separated)</label><input id="tags" placeholder="blogging, ai, tips" />
          <p class="muted small" id="readout"></p>
        </div>
        <div class="card">
          <h3>Send to</h3>
          <div id="accts">${accounts.map((a) => `<label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" value="${esc(a.id)}" checked style="width:auto" /> <span class="badge">${esc(a.platform)}</span> ${esc(a.label)}</label>`).join('')}</div>
          <div class="hr"></div>
          <label>Schedule (optional)</label><input type="datetime-local" id="when" />
          <p class="muted small">Leave empty to publish immediately.</p>
          <p style="margin-top:14px"><button class="btn primary" id="send" style="width:100%">Publish now</button></p>
          <div id="sendout"></div>
        </div>
      </div>
    </section></div>`;

  let kind = 'caption';
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    kind = b.dataset.kind;
    $('#gen [name=words]').value = kind === 'article' ? 700 : 60;
  }));

  $('#gen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); const prev = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Writing…'; btn.disabled = true;
    try {
      const body = { ...Object.fromEntries(new FormData(e.target)), kind };
      const r = await api('/api/composer/write', { method: 'POST', body });
      $('#title').value = r.title || '';
      $('#body').value = r.body || '';
      $('#tags').value = (r.tags || []).join(', ');
      $('#readout').textContent = `${r.provider}${r.mocked ? ' (mock)' : ''} · ${r.meta.readability.grade} · ${r.meta.readability.words} words${r.meta.humanized ? ` · humanized (${r.meta.changes.length} fixes)` : ''}`;
      toast('Draft ready', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    btn.innerHTML = prev; btn.disabled = false;
  });

  $('#send').addEventListener('click', async () => {
    const accountIds = $$('#accts input:checked').map((i) => i.value);
    const body = { title: $('#title').value, body: $('#body').value, tags: $('#tags').value.split(',').map((s) => s.trim()).filter(Boolean), accountIds };
    const when = $('#when').value;
    if (when) body.when = new Date(when).toISOString();
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await api('/api/composer/publish', { method: 'POST', body });
      if (r.scheduled) $('#sendout').innerHTML = `<p class="pill ok">Scheduled for ${fmtDate(r.post.scheduledFor)}</p>`;
      else $('#sendout').innerHTML = r.results.map((x) => `<p class="pill ${x.ok ? 'ok' : 'err'}">${esc(x.platform)}: ${x.ok ? (x.mocked ? 'published (mock)' : 'published') : esc(x.error)}</p>`).join('');
      toast('Done', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = 'Publish now';
  });
}

// ── connections ─────────────────────────────────────────────────────────────
async function viewConnections() {
  if (!requireLogin()) return;
  const [{ platforms }, { accounts }] = await Promise.all([api('/api/platforms'), api('/api/accounts')]);
  state.platforms = platforms;
  const connected = new Set(accounts.map((a) => a.platform));
  view.innerHTML = `<div class="wrap">
    <section>
      <h1>Connections</h1>
      <p class="muted">Connect a Facebook Page, Instagram, Blogger, Pinterest, Telegram, X, TikTok, YouTube or Dailymotion. Credentials are encrypted before saving.</p>
      <div class="hr"></div>
      <h2>Your accounts</h2>
      <div class="grid" id="acctlist">${accounts.map(accountCard).join('') || '<p class="muted">No accounts yet.</p>'}</div>
      <div class="hr"></div>
      <h2>Add an account</h2>
      <div class="grid" id="platlist">${platforms.map((p) => platformCard(p, connected.has(p.id))).join('')}</div>
    </section></div>`;

  $$('#acctlist [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Disconnect this account?')) return;
    await api(`/api/accounts/${b.dataset.del}`, { method: 'DELETE' });
    toast('Disconnected', 'ok'); go('/connections');
  }));
  $$('#platlist [data-connect]').forEach((b) => b.addEventListener('click', () => openConnectForm(b.dataset.connect)));
}

function accountCard(a) {
  return `<div class="card"><h3>${esc(a.label)}</h3><p class="muted small">${esc(a.platform)} · ${esc(a.handle || 'no handle')}</p>
    <p><span class="pill ${a.status === 'connected' || a.status === 'authorized' ? 'ok' : ''}">${esc(a.status)}</span></p>
    <p class="muted small">Credentials: ${Object.entries(a.fields).map(([k, v]) => `${k}=${v ? 'set' : '—'}`).join(', ') || 'none'}</p>
    <button class="btn small danger" data-del="${esc(a.id)}">Disconnect</button></div>`;
}

function platformCard(p, isConnected) {
  return `<div class="card"><h3>${esc(p.name)}</h3><p class="muted small">${p.fields.map((f) => f.label).join(', ')}</p>
    ${isConnected ? '<span class="pill ok">connected</span>' : ''}
    <p style="margin-top:10px"><button class="btn small" data-connect="${esc(p.id)}">${isConnected ? 'Add another' : 'Connect'}</button></p></div>`;
}

function openConnectForm(platformId) {
  const p = state.platforms.find((x) => x.id === platformId);
  const fields = p.fields.map((f) => `<label>${esc(f.label)}</label><input name="${esc(f.key)}" type="${f.secret ? 'password' : 'text'}" ${f.secret ? '' : 'required'} placeholder="${f.secret ? 'paste secret' : ''}" />`).join('');
  view.innerHTML = `<div class="wrap" style="max-width:520px;padding-top:40px"><div class="card">
    <a class="muted small" href="/connections" data-route>← Connections</a>
    <h1 style="font-size:1.5rem">Connect ${esc(p.name)}</h1>
    <form id="c"><label>Label</label><input name="label" placeholder="${esc(p.name)}" /><label>Handle (optional)</label><input name="handle" />${fields}
    <p style="margin-top:16px"><button class="btn primary" style="width:100%" type="submit">Connect</button></p></form>
    <p class="muted small">You bring your own keys/tokens. Nothing is posted that you did not set up.</p>
  </div></div>`;
  $('#c').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.target));
    const credentials = {}; let label = form.label; let handle = form.handle;
    for (const f of p.fields) credentials[f.key] = form[f.key];
    try {
      await api('/api/accounts', { method: 'POST', body: { platform: platformId, label, handle, credentials } });
      toast('Connected', 'ok'); go('/connections');
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ── automation (orders) ─────────────────────────────────────────────────────
async function viewAutomation() {
  if (!requireLogin()) return;
  const [{ orders }, { accounts }] = await Promise.all([api('/api/orders'), api('/api/accounts')]);
  view.innerHTML = `<div class="wrap">
    <section>
      <h1>Automation</h1>
      <p class="muted">Set a topic and a schedule. It writes and posts on its own. Free tier: up to 5 orders.</p>
      <div class="split">
        <div>
          <h2>Your orders</h2>
          <div id="orders">${orders.map(orderCard).join('') || '<p class="muted">No orders yet.</p>'}</div>
        </div>
        <div class="card">
          <h3>New order</h3>
          ${accounts.length ? `<form id="o">
            <label>Name</label><input name="name" placeholder="Daily blogging tips" />
            <label>Topic / prompt</label><input name="topic" required placeholder="Write about productivity for bloggers" />
            <label>Category / label</label><input name="category" placeholder="Productivity" />
            <label>Audience (optional)</label><input name="audience" placeholder="beginner bloggers" />
            <div class="row"><div><label>Tone</label><select name="tone"><option>friendly</option><option>professional</option><option>casual</option></select></div>
            <div><label>Words</label><input name="words" type="number" value="700" /></div></div>
            <label>Schedule</label>
            <select id="preset"><option value="0 9 * * *">Every day at 9 AM</option><option value="0 */6 * * *">Every 6 hours</option><option value="0 9 * * 1">Every Monday 9 AM</option><option value="custom">Custom cron…</option></select>
            <input name="schedule" id="cron" value="0 9 * * *" style="margin-top:8px" />
            <p class="muted small" id="cronmsg"></p>
            <label>Post to (accounts)</label>
            <div class="row">${accounts.map((a) => `<label style="font-weight:400"><input type="checkbox" name="acct" value="${esc(a.id)}" checked style="width:auto"> ${esc(a.platform)} — ${esc(a.label)}</label>`).join('')}</div>
            <label style="display:flex;gap:8px;font-weight:400;margin-top:12px"><input type="checkbox" name="runOnGitHub" style="width:auto"> Run schedule on my GitHub Actions</label>
            <p style="margin-top:14px"><button class="btn primary" style="width:100%" type="submit">Create order</button></p>
          </form>` : `<p class="muted">Connect an account first. <a href="/connections" data-route>Connections →</a></p>`}
        </div>
      </div>
    </section></div>`;

  $$('[data-run]').forEach((b) => b.addEventListener('click', async () => {
    const btn = b; btn.disabled = true; btn.textContent = 'Running…';
    try { const r = await api(`/api/orders/${btn.dataset.run}/run`, { method: 'POST', body: {} }); toast(`Created: ${r.title}`, 'ok'); go('/automation'); }
    catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Run now'; }
  }));
  $$('[data-pause]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/orders/${b.dataset.pause}/pause`, { method: 'POST', body: {} }); go('/automation'); }));
  $$('[data-delorder]').forEach((b) => b.addEventListener('click', async () => { if (confirm('Delete this order?')) { await api(`/api/orders/${b.dataset.delorder}`, { method: 'DELETE' }); go('/automation'); } }));
  $$('[data-wf]').forEach((b) => b.addEventListener('click', async () => {
    const { workflow, path } = await api(`/api/orders/${b.dataset.wf}/workflow`);
    view.innerHTML = `<div class="wrap" style="max-width:820px;padding-top:40px"><div class="card">
      <a class="muted small" href="/automation" data-route>← Automation</a>
      <h2>GitHub Actions workflow</h2><p class="muted small">Commit to <code>${esc(path)}</code> in your repo, and set secrets ALPHAPOST_BASE_URL and ALPHAPOST_ORDER_TOKEN.</p>
      <pre>${esc(workflow)}</pre>
      <button class="btn small" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div></div>`;
  }));

  const cron = $('#cron');
  cron?.addEventListener('input', debounce(async () => {
    try { const r = await api('/api/cron/preview?expr=' + encodeURIComponent(cron.value)); $('#cronmsg').textContent = r.valid ? `${r.description} · next: ${fmtDate(r.nextRun)}` : r.error; }
    catch { /* ignore */ }
  }, 350));
  $('#preset')?.addEventListener('change', (e) => { if (e.target.value !== 'custom') { cron.value = e.target.value; cron.dispatchEvent(new Event('input')); } });
  $('#o')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { name: fd.get('name'), topic: fd.get('topic'), category: fd.get('category'), audience: fd.get('audience'), tone: fd.get('tone'), words: Number(fd.get('words')), schedule: fd.get('schedule'), runOnGitHub: fd.get('runOnGitHub') === 'on', accountIds: fd.getAll('acct') };
    try { await api('/api/orders', { method: 'POST', body }); toast('Order created', 'ok'); go('/automation'); }
    catch (err) { toast(err.message, 'err'); }
  });
}

function orderCard(o) {
  return `<div class="card" style="margin-bottom:12px">
    <div class="inline" style="justify-content:space-between"><h3 style="margin:0">${esc(o.name)}</h3><span class="pill ${o.status === 'active' ? 'ok' : 'warn'}">${esc(o.status)}</span></div>
    <p class="muted small">${esc(o.topic)}</p>
    <p class="muted small">${esc(o.scheduleDescription)} · next ${fmtRel(o.nextRunAt)} · last run ${o.lastRunAt ? fmtRel(o.lastRunAt) : 'never'}</p>
    <p class="muted small">→ ${o.accounts.map((a) => esc(a.platform)).join(', ') || 'no accounts'}</p>
    <div class="inline">
      <button class="btn small primary" data-run="${esc(o.id)}">Run now</button>
      <button class="btn small" data-pause="${esc(o.id)}">${o.status === 'active' ? 'Pause' : 'Resume'}</button>
      <button class="btn small" data-wf="${esc(o.id)}">GitHub workflow</button>
      <button class="btn small danger" data-delorder="${esc(o.id)}">Delete</button>
    </div></div>`;
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function viewDashboard() {
  if (!requireLogin()) return;
  const [{ counts, recentPosts, upcoming }, { posts }] = await Promise.all([api('/api/dashboard'), api('/api/posts')]);
  view.innerHTML = `<div class="wrap">
    <section>
      <h1>Dashboard</h1>
      <p class="muted">Everything at a glance, ${esc(state.user.name)}.</p>
      <div class="stats">
        ${[['accounts', counts.accounts], ['orders', counts.orders], ['active', counts.activeOrders], ['published', counts.published], ['scheduled', counts.scheduled], ['this week', counts.thisWeek]]
          .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}
      </div>
      <div class="split" style="margin-top:24px">
        <div><h2>Recent posts</h2>${posts.slice(0, 10).map(postRow).join('') || '<p class="muted">Nothing yet. <a href="/composer" data-route>Write your first post →</a></p>'}</div>
        <div><h2>Upcoming</h2>${upcoming.map((u) => `<div class="thread"><b>${esc(u.name)}</b><p class="muted small">next ${fmtRel(u.nextRunAt)}</p></div>`).join('') || '<p class="muted">No scheduled orders.</p>'}
        <p style="margin-top:14px"><a class="btn small" href="/automation" data-route>Manage automation</a></p></div>
      </div>
    </section></div>`;
}

function postRow(p) {
  const cls = p.status === 'published' ? 'ok' : p.status === 'failed' ? 'err' : 'warn';
  return `<div class="thread"><div class="inline" style="justify-content:space-between"><b>${esc(p.title || '(untitled)')}</b><span class="pill ${cls}">${esc(p.status)}</span></div>
    <p class="muted small">${esc(p.platform || (p.platforms || []).join(', '))} · ${fmtRel(p.createdAt)}${p.mocked ? ' · mock' : ''}${p.error ? ` · ${esc(p.error)}` : ''}</p></div>`;
}

// ── settings ────────────────────────────────────────────────────────────────
async function viewSettings() {
  if (!requireLogin()) return;
  const keys = await api('/api/keys');
  view.innerHTML = `<div class="wrap" style="max-width:680px">
    <section>
      <h1>Settings</h1>
      <div class="card">
        <h3>AI keys</h3>
        <p class="muted small">Add your own free Google Gemini key (Google AI Studio). It is encrypted before saving. Without a key the app uses an offline mock writer.</p>
        <form id="k">
          <label>Gemini API key ${keys.geminiKeySet ? '<span class="pill ok">set</span>' : ''}</label><input name="geminiKey" type="password" placeholder="AIza..." />
          <label>Gemini model</label><input name="geminiModel" value="${esc(keys.geminiModel)}" />
          <label>OpenAI key (optional fallback) ${keys.openaiKeySet ? '<span class="pill ok">set</span>' : ''}</label><input name="openaiKey" type="password" placeholder="sk-..." />
          <label>GitHub token (for schedule on your Actions) ${keys.githubConnected ? '<span class="pill ok">set</span>' : ''}</label><input name="githubToken" type="password" placeholder="ghp_..." />
          <p style="margin-top:16px"><button class="btn primary" type="submit">Save keys</button></p>
        </form>
      </div>
      <div class="card" style="margin-top:18px">
        <h3>Profile</h3>
        <form id="p"><label>Name</label><input name="name" value="${esc(state.user.name)}" /><p style="margin-top:14px"><button class="btn" type="submit">Save profile</button></p></form>
      </div>
      <div class="card" style="margin-top:18px">
        <h3>Session</h3><p class="muted small">${esc(state.user.email)}</p>
        <button class="btn danger" id="logout">Log out</button>
      </div>
    </section></div>`;
  $('#k').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(body)) if (!body[k]) delete body[k];
    try { await api('/api/keys', { method: 'PUT', body }); toast('Saved', 'ok'); go('/settings'); }
    catch (err) { toast(err.message, 'err'); }
  });
  $('#p').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/api/profile', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); state.user = r.user; toast('Saved', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; toast('Logged out'); go('/'); });
}

// ── utils ───────────────────────────────────────────────────────────────────
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-route]');
  if (!link) return;
  e.preventDefault();
  go(link.getAttribute('href'));
});
window.addEventListener('popstate', render);

(async function boot() {
  try { const { user } = await api('/api/auth/me'); state.user = user; } catch { state.user = null; }
  try { state.platforms = (await api('/api/platforms')).platforms; } catch { /* ignore */ }
  try { state.tools = (await api('/api/tools')).tools; } catch { /* ignore */ }
  render();
})();
