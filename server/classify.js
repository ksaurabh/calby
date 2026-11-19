// A small on-disk cache for model answers worth keeping across restarts — the
// commitment-aware slot review is keyed by the caller's own fingerprint here.
// (Calendar entries are labelled with commitment types by rules, in
// shared/commitmentRules.js, with no model and nothing to cache.)
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'classification-cache.json');
// Plenty for years of one person's calendar; bounded so the file cannot grow
// without limit as events and conditions change.
const MAX_ENTRIES = 20000;
// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
// { [key]: { value, at } } — `at` drives eviction, and is refreshed on read so
// the entries in active use are the ones that survive.
let cache = loadCache();
let saveTimer = null;

function loadCache() {
  try {
    if (!existsSync(CACHE_FILE)) return new Map();
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(data.entries || {}));
  } catch {
    return new Map();
  }
}

function writeCache() {
  try {
    evict();
    writeFileSync(CACHE_FILE, JSON.stringify({ entries: Object.fromEntries(cache) }, null, 2));
  } catch (err) {
    console.error('[classify] could not persist the cache:', err.message);
  }
}

// Batched: a preview can resolve dozens of entries, and they should cost one write.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeCache();
  }, 500);
  saveTimer.unref?.();
}

// A restart inside the debounce window would otherwise throw away verdicts we
// have already paid for, so pending writes are flushed on the way out.
function flushCache() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeCache();
}

process.on('exit', flushCache);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    flushCache();
    process.exit(0);
  });
}

function evict() {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestFirst = [...cache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [key] of oldestFirst.slice(0, cache.size - MAX_ENTRIES)) cache.delete(key);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  hit.at = Date.now(); // keep in-use entries fresh for eviction
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
  scheduleSave();
}

const sha = value => createHash('sha1').update(value).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// Slot-review cache, keyed by the caller's own fingerprint
// ---------------------------------------------------------------------------
export function cachedSlotReview(key) {
  return cacheGet(`review:${key}`);
}

export function cacheSlotReview(key, value) {
  cacheSet(`review:${key}`, value);
}

/** Stable short hash, for callers building their own cache keys. */
export function fingerprintOf(value) {
  return sha(typeof value === 'string' ? value : JSON.stringify(value));
}

/** Test/maintenance hook: forget everything. */
export function clearClassificationCache() {
  cache = new Map();
  scheduleSave();
}
