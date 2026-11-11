import { db, logEvent } from '../lib/store.js';
import { json, ok, badRequest, notFound, parseJson } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { validateCron, describeCron, nextRun, runOrder, generateWorkflow } from '../services/scheduler.js';
import { publicAccount } from '../lib/accounts.js';

export function registerAutomationRoutes(router) {
  // List automation orders.
  router.get('/api/orders', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const orders = db.orders
      .filter((o) => o.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(shapeOrder);
    return ok(res, { orders });
  });

  // Create an order (a recurring posting job).
  router.post('/api/orders', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await parseJson(req);
    const schedule = body.schedule || '0 9 * * *';
    const check = validateCron(schedule);
    if (!check.valid) return badRequest(res, check.error);
    if (!body.topic) return badRequest(res, 'A topic / prompt is required');

    const accountIds = (body.accountIds || []).filter((id) => {
      const a = db.accounts.byId(id);
      return a && a.userId === user.id;
    });
    const existing = db.orders.filter((o) => o.userId === user.id).length;
    if (existing >= 5) return badRequest(res, 'Free tier allows up to 5 orders');

    const order = await db.orders.insert({
      userId: user.id,
      name: (body.name || body.topic).slice(0, 80),
      kind: body.kind || 'article',
      topic: body.topic,
      prompt: body.prompt || '',
      tone: body.tone || 'friendly',
      words: Number(body.words) || 700,
      category: body.category || '',
      audience: body.audience || '',
      schedule,
      accountIds,
      status: body.status || 'active',
      runOnGitHub: Boolean(body.runOnGitHub),
      lastRunAt: null,
      nextRunAt: nextRun(schedule),
    });
    await logEvent(user.id, 'order.create', { orderId: order.id, schedule });
    return json(res, 201, { order: shapeOrder(order) });
  });

  router.get('/api/orders/:id', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    return ok(res, { order: shapeOrder(order), workflow: generateWorkflow(order) });
  });

  router.put('/api/orders/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    const body = await parseJson(req);
    if (body.schedule) {
      const check = validateCron(body.schedule);
      if (!check.valid) return badRequest(res, check.error);
    }
    const patch = { ...body };
    delete patch.id;
    delete patch.userId;
    if (body.schedule) patch.nextRunAt = nextRun(body.schedule);
    delete patch.workflow;
    const updated = await db.orders.update(order.id, patch);
    await logEvent(user.id, 'order.update', { orderId: order.id });
    return ok(res, { order: shapeOrder(updated) });
  });

  router.post('/api/orders/:id/pause', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    const updated = await db.orders.update(order.id, { status: order.status === 'active' ? 'paused' : 'active' });
    return ok(res, { order: shapeOrder(updated) });
  });

  router.delete('/api/orders/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    await db.orders.remove(order.id);
    return ok(res);
  });

  // Run an order immediately ("Run Now").
  router.post('/api/orders/:id/run', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    let source = 'manual';
    try { source = (await parseJson(req)).source || 'manual'; } catch { /* no body */ }
    const result = await runOrder(order, { source });
    if (!result.ok) return badRequest(res, result.error);
    return ok(res, result);
  });

  // The GitHub Actions workflow file for an order (copy/paste or commit).
  router.get('/api/orders/:id/workflow', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const order = db.orders.byId(req.params.id);
    if (!order || order.userId !== user.id) return notFound(res, 'Order not found');
    return ok(res, { workflow: generateWorkflow(order), path: '.github/workflows/alphapost-cron.yml' });
  });

  // Preview a cron schedule in words + next run.
  router.get('/api/cron/preview', (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const expr = url.searchParams.get('expr') || '';
    const check = validateCron(expr);
    if (!check.valid) return ok(res, { valid: false, error: check.error });
    return ok(res, {
      valid: true,
      expr,
      description: describeCron(expr),
      nextRun: nextRun(expr, new Date()),
    });
  });
}

function shapeOrder(order) {
  return {
    ...order,
    accounts: (order.accountIds || []).map((id) => {
      const a = db.accounts.byId(id);
      return a ? publicAccount(a) : { id, platform: 'missing', label: '(deleted)' };
    }),
    scheduleDescription: describeCron(order.schedule),
    nextRunAt: order.nextRunAt || nextRun(order.schedule),
  };
}
