import { db, logEvent, bumpStat } from '../lib/store.js';
import { hashPassword, verifyPassword, signSession, randomHex } from '../lib/crypto.js';
import { json, ok, badRequest, unauthorized, setCookie, clearCookie, parseJson } from '../lib/http.js';
import { SESSION_COOKIE, publicUser } from '../lib/auth.js';

const COLORS = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#e84393', '#fdcb6e', '#00cec9', '#d63031'];

export function registerAuthRoutes(router) {
  router.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = await parseJson(req);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest(res, 'Enter a valid email');
    if (!password || String(password).length < 8) return badRequest(res, 'Password must be at least 8 characters');
    const normalized = String(email).toLowerCase().trim();
    if (db.users.find((u) => u.email === normalized)) return badRequest(res, 'An account with that email already exists');

    const user = await db.users.insert({
      email: normalized,
      name: (name || normalized.split('@')[0]).slice(0, 60),
      passwordHash: hashPassword(password),
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      plan: 'free',
      geminiKeyEnc: '',
      githubTokenEnc: '',
      orderToken: randomHex(16),
    });
    await bumpStat('members');
    await logEvent(user.id, 'auth.register', { email: normalized });
    setCookie(res, SESSION_COOKIE, signSession({ uid: user.id }));
    return json(res, 201, { user: publicUser(user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    const { email, password } = await parseJson(req);
    const normalized = String(email || '').toLowerCase().trim();
    const user = db.users.find((u) => u.email === normalized);
    if (!user || !verifyPassword(password, user.passwordHash)) return unauthorized(res, 'Wrong email or password');
    setCookie(res, SESSION_COOKIE, signSession({ uid: user.id }));
    await logEvent(user.id, 'auth.login');
    return ok(res, { user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    clearCookie(res, SESSION_COOKIE);
    return ok(res);
  });

  router.get('/api/auth/me', (req, res) => {
    if (!req.user) return unauthorized(res);
    return ok(res, { user: publicUser(req.user) });
  });
}
