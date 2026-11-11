import http from 'node:http';
import { config, ensureDirs } from './config.js';
import { Router } from './lib/router.js';
import { attachUser } from './lib/auth.js';
import { serveStatic, json, notFound, serverError, parseJson } from './lib/http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerComposerRoutes } from './routes/composer.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { tick, tickScheduledPosts } from './services/scheduler.js';

ensureDirs();

const router = new Router();
registerAuthRoutes(router);
registerAccountRoutes(router);
registerComposerRoutes(router);
registerAutomationRoutes(router);
registerToolRoutes(router);
registerCommunityRoutes(router);
registerDashboardRoutes(router);

// SPA-style page routes serve the single-page shell from public/.
const PAGES = new Set(['/', '/dashboard', '/tools', '/automation', '/composer', '/community', '/connections', '/login', '/register', '/settings']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  // Security headers for a self-hosted app.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    attachUser(req);

    if (pathname.startsWith('/api/')) {
      const match = router.match(req.method, pathname);
      if (!match) return notFound(res, 'No such endpoint');
      await match.handler(req, res, match.params);
      return;
    }

    // Static assets (css/js/images).
    if (/\.(css|js|svg|png|jpg|ico|woff2|txt)$/.test(pathname)) {
      if (serveStatic(req, res, pathname)) return;
      return notFound(res, 'Asset not found');
    }

    // OAuth callback placeholder: real deployments swap these for the provider
    // redirect flow; here we just bounce back to the connections page.
    if (pathname.startsWith('/oauth/')) {
      res.writeHead(302, { Location: `/connections?connected=${pathname.split('/').pop()}` });
      return res.end();
    }

    // SPA pages.
    if (PAGES.has(pathname) && serveStatic(req, res, '/index.html')) return;

    if (serveStatic(req, res, pathname)) return;
    return notFound(res, 'Not found');
  } catch (err) {
    console.error('[error]', err);
    return serverError(res, String(err?.message || err));
  }
});

// In-process scheduler tick: advance due orders and scheduled posts each minute.
let ticking = false;
const interval = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await tick(new Date());
    await tickScheduledPosts(new Date());
  } catch (err) {
    console.error('[tick]', err);
  } finally {
    ticking = false;
  }
}, 60_000);
interval.unref?.();

server.listen(config.port, config.host, () => {
  console.log(`\n  AlphaPost clone running`);
  console.log(`  → http://localhost:${config.port}`);
  console.log(`  data:   ${config.dataDir}`);
  console.log(`  mode:   ${config.mockPublishing ? 'MOCK publishing (no live API calls)' : 'LIVE publishing'}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(interval);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}
