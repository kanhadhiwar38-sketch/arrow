import { resolveProvider, generateText, writeContent } from './ai.js';
import { db } from '../lib/store.js';

// ── The standalone "free tools" ─────────────────────────────────────────────
// Each returns a normalised result object. AI-backed tools use the same
// provider resolution (real Gemini/OpenAI key, or the offline mock writer).

export const TOOL_CATALOG = [
  { id: 'community', name: 'Community', desc: 'Ask, answer and learn with other creators', kind: 'app' },
  { id: 'ai-video-maker', name: 'AI video maker', desc: 'Type an idea, get a finished reel', kind: 'video' },
  { id: 'blogger-auto-post', name: 'Blogger automation', desc: 'Full articles on your own blog, on a schedule', kind: 'ai' },
  { id: 'facebook-auto-post', name: 'Facebook Page auto post', desc: 'Your Page posts on its own', kind: 'ai' },
  { id: 'instagram-auto-post', name: 'Instagram auto post and reels', desc: 'Posts, carousels and reels on a schedule', kind: 'ai' },
  { id: 'shorts-maker', name: 'Shorts Maker', desc: 'Turn one long video into shorts', kind: 'video' },
  { id: 'video-translator', name: 'Video Translator', desc: 'Your video in another language', kind: 'video' },
  { id: 'pinterest-auto-pin', name: 'Pinterest tools', desc: 'Pins made, posted and earning', kind: 'ai' },
  { id: 'keyword-research', name: 'Keyword Research', desc: 'What people search, and how hard it is', kind: 'seo' },
  { id: 'aeo-checker', name: 'AEO Checker', desc: 'Can ChatGPT and Google AI quote your site', kind: 'seo' },
  { id: 'instagram-carousel', name: 'Carousel maker', desc: 'Swipe posts for Instagram and Facebook', kind: 'ai' },
  { id: 'website-to-social', name: 'Website to social', desc: 'Every new article shared by itself', kind: 'ai' },
  { id: 'x-twitter-auto-post', name: 'X (Twitter) auto post', desc: 'Post to X without a paid API plan', kind: 'ai' },
  { id: 'telegram-auto-post', name: 'Telegram channel auto post', desc: 'Feed your channel on a schedule', kind: 'ai' },
  { id: 'tiktok-auto-post', name: 'TikTok auto post', desc: 'Send videos straight to TikTok', kind: 'video' },
  { id: 'youtube-dailymotion', name: 'YouTube and Dailymotion', desc: 'Upload shorts and videos automatically', kind: 'video' },
];

export function getTool(id) {
  return TOOL_CATALOG.find((t) => t.id === id) || null;
}

// ── Keyword research ────────────────────────────────────────────────────────
// Deterministic expansion + a difficulty heuristic. If the user has an AI key
// we ask the model for extra long-tail variants and fold them in.
export async function keywordResearch({ user, seed, country = 'us' }) {
  const base = String(seed || '').trim();
  if (!base) return { seed: '', keywords: [] };
  const modifiers = ['', 'how to', 'best', 'free', 'for beginners', 'near me', '2026', 'vs', 'review', 'tutorial', 'tools', 'software'];
  const rows = modifiers.map((m) => {
    const kw = `${m} ${base}`.trim().replace(/\s+/g, ' ');
    const words = kw.split(' ').length;
    const difficulty = Math.min(92, 8 + words * 9 + (['how to', 'best', 'near me'].some((p) => kw.startsWith(p)) ? 22 : 0) + (base.length > 12 ? 10 : 0));
    const volume = Math.max(20, Math.round(2400 / words + (base.split(' ').length <= 2 ? 900 : 180) - difficulty * 6 + (kw.length * 3)));
    return { keyword: kw, volume, difficulty, intent: inferIntent(kw) };
  });

  let aiSuggestions = [];
  const profile = resolveProvider(user);
  if (profile.provider !== 'mock') {
    try {
      const raw = await generateText({
        profile,
        system: 'You are an SEO keyword researcher. Reply ONLY with JSON: {"keywords":["..."]}',
        prompt: `Give 8 long-tail search keywords related to "${base}" for users in ${country}. JSON only.`,
        jsonMode: true,
        timeoutMs: 30000,
      });
      const parsed = safeJson(raw);
      aiSuggestions = (parsed?.keywords || []).map((k) => ({
        keyword: String(k),
        volume: Math.max(10, Math.round(400 / Math.max(1, String(k).split(' ').length))),
        difficulty: Math.min(90, 10 + String(k).split(' ').length * 7),
        intent: inferIntent(String(k)),
      }));
    } catch {
      aiSuggestions = [];
    }
  }

  const keywords = dedupe([...rows, ...aiSuggestions]).sort((a, b) => b.volume - a.volume);
  return { seed: base, provider: profile.provider, keywords };
}

