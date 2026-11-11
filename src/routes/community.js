import { db, logEvent, bumpStat } from '../lib/store.js';
import { json, ok, badRequest, notFound, parseJson } from '../lib/http.js';
import { requireUser, publicUser } from '../lib/auth.js';

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || `post-${Date.now().toString(36)}`;

export function registerCommunityRoutes(router) {
  // Public feed of threads.
  router.get('/api/community', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let threads = db.community.filter((t) => !t.parentId);
    if (q) threads = threads.filter((t) => `${t.title} ${t.body}`.toLowerCase().includes(q));
    threads = threads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
    return ok(res, { threads: threads.map(shapeThread) });
  });

  router.get('/api/community/:slug', (req, res) => {
    const thread = db.community.find((t) => t.slug === req.params.slug && !t.parentId);
    if (!thread) return notFound(res, 'Thread not found');
    const replies = db.community.filter((t) => t.parentId === thread.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return ok(res, { thread: shapeThread(thread), replies: replies.map(shapeThread) });
  });

  router.post('/api/community', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const { title, body } = await parseJson(req);
    if (!title || String(title).trim().length < 6) return badRequest(res, 'Give your post a clear title');
    const thread = await db.community.insert({
      userId: user.id,
      slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(title).slice(0, 160),
      body: String(body || '').slice(0, 8000),
      votes: 0,
      views: 0,
    });
    await bumpStat('community_posts');
    await logEvent(user.id, 'community.post', { threadId: thread.id });
    return json(res, 201, { thread: shapeThread(thread) });
  });

  router.post('/api/community/:slug/reply', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const thread = db.community.find((t) => t.slug === req.params.slug && !t.parentId);
    if (!thread) return notFound(res, 'Thread not found');
    const { body } = await parseJson(req);
    if (!body) return badRequest(res, 'Reply cannot be empty');
    const reply = await db.community.insert({
      userId: user.id,
      parentId: thread.id,
      slug: `reply-${Date.now().toString(36)}`,
      title: '',
      body: String(body).slice(0, 4000),
      votes: 0,
      views: 0,
    });
    await logEvent(user.id, 'community.reply', { threadId: thread.id });
    return json(res, 201, { reply: shapeThread(reply) });
  });

  router.post('/api/community/:slug/vote', async (req, res) => {
    const thread = db.community.find((t) => t.slug === req.params.slug);
    if (!thread) return notFound(res, 'Thread not found');
    const { direction } = await parseJson(req).catch(() => ({ direction: 'up' }));
    const updated = await db.community.update(thread.id, { votes: (thread.votes || 0) + (direction === 'down' ? -1 : 1) });
    return ok(res, { votes: updated.votes });
  });

  router.post('/api/community/:slug/view', async (req, res) => {
    const thread = db.community.find((t) => t.slug === req.params.slug);
    if (!thread) return notFound(res, 'Thread not found');
    const updated = await db.community.update(thread.id, { views: (thread.views || 0) + 1 });
    return ok(res, { views: updated.views });
  });
}

function shapeThread(t) {
  const user = db.users.byId(t.userId);
  return {
    id: t.id,
    slug: t.slug,
    parentId: t.parentId || null,
    title: t.title,
    body: t.body,
    votes: t.votes || 0,
    views: t.views || 0,
    createdAt: t.createdAt,
    author: user ? { name: user.name, avatarColor: user.avatarColor } : { name: 'Deleted user', avatarColor: '#888' },
  };
}

export { publicUser };
