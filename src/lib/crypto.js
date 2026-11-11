import crypto from 'node:crypto';
import { config } from '../config.js';

// Derive two independent keys from APP_SECRET so cookie signing and field
// encryption never share key material.
const master = crypto.createHash('sha256').update(config.appSecret).digest();
export const SIGN_KEY = crypto.createHash('sha256').update(master).update('session').digest();
const AES_KEY = crypto.createHash('sha256').update(master).update('aes').digest(); // 32 bytes

// ── AES-256-GCM field encryption ────────────────────────────────────────────
// Used for GitHub tokens, Gem platform tokens and AI API keys "at rest".
export function encrypt(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decrypt(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// ── Password hashing (scrypt, salted) ───────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ── Signed session tokens (compact JWT-ish, HMAC-SHA256) ────────────────────
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function signSession(payload, ttlDays = config.sessionTtlDays) {
  const body = { ...payload, exp: Date.now() + ttlDays * 864e5 };
  const data = b64(body);
  const sig = crypto.createHmac('sha256', SIGN_KEY).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySession(token) {
  if (!token) return null;
  const [data, sig] = String(token).split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SIGN_KEY).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = unb64(data);
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

// ── Opaque token / id helpers ───────────────────────────────────────────────
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export const randomHex = (n = 16) => crypto.randomBytes(n).toString('hex');
