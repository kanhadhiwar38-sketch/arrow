import { parseCookies, unauthorized } from '../lib/http.js';
import { verifySession } from './crypto.js';
import { db } from './store.js';

const COOKIE = 'ap_session';

// Attach req.user from the signed session cookie if present + valid.
export function attachUser(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies[COOKIE]);
  if (!session?.uid) {
    req.user = null;
    return null;
  }
  const user = db.users.byId(session.uid);
  req.user = user || null;
  return req.user;
}

// Guard for API routes. Returns the user or writes 401 and returns null.
export function requireUser(req, res) {
  if (!req.user) {
    unauthorized(res, 'Please sign in');
    return null;
  }
  return req.user;
}

export const SESSION_COOKIE = COOKIE;

// Public projection of a user (never leak password hash / encrypted keys).
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
    plan: user.plan || 'free',
    hasGeminiKey: Boolean(user.geminiKeyEnc),
    hasOpenaiKey: Boolean(user.openaiKeyEnc),
  };
}
