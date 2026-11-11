import { config } from '../config.js';
import { decrypt } from '../lib/crypto.js';
import { humanize, readability } from '../lib/humanizer.js';

// ── Providers ───────────────────────────────────────────────────────────────
// Each provider takes a fully-built prompt and returns raw model text. If no
// key is supplied the app falls back to a deterministic local "mock" writer so
// every tool is testable end-to-end without spending API quota.

async function callGemini({ apiKey, model, system, prompt, jsonMode, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 4096,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

async function callOpenAI({ apiKey, model, system, prompt, jsonMode, signal }) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.9,
      max_tokens: 4096,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

// ── Mock writer (offline) ───────────────────────────────────────────────────
function mockWrite({ topic, tone = 'friendly', words = 400, includeTags = true }) {
  const t = topic || 'the topic';
  const para = (n) =>
    `Here is a thought on ${t}: point ${n}. It helps to keep things simple and to say what you mean. ` +
    `Readers skim, so short lines beat long ones. When something works, repeat it, and when it does not, change one thing and test again.`;
  const body = [
    `# ${titleCase(t)}`,
    '',
    `Most people overcomplicate ${t}. It doesn't have to be hard. In this article, we will look at what actually matters and skip the rest.`,
    '',
    ...Array.from({ length: 4 }, (_, i) => `## ${titleCase(`what matters about ${t} part ${i + 1}`)}\n\n${para(i + 1)}\n`),
    `## A simple next step\n\nPick one small action tonight, do it, and write down what happened. That beats a plan you never start.`,
  ].join('\n');
  const tags = includeTags ? [t.split(/\s+/)[0] || 'topic', 'how to', 'guide', 'tips'] : [];
  return { title: titleCase(t), body, tags: tags.slice(0, 4), tone, words };
}

function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w, i) => (i === 0 || w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ── Public API ──────────────────────────────────────────────────────────────

// Resolve the best provider from a user record + an optional per-call key.
export function resolveProvider(user, inlineKey) {
  if (inlineKey) {
    return { provider: 'gemini', apiKey: inlineKey, model: config.geminiModel };
  }
  const gemini = decrypt(user?.geminiKeyEnc);
  if (gemini) return { provider: 'gemini', apiKey: gemini, model: user.geminiModel || config.geminiModel };
  const openai = decrypt(user?.openaiKeyEnc);
  if (openai) return { provider: 'openai', apiKey: openai, model: user.openaiModel || config.openaiModel };
  return { provider: 'mock', apiKey: '', model: 'mock' };
}

export async function generateText({ profile, system, prompt, jsonMode = false, timeoutMs = 45000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (profile.provider === 'gemini') {
      return await callGemini({ ...profile, system, prompt, jsonMode, signal: controller.signal });
    }
    if (profile.provider === 'openai') {
      return await callOpenAI({ ...profile, system, prompt, jsonMode, signal: controller.signal });
    }
    throw new Error('mock');
  } finally {
    clearTimeout(timer);
  }
}

// High-level: write a blog post / caption / script and return a normalised
// result object the rest of the app can reason about.
export async function writeContent({ user, inlineKey, kind = 'article', topic, tone = 'friendly', words = 700, category = '', audience = '', extra = '', ctx = {} }) {
  const profile = resolveProvider(user, inlineKey);
  const system =
    'You are a plain-spoken writer. Use simple, everyday words. Short sentences mixed with a few longer ones. ' +
    'Never use em-dashes, never write "in conclusion", "in today\'s fast-paced world", "delve", "leverage", or "moreover". ' +
    'Write like a real person explaining something to a friend.';

  const prompt = buildPrompt({ kind, topic, tone, words, category, audience, extra, ctx });
  let raw;
  let mocked = false;
  try {
    raw = await generateText({ profile, system, prompt, jsonMode: false, timeoutMs: 45000 });
    if (!raw) throw new Error('empty');
  } catch {
    const m = mockWrite({ topic, tone, words });
    raw = m.body;
    mocked = true;
  }

  const cleaned = humanize(raw);
  const title = extractTitle(cleaned.text) || titleCase(topic || 'Untitled');
  const body = cleaned.text.replace(/^#\s.*$/m, '').trim();
  const tags = extractTags(body, category, topic);

  return {
    provider: profile.provider,
    model: profile.model,
    mocked,
    title,
    body,
    tags,
    meta: {
      changes: cleaned.changes,
      humanized: cleaned.changes.length > 0,
      readability: readability(cleaned.text),
      words: body.split(/\s+/).filter(Boolean).length,
    },
  };
}

function buildPrompt({ kind, topic, tone, words, category, audience, extra, ctx }) {
  const lines = [];
  if (kind === 'article') {
    lines.push(`Write a complete blog article about: ${topic}.`);
    if (category) lines.push(`The blog category/label is "${category}", so fit that niche.`);
    if (audience) lines.push(`The intended readers are: ${audience}.`);
    lines.push(`Target about ${words} words.`);
    lines.push('Start with a single clear H1 title line beginning with "# ". Use a few "## " subheadings.');
    lines.push('Do not add a meta description or tags section, just the article.');
  } else if (kind === 'caption') {
    lines.push(`Write a short, engaging social media caption about: ${topic}.`);
    lines.push('Max 3 short lines. Add 3-5 relevant hashtags at the end.');
  } else if (kind === 'script') {
    lines.push(`Write a ${words}-word video script about: ${topic}.`);
    lines.push('Open with a hook in the first line. Keep sentences short and spoken.');
  } else if (kind === 'carousel') {
    const slides = ctx.slides || 6;
    lines.push(`Write a ${slides}-slide Instagram carousel about: ${topic}.`);
    lines.push('Return each slide as "Slide N: <short text>" on its own line, plus a final caption with hashtags.');
  }
  lines.push(`Tone: ${tone}.`);
  if (extra) lines.push(`Extra instructions: ${extra}`);
  return lines.join('\n');
}

function extractTitle(text) {
  const m = text.match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function extractTags(body, category, topic) {
  const base = [category, topic]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const freq = new Map();
  for (const w of base) freq.set(w, (freq.get(w) || 0) + 2);
  for (const w of body.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 4) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([w]) => !STOP.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w);
}

const STOP = new Set(['this', 'that', 'with', 'from', 'they', 'them', 'your', 'have', 'will', 'what', 'when', 'then', 'here', 'there', 'into', 'about', 'just', 'like', 'more', 'some', 'than', 'make', 'lets', 'each', 'good', 'very']);

export { mockWrite, titleCase };
