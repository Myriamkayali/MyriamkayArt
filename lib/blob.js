const { put } = require('@vercel/blob');

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

// Returns the parsed JSON, or null if the file doesn't exist yet.
// Throws on any other failure (store paused, network error, bad JSON) so a
// failed read is never mistaken for "empty" and then written back over real data.
//
// fresh: true  -> skip the CDN cache. Use it before any read-modify-write and
//                 for the admin, so edits always start from the latest data.
// fresh: false -> allow the CDN copy (at most ~60s stale). Use it for public reads.
async function readJson(path, { fresh = false } = {}) {
  const url = `${blobBaseUrl()}/${path}` + (fresh ? `?t=${Date.now()}` : '');
  const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Storage read failed for ${path} (${res.status}${text ? `: ${text.slice(0, 80)}` : ''})`);
    err.storageUnavailable = true;
    throw err;
  }
  return res.json();
}

async function writeJson(path, data) {
  await put(path, JSON.stringify(data), {
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
