// Seeds demo data so the clone looks alive on first run.
// Usage: node scripts/seed.js
import { db, bumpStat } from '../src/lib/store.js';
import { hashPassword, randomHex } from '../src/lib/crypto.js';
import { ensureDirs } from '../src/config.js';

ensureDirs();

const DEMO_EMAIL = 'demo@alphapost.local';
const DEMO_PASSWORD = 'demopass123';

async function main() {
  let user = db.users.find((u) => u.email === DEMO_EMAIL);
  if (!user) {
    user = await db.users.insert({
      email: DEMO_EMAIL,
      name: 'Naveed Shah',
      passwordHash: hashPassword(DEMO_PASSWORD),
      avatarColor: '#6c5ce7',
      plan: 'free',
      geminiKeyEnc: '',
      githubTokenEnc: '',
      orderToken: randomHex(16),
    });
    await bumpStat('members', 9450);
    console.log(`Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    console.log(`Demo user exists: ${DEMO_EMAIL}`);
  }

  // Community threads (mirrors the kinds of posts on the real site).
  const threads = [
    { title: '4 Hidden Traffic Sources Most Bloggers Ignore', body: 'Reddit niche subs, Quora answer + blog link, Pinterest idea pins, and a weekly newsletter swap with 3 creators in your niche. These four quietly out-earn paid ads for me.' },
    { title: 'Google paused new posts on this Google account for now', body: 'AlphaPost tries again by itself in about 12 hours. Pressing again earlier only makes Google wait longer.' },
    { title: 'Want to SCALE (Plz GUIDE!)', body: 'I have 3 blogs on autopilot. What is the best way to add a 4th without burning my Gemini free tier?' },
    { title: 'Game Ads', body: 'Anyone monetizing a gaming blog? Which ad networks actually pay for low-CPM traffic?' },
  ];
  for (const t of threads) {
    if (db.community.find((c) => c.title === t.title)) continue;
    await db.community.insert({
      userId: user.id,
      slug: t.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) + '-' + Math.random().toString(36).slice(2, 6),
      title: t.title,
      body: t.body,
      votes: Math.floor(Math.random() * 12),
      views: Math.floor(Math.random() * 60),
    });
    await bumpStat('community_posts');
  }

  await bumpStat('articles_published', 130760);
  await bumpStat('posts_sent', 117860);
  await bumpStat('videos_made', 12470);
  await bumpStat('countries', 139);

  console.log('Seed complete.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
