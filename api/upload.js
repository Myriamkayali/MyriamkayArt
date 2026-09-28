const { put } = require('@vercel/blob');
const { readJson } = require('../lib/blob');

const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

async function bufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only the admin may upload: otherwise anyone could put files in the store.
  try {
    const config = await readJson(CONFIG_PATH, { fresh: true });
    const validPin = config?.pin || DEFAULT_PIN;
    if (req.headers['x-admin-pin'] !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
  } catch (e) {
    console.error('Upload auth error:', e);
    return res.status(503).json({ error: 'Storage is unavailable right now. Please try again later.' });
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
