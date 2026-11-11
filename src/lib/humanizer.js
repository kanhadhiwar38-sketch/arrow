// The "humanizer" is AlphaPost's signature feature: it takes raw AI output and
// strips the tells that make text read like a machine wrote it. This is a
// deterministic, offline post-processor (no API call needed).

// Words AI models overuse -> plainer alternatives.
const WORD_MAP = {
  leverage: 'use',
  leverages: 'uses',
  leveraged: 'used',
  utilize: 'use',
  utilizes: 'uses',
  utilized: 'used',
  utilizing: 'using',
  delve: 'look',
  delves: 'looks',
  delving: 'looking',
  'dive into': 'look at',
  'deep dive': 'close look',
  moreover: 'also',
  furthermore: 'also',
  additionally: 'also',
  'in addition': 'also',
  'it is worth noting that': '',
  'it is important to note that': '',
  'it is crucial to': '',
  'navigating the': 'handling ',
  realm: 'area',
  landscape: 'space',
  'game-changer': 'big deal',
  'game changer': 'big deal',
  'cutting-edge': 'modern',
  'state-of-the-art': 'modern',
  'seamlessly': 'smoothly',
  'robust': 'solid',
  'myriad': 'many',
  'plethora': 'many',
  'multifaceted': 'complex',
  'in the ever-evolving': 'in the changing',
  'ever-evolving': 'changing',
  'fast-paced world': 'busy world',
  'in today\'s world': 'today',
  'unlock the power of': 'use',
  'unlock': 'open up',
  'harness': 'use',
  'empower': 'help',
  'elevate': 'improve',
  'embark on': 'start',
  'tapestry': 'mix',
  'synergy': 'teamwork',
  'paradigm': 'model',
  'holistic': 'complete',
  'pivotal': 'key',
  'meticulous': 'careful',
  'meticulously': 'carefully',
  'utilization': 'use',
  'commence': 'start',
  'endeavor': 'effort',
  'facilitate': 'help',
  'subsequently': 'then',
  'henceforth': 'from now on',
  'aforementioned': 'this',
};

// Opening phrases that scream "AI wrote this" -> drop the whole clause.
const STRIP_PHRASES = [
  "in today's fast-paced world",
  "in today's digital age",
  "in the digital age",
  "in this article, we will",
  "in this blog post, we will",
  "in conclusion",
  "to sum up",
  "to summarize",
  "all in all",
  "at the end of the day",
  "when it comes to",
  "needless to say",
  "it goes without saying that",
  "as we all know",
  "first and foremost",
];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function humanize(input, opts = {}) {
  if (!input || typeof input !== 'string') return { text: '', changes: [] };
  let text = input;
  const changes = [];
  const note = (type, before, after) => changes.push({ type, before, after });

  // 1. Replace AI-favoured words (case-insensitive, word-boundary).
  for (const [word, replacement] of Object.entries(WORD_MAP)) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (!re.test(text)) continue;
    text = text.replace(re, (m) => {
      note('word', m, replacement || '');
      if (!replacement) return '';
      return /^[A-Z]/.test(m) ? cap(replacement) : replacement;
    });
  }

  // 2. Strip AI stock phrases.
  for (const phrase of STRIP_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[,:]?\\s*`, 'gi');
    if (re.test(text)) {
      text = text.replace(re, '');
      note('phrase', phrase, '');
    }
  }

  // 3. Remove em-dashes / en-dashes (humans rarely type them; AIs love them).
  if (/[—–]/.test(text)) {
    text = text.replace(/\s*[—–]\s*/g, ', ');
    note('dash', '—/–', ',');
  }

  // 4. Collapse any doubled spaces/punctuation left behind.
  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])\1{1,}/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.');

  // 5. Sentence-length mixing: if the text is monotone, break a few very long
  //    sentences at safe connectors so rhythm varies like human writing.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const mixed = sentences.map((s) => {
    const words = s.trim().split(/\s+/);
    if (words.length < 34) return s.trim();
    const idx = findBreakPoint(s);
    if (idx === -1) return s.trim();
    note('rhythm', 'long sentence', 'split');
    return `${s.slice(0, idx).trim()}. ${cap(s.slice(idx).trim())}`;
  });
  text = mixed.join(' ');

  // 6. Normalise whitespace at paragraph level.
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

  return { text, changes };
}

function findBreakPoint(sentence) {
  const connectors = [' and ', ' but ', ' which means ', ' so that ', ' while ', ' because '];
  const mid = Math.floor(sentence.length * 0.55);
  let best = -1;
  let bestDist = Infinity;
  for (const c of connectors) {
    let from = 0;
    let idx = sentence.indexOf(c, from);
    while (idx !== -1) {
      const dist = Math.abs(idx - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
      from = idx + 1;
      idx = sentence.indexOf(c, from);
    }
  }
  return bestDist < sentence.length * 0.25 ? best : -1;
}

// Lightweight readability signal shown in the UI (Flesch reading ease-ish).
export function readability(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { words: 0, sentences: 0, avgSentence: 0, score: 0, grade: 'n/a' };
  const words = clean.split(/\s+/).filter(Boolean);
  const sentences = clean.split(/[.!?]+/).filter((s) => s.trim()).length || 1;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const avgSentence = words.length / sentences;
  const score = Math.round(206.835 - 1.015 * avgSentence - 84.6 * (syllables / (words.length || 1)));
  let grade = 'college';
  if (score >= 90) grade = 'very easy';
  else if (score >= 80) grade = 'easy';
  else if (score >= 70) grade = 'fairly easy';
  else if (score >= 60) grade = 'plain';
  else if (score >= 50) grade = 'fairly hard';
  else grade = 'hard';
  return { words: words.length, sentences, avgSentence: Math.round(avgSentence * 10) / 10, score, grade };
}

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
