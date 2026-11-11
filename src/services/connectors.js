import { config } from '../config.js';

// ── Platform connector registry ─────────────────────────────────────────────
// Every connector exposes: metadata, the credentials it needs, and a publish()
// that performs the real platform API call. When MOCK_PUBLISHING is on (the
// default) publish() returns a simulated result so the whole app is testable
// without live accounts.

async function req(url, { method = 'POST', headers = {}, body, form } = {}) {
  const opts = { method, headers: { ...headers } };
  if (form) {
    opts.body = new URLSearchParams(form).toString();
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const mockId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function mock(platform, content) {
  return {
    ok: true,
    mocked: true,
    platform,
    externalId: mockId(platform.slice(0, 3)),
    url: `https://example.com/${platform}/${mockId('p')}`,
    publishedAt: new Date().toISOString(),
    echoed: { title: content.title, chars: (content.body || '').length },
  };
}

export const PLATFORMS = {
  telegram: {
    id: 'telegram',
    name: 'Telegram channel',
    category: 'social',
    fields: [{ key: 'botToken', label: 'Bot token', secret: true }, { key: 'chatId', label: 'Channel @username or chat id' }],
    free: true,
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('telegram', content);
      const text = content.title ? `*${content.title}*\n\n${content.body}` : content.body;
      return req(`https://api.telegram.org/bot${account.credentials.botToken}/sendMessage`, {
        body: { chat_id: account.credentials.chatId, text, parse_mode: 'Markdown' },
      });
    },
  },

  blogger: {
    id: 'blogger',
    name: 'Blogger blog',
    category: 'blog',
    fields: [
      { key: 'blogId', label: 'Blog ID' },
      { key: 'apiKey', label: 'Blogger API key', secret: true },
      { key: 'accessToken', label: 'OAuth access token (Authorize Blogger)', secret: true },
    ],
    free: true,
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('blogger', content);
      const { blogId, accessToken, apiKey } = account.credentials;
      return req(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?key=${apiKey}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { title: content.title, content: mdToHtml(content.body), labels: content.tags || [] },
      });
    },
  },

  facebook_page: {
    id: 'facebook_page',
    name: 'Facebook Page',
    category: 'social',
    fields: [{ key: 'pageId', label: 'Page ID' }, { key: 'accessToken', label: 'Page access token', secret: true }],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('facebook_page', content);
      const { pageId, accessToken } = account.credentials;
      return req(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        body: { message: content.title ? `${content.title}\n\n${content.body}` : content.body, access_token: accessToken },
      });
    },
  },

  instagram: {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    fields: [
      { key: 'igUserId', label: 'Instagram business user id' },
      { key: 'accessToken', label: 'Access token', secret: true },
    ],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('instagram', content);
      const { igUserId, accessToken } = account.credentials;
      // Image/video posts need a public media URL; caption-only is stored as a draft.
      if (!content.mediaUrl) return { ok: true, mocked: false, platform: 'instagram', status: 'draft_no_media', note: 'Instagram requires a hosted media URL.' };
      const create = await req(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
        body: { image_url: content.mediaUrl, caption: content.body, access_token: accessToken },
      });
      return req(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
        body: { creation_id: create.id, access_token: accessToken },
      });
    },
  },

  x: {
    id: 'x',
    name: 'X (Twitter)',
    category: 'social',
    fields: [{ key: 'accessToken', label: 'OAuth 2.0 user token', secret: true }],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('x', content);
      const text = `${content.body}\n\n${(content.tags || []).map((t) => `#${t}`).join(' ')}`.trim().slice(0, 280);
      return req('https://api.twitter.com/2/tweets', {
        headers: { Authorization: `Bearer ${account.credentials.accessToken}` },
        body: { text },
      });
    },
  },

  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'social',
    fields: [
      { key: 'accessToken', label: 'Access token', secret: true },
      { key: 'boardId', label: 'Board id' },
    ],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('pinterest', content);
      const { accessToken, boardId } = account.credentials;
      return req('https://api.pinterest.com/v5/pins', {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          board_id: boardId,
          title: content.title,
          description: content.body,
          media_source: content.mediaUrl ? { source_type: 'image_url', url: content.mediaUrl } : undefined,
        },
      });
    },
  },

  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    category: 'social',
    fields: [{ key: 'accessToken', label: 'Access token', secret: true }, { key: 'openId', label: 'Open id' }],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('tiktok', content);
      if (!content.mediaUrl) return { ok: true, mocked: false, platform: 'tiktok', status: 'draft_no_media', note: 'TikTok needs a video URL/file.' };
      return req('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        headers: { Authorization: `Bearer ${account.credentials.accessToken}` },
        body: { post_info: { title: content.title, description: content.body }, source_info: { source: 'PULL_FROM_URL', video_url: content.mediaUrl } },
      });
    },
  },

  youtube: {
    id: 'youtube',
    name: 'YouTube / Dailymotion',
    category: 'social',
    fields: [{ key: 'accessToken', label: 'Google OAuth token', secret: true }],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('youtube', content);
      if (!content.mediaUrl) return { ok: true, mocked: false, platform: 'youtube', status: 'draft_no_media', note: 'Video upload needs a media file.' };
      // Resumable upload init.
      return req('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        headers: { Authorization: `Bearer ${account.credentials.accessToken}`, 'X-Upload-Content-Type': 'video/*' },
        body: { snippet: { title: content.title, description: content.body, tags: content.tags || [] }, status: { privacyStatus: 'public' } },
      });
    },
  },

  dailymotion: {
    id: 'dailymotion',
    name: 'Dailymotion',
    category: 'social',
    fields: [{ key: 'accessToken', label: 'Access token', secret: true }],
    async publish({ account, content }) {
      if (config.mockPublishing) return mock('dailymotion', content);
      return req('https://api.dailymotion.com/me/videos', {
        headers: { Authorization: `Bearer ${account.credentials.accessToken}` },
        body: { title: content.title, description: content.body, url: content.mediaUrl },
      });
    },
  },
};

export function listPlatforms() {
  return Object.values(PLATFORMS).map(({ id, name, category, fields, free }) => ({ id, name, category, fields, free: Boolean(free) }));
}

export function getPlatform(id) {
  return PLATFORMS[id] || null;
}

// Publish one content item to one account; never throws — returns a result.
export async function publishToAccount(account, content) {
  const platform = getPlatform(account.platform);
  if (!platform) return { ok: false, platform: account.platform, error: 'Unknown platform' };
  try {
    const result = await platform.publish({ account, content });
    return { ok: true, platform: account.platform, accountId: account.id, ...result };
  } catch (err) {
    return { ok: false, platform: account.platform, accountId: account.id, error: String(err.message || err) };
  }
}

// Very small Markdown -> HTML for Blogger (headings, bold, paragraphs).
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md || '').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${para.join(' ')}</p>`);
      para = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    let m;
    if ((m = t.match(/^###\s+(.*)/))) { flush(); out.push(`<h3>${esc(m[1])}</h3>`); }
    else if ((m = t.match(/^##\s+(.*)/))) { flush(); out.push(`<h2>${esc(m[1])}</h2>`); }
    else if ((m = t.match(/^#\s+(.*)/))) { flush(); out.push(`<h1>${esc(m[1])}</h1>`); }
    else {
      para.push(esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>'));
    }
  }
  flush();
  return out.join('\n');
}
