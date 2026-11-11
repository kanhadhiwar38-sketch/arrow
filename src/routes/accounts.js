import { db, logEvent, bumpStat } from '../lib/store.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { json, ok, badRequest, notFound, parseJson } from '../lib/http.js';
import { requireUser, publicUser } from '../lib/auth.js';
import { listPlatforms, getPlatform } from '../services/connectors.js';
import { encodeCreds, publicAccount, hydrate } from '../lib/accounts.js';

export function registerAccountRoutes(router) {
  // Catalog of supported platforms + the credential fields each needs.
  router.get('/api/platforms', (req, res) => ok(res, { platforms: listPlatforms() }));

  // List the current user's connected accounts.
  router.get('/api/accounts', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const accounts = db.accounts.filter((a) => a.userId === user.id).map(publicAccount);
    return ok(res, { accounts });
  });

  // Connect an account by supplying its credential fields.
  router.post('/api/accounts', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { platform, label, handle, credentials } = await parseJson(req);
    const meta = getPlatform(platform);
    if (!meta) return badRequest(res, 'Unknown platform');
    const creds = credentials || {};
    const missing = meta.fields.filter((f) => f.key !== 'accessToken' && !creds[f.key]).map((f) => f.label);
    if (missing.length) return badRequest(res, `Missing: ${missing.join(', ')}`);

    const account = await db.accounts.insert({
      userId: user.id,
      platform,
      label: (label || meta.name).slice(0, 80),
      handle: (handle || '').slice(0, 80),
      status: 'connected',
      credentialsEnc: encodeCreds(creds),
    });
    await bumpStat('connections_made');
    await logEvent(user.id, 'account.connect', { platform });
    return json(res, 201, { account: publicAccount(account) });
  });

  // "Authorize Blogger" — stores an OAuth access token on an existing account.
  router.post('/api/accounts/:id/authorize', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const account = db.accounts.byId(req.params.id);
    if (!account || account.userId !== user.id) return notFound(res, 'Account not found');
    const { accessToken } = await parseJson(req);
    if (!accessToken) return badRequest(res, 'Missing access token');
    const creds = { ...hydrate(account).credentials, accessToken };
    await db.accounts.update(account.id, { credentialsEnc: encodeCreds(creds), status: 'authorized' });
    await logEvent(user.id, 'account.authorize', { platform: account.platform });
    return ok(res, { account: publicAccount(db.accounts.byId(account.id)) });
  });

  router.delete('/api/accounts/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const account = db.accounts.byId(req.params.id);
    if (!account || account.userId !== user.id) return notFound(res, 'Account not found');
    await db.accounts.remove(account.id);
    await logEvent(user.id, 'account.disconnect', { platform: account.platform });
    return ok(res);
  });

  // ── Per-user AI + GitHub keys (stored encrypted at rest) ──────────────────
  router.get('/api/keys', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    return ok(res, {
      geminiKeySet: Boolean(user.geminiKeyEnc),
      openaiKeySet: Boolean(user.openaiKeyEnc),
      githubConnected: Boolean(user.githubTokenEnc),
      geminiModel: user.geminiModel || 'gemini-2.0-flash',
    });
  });

  router.put('/api/keys', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { geminiKey, openaiKey, githubToken, geminiModel } = await parseJson(req);
    const patch = {};
    if (geminiKey !== undefined) patch.geminiKeyEnc = geminiKey ? encrypt(geminiKey) : '';
    if (openaiKey !== undefined) patch.openaiKeyEnc = openaiKey ? encrypt(openaiKey) : '';
    if (githubToken !== undefined) patch.githubTokenEnc = githubToken ? encrypt(githubToken) : '';
    if (geminiModel) patch.geminiModel = geminiModel;
    await db.users.update(user.id, patch);
    await logEvent(user.id, 'keys.update', { gemini: Boolean(geminiKey), github: Boolean(githubToken) });
    return ok(res, {
      geminiKeySet: Boolean(patch.geminiKeyEnc ?? user.geminiKeyEnc),
      openaiKeySet: Boolean(patch.openaiKeyEnc ?? user.openaiKeyEnc),
      githubConnected: Boolean(patch.githubTokenEnc ?? user.githubTokenEnc),
    });
  });

  router.get('/api/profile', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    return ok(res, { user: publicUser(user) });
  });

  router.put('/api/profile', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { name, avatarColor } = await parseJson(req);
    const patch = {};
    if (name) patch.name = String(name).slice(0, 60);
    if (avatarColor) patch.avatarColor = String(avatarColor).slice(0, 20);
    await db.users.update(user.id, patch);
    return ok(res, { user: publicUser(db.users.byId(user.id)) });
  });
}
