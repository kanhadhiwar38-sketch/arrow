import { db, logEvent, bumpStat } from '../lib/store.js';
import { json, ok, badRequest, parseJson } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { writeContent } from '../services/ai.js';
import { publishToAccount } from '../services/connectors.js';
import { hydrate, publicAccount } from '../lib/accounts.js';

export function registerComposerRoutes(router) {
  // Generate content only (preview / draft) — no publishing.
  router.post('/api/composer/write', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await parseJson(req);
    if (!body.topic) return badRequest(res, 'A topic is required');
    const result = await writeContent({
      user,
      inlineKey: body.inlineKey || '',
      kind: body.kind || 'caption',
      topic: body.topic,
      tone: body.tone || 'friendly',
      words: Number(body.words) || (body.kind === 'caption' ? 60 : 700),
      category: body.category || '',
      audience: body.audience || '',
      extra: body.extra || '',
    });
    return ok(res, result);
  });

  // Publish now or schedule for later, to one or many accounts.
  router.post('/api/composer/publish', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await parseJson(req);
    const { title = '', body: text = '', tags = [], accountIds = [], mediaUrl = '', when = null, topic = '' } = body;
    if (!text && !topic) return badRequest(res, 'Nothing to publish');
    if (!accountIds.length) return badRequest(res, 'Pick at least one account');

    const accounts = accountIds.map((id) => db.accounts.byId(id)).filter((a) => a && a.userId === user.id && a.status !== 'disconnected');
    if (!accounts.length) return badRequest(res, 'No valid accounts selected');

    // Schedule for the future instead of publishing immediately.
    const scheduledFor = when ? new Date(when) : null;
    if (scheduledFor && scheduledFor.getTime() > Date.now() + 30_000) {
      const post = await db.posts.insert({
        userId: user.id,
        accountIds: accounts.map((a) => a.id),
        platforms: accounts.map((a) => a.platform),
        title,
        body: text,
        tags,
        mediaUrl,
        status: 'scheduled',
        scheduledFor: scheduledFor.toISOString(),
        source: 'composer',
      });
      await logEvent(user.id, 'post.schedule', { postId: post.id, at: post.scheduledFor });
      return json(res, 201, { scheduled: true, post: sanitize(post) });
    }

    // Publish immediately to every selected account.
    const content = { title, body: text, tags, mediaUrl };
    const results = [];
    for (const account of accounts) {
      const res1 = await publishToAccount(hydrate(account), content);
      results.push({ accountId: account.id, platform: account.platform, ...res1 });
      await db.posts.insert({
        userId: user.id,
        accountId: account.id,
        platform: account.platform,
        title,
        body: text,
        tags,
        mediaUrl,
        status: res1.ok ? (res1.status || 'published') : 'failed',
        mocked: Boolean(res1.mocked),
        externalId: res1.externalId || null,
        url: res1.url || null,
        error: res1.error || null,
        source: 'composer',
      });
      if (res1.ok) await bumpStat('posts_sent');
    }
    await logEvent(user.id, 'post.publish', { count: results.length });
    return json(res, 201, { published: true, results });
  });

  // History feed.
  router.get('/api/posts', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const url = new URL(req.url, 'http://localhost');
    const status = url.searchParams.get('status');
    let posts = db.posts.filter((p) => p.userId === user.id);
    if (status) posts = posts.filter((p) => p.status === status);
    posts = posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200);
    return ok(res, { posts: posts.map(sanitize) });
  });

  router.delete('/api/posts/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const post = db.posts.byId(req.params.id);
    if (!post || post.userId !== user.id) return ok(res, { removed: false });
    await db.posts.remove(post.id);
    return ok(res, { removed: true });
  });
}

function sanitize(post) {
  const { ...rest } = post;
  return rest;
}

export { sanitize };
