import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { randomHex } from './crypto.js';

// A dead-simple, dependency-free JSON document store. Each "collection" is a
// single JSON file in DATA_DIR. Reads are cached in memory; writes are atomic
// (temp file + rename). Adequate for a self-hosted clone; swap for real SQL
// before multi-instance deployment.

const cache = new Map();
const writeChain = new Map();

function fileFor(name) {
  return path.join(config.dataDir, `${name}.json`);
}

function read(name) {
  if (cache.has(name)) return cache.get(name);
  const file = fileFor(name);
  let data = [];
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      data = [];
    }
  }
  cache.set(name, data);
  return data;
}

function persist(name) {
  const file = fileFor(name);
  const data = cache.get(name) ?? [];
  const tmp = `${file}.${randomHex(4)}.tmp`;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Serialize writes per collection so concurrent requests can't corrupt a file.
function queue(name, fn) {
  const prev = writeChain.get(name) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeChain.set(name, next);
  return next;
}

export class Collection {
  constructor(name) {
    this.name = name;
  }
  all() {
    return read(this.name);
  }
  find(predicate) {
    return this.all().find(predicate) || null;
  }
  filter(predicate) {
    return this.all().filter(predicate);
  }
  byId(id) {
    return this.find((d) => d.id === id) || null;
  }
  count(predicate) {
    return predicate ? this.filter(predicate).length : this.all().length;
  }
  async insert(doc) {
    return queue(this.name, () => {
      const list = read(this.name);
      const record = {
        id: doc.id || `${this.name.slice(0, 3)}_${randomHex(8)}`,
        createdAt: doc.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...doc,
      };
      list.push(record);
      cache.set(this.name, list);
      persist(this.name);
      return record;
    });
  }
  async update(id, patch) {
    return queue(this.name, () => {
      const list = read(this.name);
      const idx = list.findIndex((d) => d.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...patch, id, updatedAt: new Date().toISOString() };
      cache.set(this.name, list);
      persist(this.name);
      return list[idx];
    });
  }
  async remove(id) {
    return queue(this.name, () => {
      const list = read(this.name);
      const idx = list.findIndex((d) => d.id === id);
      if (idx === -1) return false;
      const [removed] = list.splice(idx, 1);
      cache.set(this.name, list);
      persist(this.name);
      return removed;
    });
  }
}

export const db = {
  users: new Collection('users'),
  sessions: new Collection('sessions'),
  accounts: new Collection('accounts'), // connected social/blogger accounts
  orders: new Collection('orders'), // automation jobs
  posts: new Collection('posts'), // published / scheduled / draft posts
  tools: new Collection('tools'), // tool runs (keyword research, aeo, etc.)
  community: new Collection('community'), // community threads + replies
  logs: new Collection('logs'), // activity log / history
  stats: new Collection('stats'), // global counters for the landing page
};

export async function logEvent(userId, action, meta = {}) {
  return db.logs.insert({ userId: userId || null, action, meta });
}

export async function bumpStat(key, delta = 1) {
  const existing = db.stats.find((s) => s.key === key);
  if (existing) return db.stats.update(existing.id, { value: (existing.value || 0) + delta });
  return db.stats.insert({ key, value: delta });
}

export async function getStats() {
  const counters = {};
  for (const s of db.stats.all()) counters[s.key] = s.value || 0;
  return counters;
}
