import { db, logEvent, bumpStat } from '../lib/store.js';
import { ok, badRequest, parseJson } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import {
  TOOL_CATALOG,
  getTool,
  keywordResearch,
  aeoCheck,
  shortsPlan,
  videoPlan,
  translatePlan,
  carouselPlan,
  websiteToSocial,
} from '../services/tools.js';

export function registerToolRoutes(router) {
  // The public catalog used by the landing/tools pages.
  router.get('/api/tools', (req, res) => ok(res, { tools: TOOL_CATALOG }));

  // Run any tool by id. Body shape depends on the tool.
  router.post('/api/tools/:id/run', async (req, res) => {
    const meta = getTool(req.params.id);
    if (!meta) return badRequest(res, 'Unknown tool');
    const body = await parseJson(req).catch(() => ({}));

    // Some tools work without an account (keyword research, AEO, w2s).
    const needsAuth = !['keyword-research', 'aeo-checker', 'website-to-social'].includes(meta.id);
    let user = req.user;
    if (needsAuth && !user) return badRequest(res, 'Please sign in to use this tool');

    let result;
    switch (meta.id) {
      case 'keyword-research':
        if (!body.seed) return badRequest(res, 'Enter a seed keyword');
        result = await keywordResearch({ user, seed: body.seed, country: body.country || 'us' });
        break;
      case 'aeo-checker':
        if (!body.url) return badRequest(res, 'Enter a URL');
        result = await aeoCheck({ url: body.url });
        break;
      case 'website-to-social':
        if (!body.site) return badRequest(res, 'Enter a site URL');
        result = await websiteToSocial({ user, site: body.site, limit: Number(body.limit) || 5 });
        break;
      case 'shorts-maker':
        result = await shortsPlan({ user, source: body.source, count: body.count, topic: body.topic });
        break;
      case 'ai-video-maker':
        result = await videoPlan({ user, idea: body.idea || body.topic, seconds: Number(body.seconds) || 30, style: body.style });
        break;
      case 'video-translator':
        result = await translatePlan({ user, video: body.video, language: body.language || 'es' });
        break;
      case 'instagram-carousel':
        result = await carouselPlan({ user, topic: body.topic, slides: Number(body.slides) || 6 });
        break;
      default:
        result = await genericContentTool({ user, tool: meta, body });
    }

    if (user) {
      await db.tools.insert({ userId: user.id, toolId: meta.id, input: redact(body), summary: summarize(meta.id, result) });
      await bumpStat('tool_runs');
      await logEvent(user.id, 'tool.run', { tool: meta.id });
    }
    return ok(res, { tool: meta.id, result });
  });
}

// Tools whose job is simply "produce content for a platform" (the auto-post
// tools: facebook, instagram, x, telegram, pinterest, tiktok, youtube, blogger).
async function genericContentTool({ user, tool, body }) {
  const { writeContent } = await import('../services/ai.js');
  const kind = tool.id.includes('blogger') ? 'article' : 'caption';
  const out = await writeContent({
    user,
    inlineKey: body.inlineKey || '',
    kind,
    topic: body.topic || tool.name,
    tone: body.tone || 'friendly',
    words: Number(body.words) || (kind === 'article' ? 700 : 60),
    extra: body.extra || '',
  });
  return { ...out, hint: 'Copy this into the composer, or create an order to auto-post it.' };
}

function redact(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    out[k] = /key|token|secret|password/i.test(k) ? '[redacted]' : v;
  }
  return out;
}

function summarize(id, result) {
  if (id === 'keyword-research') return `${result.keywords?.length || 0} keywords`;
  if (id === 'aeo-checker') return `score ${result.score ?? 'n/a'}`;
  if (id === 'website-to-social') return `${result.shares?.length || 0} articles`;
  if (id === 'shorts-maker') return `${result.shorts?.length || 0} shorts`;
  if (id === 'ai-video-maker') return `${result.scenes?.length || 0} scenes`;
  if (id === 'instagram-carousel') return `${result.slides?.length || 0} slides`;
  return result.title || 'ok';
}
