const { put, del } = require('@vercel/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');
const { readJson, blobBaseUrl } = require('../lib/blob');

async function bufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i;

// Every image URL the site still uses, so a delete can never break a page.
async function imagesInUse() {
  const [paintings, prints, exhibition] = await Promise.all([
    readJson('mk-data/paintings.json', { fresh: true }),
    readJson('mk-data/prints.json', { fresh: true }),
    readJson('mk-data/exhibition.json', { fresh: true }),
  ]);
  const used = new Set();
  const add = u => { if (typeof u === 'string' && u) used.add(u.split('?')[0]); };
  (paintings || []).forEach(p => { add(p.imageData); (p.additionalImages || []).forEach(add); });
  (prints || []).forEach(p => add(p.imageData));
  if (exhibition) { (exhibition.images || []).forEach(add); add(exhibition.pressImageUrl); }
  return used;
}

// Admin-only: remove old full-size image files once smaller copies have replaced
// them. Only image files in this store, never data files, and never an image that
// a painting, print or the exhibition still points to.
async function deleteImages(req, res) {
  let urls;
  try { urls = JSON.parse((await bufferBody(req)).toString() || '{}').urls; } catch { urls = null; }
  if (!Array.isArray(urls) || !urls.length || urls.length > 200) {
    return res.status(400).json({ error: 'Send a list of up to 200 image URLs.' });
  }
  const base = blobBaseUrl() + '/';
  const used = await imagesInUse();
  const deleted = [], skipped = [];
  for (const raw of urls) {
    const url = String(raw).split('?')[0];
    const path = url.startsWith(base) ? url.slice(base.length) : '';
    if (!path || path.startsWith('mk-') || !IMAGE_FILE.test(path)) skipped.push({ url, reason: 'not an image in this store' });
    else if (used.has(url)) skipped.push({ url, reason: 'still used on the site' });
    else deleted.push(url);
  }
  if (deleted.length) await del(deleted);
  return res.status(200).json({ ok: true, deleted, skipped });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only the admin may upload: otherwise anyone could put files in the store.
  try {
    const auth = await verifyPin(req, pinFromRequest(req));
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } catch (e) {
    console.error('Upload auth error:', e);
    return res.status(503).json({ error: 'Storage is unavailable right now. Please try again later.' });
  }

  if (req.headers['x-action'] === 'delete') {
    try { return await deleteImages(req, res); }
    catch (e) {
      console.error('Image delete error:', e);
      return res.status(500).json({ error: e.message || 'Delete failed' });
    }
  }

  const filename    = decodeURIComponent(req.headers['x-filename'] || 'upload');
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  try {
    const buffer = await bufferBody(req);

    if (buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received.' });
    }

    const blob = await put(filename, buffer, { access: 'public', contentType, addRandomSuffix: true });
    return res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
};
