import { db, getStats } from '../lib/store.js';
import { ok } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

export function registerDashboardRoutes(router) {
  // Public "live numbers" shown on the landing page.
  router.get('/api/stats', async (req, res) => {
    const counters = await getStats();
    return ok(res, {
      members: counters.members || 0,
      articles_published: counters.articles_published || 0,
      posts_sent: counters.posts_sent || 0,
      videos_made: counters.videos_made || 0,
      community_posts: counters.community_posts || 0,
      countries: counters.countries || 139,
      tools: 16,
    });
  });

  // Authenticated dashboard summary.
  router.get('/api/dashboard', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const accounts = db.accounts.filter((a) => a.userId === user.id);
    const orders = db.orders.filter((o) => o.userId === user.id);
    const posts = db.posts.filter((p) => p.userId === user.id);
    const weekAgo = Date.now() - 7 * 864e5;
    return ok(res, {
      counts: {
        accounts: accounts.length,
        orders: orders.length,
        activeOrders: orders.filter((o) => o.status === 'active').length,
        published: posts.filter((p) => p.status === 'published').length,
        scheduled: posts.filter((p) => p.status === 'scheduled').length,
        failed: posts.filter((p) => p.status === 'failed').length,
        thisWeek: posts.filter((p) => new Date(p.createdAt).getTime() > weekAgo).length,
      },
      recentPosts: posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
      upcoming: orders
        .filter((o) => o.status === 'active')
        .map((o) => ({ id: o.id, name: o.name, nextRunAt: o.nextRunAt }))
        .sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt))
        .slice(0, 5),
    });
  });

  // Per-user activity log.
  router.get('/api/history', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const logs = db.logs
      .filter((l) => l.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100)
      .map((l) => ({ id: l.id, action: l.action, meta: l.meta, at: l.createdAt }));
    return ok(res, { history: logs });
  });
}
