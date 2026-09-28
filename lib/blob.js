const crypto = require('crypto');
const { put, del } = require('@vercel/blob');

// Shared JSON storage helpers for every /api function.
//
// Reads fetch the blob's public URL directly instead of calling list() first.
// list() counts as an "Advanced Operation" on Vercel Blob (the free tier allows
// only 2,000/month), so calling it on every page view is what got the store
// paused. A direct URL fetch costs no advanced operation, and a CDN cache hit
// costs nothing at all.

// Public base URL of the store, e.g. https://<storeId>.public.blob.vercel-storage.com
// Derived from the read/write token the same way @vercel/blob does internally.
function blobBaseUrl() {
  if (process.env.BLOB_PUBLIC_BASE_URL) return process.env.BLOB_PUBLIC_BASE_URL.replace(/\/$/, '');
  const [, , , storeId = ''] = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_');
  if (!storeId) throw new Error('BLOB_READ_WRITE_TOKEN is not configured.');
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

// ── Private data ──
// The Blob store is public: anyone who knows a file's URL can read it. Files that
// hold the admin PIN, customer orders or business finances therefore never live at
// a guessable path like mk-data/orders.json. They're stored under
// mk-private/<secret>/..., where <secret> is derived from the server-only
// BLOB_READ_WRITE_TOKEN (or PRIVATE_DATA_KEY if set). Store contents can't be listed
// without the token, so the URL can't be discovered from outside.
//
// NOTE: if BLOB_READ_WRITE_TOKEN is ever rotated, set PRIVATE_DATA_KEY to the old
// secret first (see privateSecret()), or these files will appear empty.
const PRIVATE_FILES = new Set([
  'mk-data/config.json',   // admin PIN
  'mk-data/orders.json',   // customer names, phones, addresses
  'mk-data/expenses.json',
  'mk-data/supplies.json',
  'mk-data/settings.json',
  'mk-data/auth.json',     // PIN lockout state
]);

function privateSecret() {
  if (process.env.PRIVATE_DATA_KEY) return process.env.PRIVATE_DATA_KEY;
  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not configured.');
  return crypto.createHmac('sha256', token).update('myriamkay-private-data-v1').digest('hex').slice(0, 48);
}

function storagePath(path) {
  if (!PRIVATE_FILES.has(path)) return path;
  return `mk-private/${privateSecret()}/${path.split('/').pop()}`;
}

async function fetchJson(storedPath, fresh) {
  const url = `${blobBaseUrl()}/${storedPath}` + (fresh ? `?t=${Date.now()}` : '');
  const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Storage read failed for ${storedPath.startsWith('mk-private/') ? 'private data' : storedPath} (${res.status}${text ? `: ${text.slice(0, 80)}` : ''})`);
    err.storageUnavailable = true;
    throw err;
  }
  return res.json();
}

// One-time move of a private file from its old public path to the private one,
// then delete the public copy so it can no longer be read.
const migrated = new Set();
async function migrateFromPublic(path) {
  const legacy = await fetchJson(path, true);
  if (legacy === null) return null;
  await put(storagePath(path), JSON.stringify(legacy), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json', cacheControlMaxAge: 60,
  });
  await del(`${blobBaseUrl()}/${path}`);
  console.log(`moved ${path} to private storage`);
  return legacy;
}

// Move every private file on first use in this process, so none stays public just
// because its admin screen hasn't been opened yet.
let migrateAllPromise = null;
function migrateAllOnce() {
  if (!migrateAllPromise) {
    migrateAllPromise = Promise.all([...PRIVATE_FILES].map(async path => {
      if (migrated.has(path)) return;
      const current = await fetchJson(storagePath(path), true);
      if (current === null) await migrateFromPublic(path);
      else await fetchJson(path, true).then(old => old !== null && del(`${blobBaseUrl()}/${path}`)); // leftover public copy
      migrated.add(path);
    })).catch(e => { migrateAllPromise = null; throw e; });
  }
  return migrateAllPromise;
}

// Returns the parsed JSON, or null if the file doesn't exist yet.
// Throws on any other failure (store paused, network error, bad JSON) so a
// failed read is never mistaken for "empty" and then written back over real data.
//
// fresh: true  -> skip the CDN cache. Use it before any read-modify-write and
//                 for the admin, so edits always start from the latest data.
// fresh: false -> allow the CDN copy (at most ~60s stale). Use it for public reads.
async function readJson(path, { fresh = false } = {}) {
  if (!PRIVATE_FILES.has(path)) return fetchJson(path, fresh);
  await migrateAllOnce();
  return fetchJson(storagePath(path), true); // private data is always read fresh
}

async function writeJson(path, data) {
  if (PRIVATE_FILES.has(path)) await migrateAllOnce(); // never let an old public copy linger
  await put(storagePath(path), JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60, // CDN copy of the data file refreshes within a minute
  });
}

// For public GET endpoints: let Vercel's edge cache the response briefly so most
// page views never reach the function (or storage) at all. The admin passes
// ?fresh=1, which is a different cache key and is never cached.
function setPublicCache(req, res) {
  if (req.query && req.query.fresh) {
    res.setHeader('Cache-Control', 'no-store');
    return true; // caller should read fresh
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  return false;
}

module.exports = { readJson, writeJson, setPublicCache };
