const { put, list } = require('@vercel/blob');

const PAINTINGS_PATH = 'mk-data/paintings.json';
const CONFIG_PATH    = 'mk-data/config.json';
const DEFAULT_PIN    = '1234';

async function readBlob(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const blob = blobs.find(b => b.pathname === path);
    if (!blob) return null;
    const res = await fetch(blob.url + '?t=' + Date.now()); // bypass CDN cache
    return await res.json();
  } catch {
    return null;
  }
}

async function writeBlob(path, data) {
  await put(path, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

async function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const paintings = await readBlob(PAINTINGS_PATH);
    return res.status(200).json(paintings || []);
  }

  if (req.method === 'POST') {
    const { paintings, pin } = await parseBody(req);
    const config   = await readBlob(CONFIG_PATH);
    const validPin = config?.pin || DEFAULT_PIN;

    if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
    if (!Array.isArray(paintings)) return res.status(400).json({ error: 'Invalid data' });

    await writeBlob(PAINTINGS_PATH, paintings);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
