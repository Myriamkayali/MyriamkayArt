const { put, list } = require('@vercel/blob');

const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

async function readBlob(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const blob = blobs.find(b => b.pathname === path);
    if (!blob) return null;
    const res = await fetch(blob.url + '?t=' + Date.now());
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, pin, currentPin, newPin } = await parseBody(req);
  const config   = await readBlob(CONFIG_PATH);
  const validPin = config?.pin || DEFAULT_PIN;

  if (action === 'verify') {
    return res.status(200).json({ valid: pin === validPin });
  }

  if (action === 'change') {
    if (currentPin !== validPin) return res.status(401).json({ error: 'Current PIN is incorrect.' });
    if (!newPin || !/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    await writeBlob(CONFIG_PATH, { ...(config || {}), pin: newPin });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