function inferIntent(kw) {
  const k = kw.toLowerCase();
  if (/how|guide|tutorial|step/.test(k)) return 'informational';
  if (/buy|price|cheap|coupon|deal/.test(k)) return 'transactional';
  if (/best|top|review|vs|alternatives/.test(k)) return 'commercial';
  if (/login|official|website/.test(k)) return 'navigational';
  return 'informational';
}

// ── AEO checker ─────────────────────────────────────────────────────────────
// Fetches the page and scores how quotable / AI-answer-friendly it is.
export async function aeoCheck({ url }) {
  const target = normalizeUrl(url);
  if (!target) return { url, error: 'Enter a valid URL' };
  let html = '';
  let status = 0;
  try {
    const res = await fetch(target, { headers: { 'User-Agent': 'AlphaPost-AEO/1.0' }, redirect: 'follow' });
    status = res.status;
    html = (await res.text()).slice(0, 400_000);
  } catch (err) {
    return { url: target, error: `Could not fetch: ${err.message}` };
  }

  const text = stripTags(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  const checks = [
    { id: 'title', label: 'Has a clear <title>', pass: /<title>[^<]{10,}<\/title>/i.test(html), weight: 10 },
    { id: 'h1', label: 'Has exactly one H1', pass: (html.match(/<h1[\s>]/gi) || []).length === 1, weight: 10 },
    { id: 'headings', label: 'Uses question-style headings', pass: (html.match(/<h[23][^>]*>[^<]*\?/gi) || []).length >= 1, weight: 12 },
    { id: 'lists', label: 'Uses lists (ordered/unordered)', pass: /<ul[\s>]|<ol[\s>]/i.test(html), weight: 8 },
    { id: 'schema', label: 'Has structured data (JSON-LD)', pass: /application\/ld\+json/i.test(html), weight: 16 },
    { id: 'faq', label: 'Looks like FAQ / Q&A content', pass: /faq|frequently asked|q:\s/i.test(text), weight: 12 },
    { id: 'meta', label: 'Has a meta description', pass: /<meta[^>]+name=["']description["']/i.test(html), weight: 10 },
    { id: 'length', label: 'Substantive length (600+ words)', pass: words >= 600, weight: 12 },
    { id: 'stats', label: 'Cites numbers or statistics', pass: /\b\d+(\.\d+)?%|\b\d{2,}\b/.test(text), weight: 10 },
  ];
  const earned = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const score = Math.round((earned / total) * 100);
  return {
    url: target,
    status,
    words,
    score,
    grade: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor',
    checks,
    suggestions: checks.filter((c) => !c.pass).map((c) => upgradeFor(c.id)),
  };
}

function upgradeFor(id) {
  const map = {
    schema: 'Add JSON-LD FAQPage/Article schema so AI answer engines can parse your facts.',
    faq: 'Add a short FAQ block with real questions phrased the way people ask them.',
    headings: 'Rewrite some H2/H3s as questions (e.g. "How much does X cost?").',
    lists: 'Break long paragraphs into bullet or numbered lists.',
    meta: 'Add a compelling meta description in <head>.',
    length: 'Expand to at least 600 focused words.',
    stats: 'Add concrete numbers, dates and sources to increase quotability.',
    title: 'Give the page a specific, descriptive title.',
    h1: 'Use exactly one H1 that names the topic.',
  };
  return map[id] || 'Improve this signal.';
}

// ── Video / shorts / translator (planning layer) ────────────────────────────
// Real transcoding needs ffmpeg; these produce the edit plan + AI script that a
// renderer (browser/ffmpeg worker) can execute. This keeps the clone runnable
// anywhere while preserving the feature's logic.
export async function shortsPlan({ user, source, count = 3, topic = '' }) {
  const n = Math.max(1, Math.min(10, Number(count) || 3));
  const script = await writeContent({ user, kind: 'script', topic: topic || `highlights from ${source || 'the video'}`, words: 160, tone: 'energetic' });
  const shorts = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    title: `${script.title} — part ${i + 1}`,
    startSec: i * 45,
    endSec: i * 45 + 40,
    aspect: '9:16',
    caption: `${script.body.split('\n')[0]}`.slice(0, 120),
    hook: i === 0 ? 'Start with the strongest line.' : 'Cut mid-action for retention.',
  }));
  return { source: source || '(uploaded file)', aspect: '9:16', renderer: 'ffmpeg', provider: script.provider, script, shorts };
}

