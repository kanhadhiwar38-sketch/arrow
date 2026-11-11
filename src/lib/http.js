import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Minimal HTTP response helpers (no framework).

export function send(res, status, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', ...headers };
  let payload = body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    h['Content-Type'] = h['Content-Type'] || 'application/json; charset=utf-8';
  }
  res.writeHead(status, h);
  res.end(payload);
}

export const json = (res, status, obj) => send(res, status, obj);
export const ok = (res, obj = { ok: true }) => json(res, 200, obj);
export const badRequest = (res, msg) => json(res, 400, { error: msg });
export const unauthorized = (res, msg = 'Unauthorized') => json(res, 401, { error: msg });
export const forbidden = (res, msg = 'Forbidden') => json(res, 403, { error: msg });
export const notFound = (res, msg = 'Not found') => json(res, 404, { error: msg });
export const serverError = (res, msg = 'Server error') => json(res, 500, { error: msg });

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

// ── Request body parsing ────────────────────────────────────────────────────
export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export async function parseForm(req) {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw.toString('utf8'));
  return Object.fromEntries(params.entries());
}

// ── Cookies ─────────────────────────────────────────────────────────────────
export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.sameSite !== false) bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) bits.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const cookie = bits.join('; ');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

// ── Static file serving ─────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(config.publicDir, safe);
  if (!file.startsWith(config.publicDir)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'Content-Length': body.length,
  });
  res.end(body);
  return true;
}
