import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Tiny .env loader (no dependency). Existing process env always wins.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  appSecret: process.env.APP_SECRET || 'dev-only-change-me-please-32-chars-min',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  publicDir: path.join(ROOT, 'public'),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  oauthBase: process.env.OAUTH_CALLBACK_BASE || `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/oauth`,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  mockPublishing: bool(process.env.MOCK_PUBLISHING, true), // simulate platform APIs when no real creds
};

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