export async function videoPlan({ user, idea, seconds = 30, style = 'reel' }) {
  const script = await writeContent({ user, kind: 'script', topic: idea, words: Math.round(seconds * 4), tone: 'energetic' });
  return {
    idea,
    style,
    seconds,
    aspect: '9:16',
    scenes: script.body.split(/\n\n+/).slice(0, 6).map((para, i) => ({
      scene: i + 1,
      durationSec: Math.round(seconds / 6),
      voiceover: para.replace(/^#+\s*/, '').slice(0, 240),
      visual: i === 0 ? 'Bold hook title + b-roll' : 'Supporting b-roll with on-screen text',
    })),
    provider: script.provider,
    title: script.title,
  };
}

export async function translatePlan({ user, video, language = 'es' }) {
  const script = await writeContent({ user, kind: 'script', topic: `translation of ${video || 'the video'} into ${language}`, words: 120, tone: 'neutral' });
  return { video: video || '(uploaded file)', language, mode: 'subtitle+dub', steps: ['Extract audio (ffmpeg)', `Transcribe + translate to ${language}`, 'Generate SRT', 'Optional TTS dub', 'Mux back'], script };
}

export async function carouselPlan({ user, topic, slides = 6 }) {
  const out = await writeContent({ user, kind: 'carousel', topic, words: 300, ctx: { slides } });
  const lines = out.body.split('\n').filter((l) => /slide\s*\d/i.test(l));
  const parsed = (lines.length ? lines : out.body.split(/\n\n+/)).slice(0, slides).map((line, i) => ({
    slide: i + 1,
    text: line.replace(/^slide\s*\d+\s*[:\-]\s*/i, '').trim(),
  }));
  return { topic, slides: parsed, caption: out.tags.map((t) => `#${t}`).join(' '), provider: out.provider };
}

// ── Website -> social ───────────────────────────────────────────────────────
// Discovers new articles from a sitemap/RSS and prepares share posts.
export async function websiteToSocial({ user, site, limit = 5 }) {
  const target = normalizeUrl(site);
  if (!target) return { site, error: 'Enter a valid site URL' };
  const items = await discoverArticles(target, limit);
  const shares = [];
  for (const item of items.slice(0, limit)) {
    const caption = `New on the blog: ${item.title}\n\n${item.url}`;
    shares.push({ title: item.title, url: item.url, published: item.published || null, caption });
  }
  return { site: target, discovered: items.length, shares };
}

async function discoverArticles(baseUrl, limit) {
  const candidates = [`${baseUrl}/sitemap.xml`, `${baseUrl}/feed`, `${baseUrl}/rss`, `${baseUrl}/rss.xml`, `${baseUrl}/atom.xml`];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'AlphaPost-W2S/1.0' } });
      if (!res.ok) continue;
      const body = await res.text();
      const items = parseFeed(body).slice(0, limit);
      if (items.length) return items;
    } catch {
      /* try next */
    }
  }
  // Fallback: fetch homepage and pull its links as titles.
  try {
    const res = await fetch(baseUrl, { headers: { 'User-Agent': 'AlphaPost-W2S/1.0' } });
    const html = await res.text();
    return [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{8,})<\/a>/gi)]
      .map((m) => ({ url: absolute(baseUrl, m[1]), title: stripTags(m[2]) }))
      .filter((x) => x.url.startsWith(baseUrl))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function parseFeed(xml) {
  const out = [];
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  for (const block of blocks) {
    const title = matchTag(block, 'title');
    const link = matchTag(block, 'link') || (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1];
    const pub = matchTag(block, 'pubDate') || matchTag(block, 'updated');
    if (title) out.push({ title: stripTags(title), url: link || '', published: pub || null });
  }
  if (out.length) return out;
  // sitemap
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const url = m[1];
    const slug = url.split('/').filter(Boolean).pop() || url;
    out.push({ title: slug.replace(/[-_]/g, ' '), url });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function normalizeUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).href.replace(/\/$/, ''); } catch { return ''; }
}
function absolute(base, href) {
  try { return new URL(href, base).href; } catch { return href; }
}
function stripTags(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function matchTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
