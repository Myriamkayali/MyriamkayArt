const { put, list } = require('@vercel/blob');

const SETTINGS_PATH = 'mk-data/settings.json';
const CONFIG_PATH   = 'mk-data/config.json';
const DEFAULT_PIN   = '1234';

const DEFAULT_SETTINGS = {
  currency: 'USD',
  targetProfitMargin: 50,       // %
  minAcceptableMargin: 30,      // %
  hourlyRate: 20,                // per hour, artist labor
  defaultPackagingCostOriginals: 15,
  defaultPackagingCostPrints: 5,
  defaultShippingCost: 25,
  defaultCertificateCost: 2,
  defaultWastagePercent: 10,    // % added to material cost for waste/offcuts
  defaultMarkupMultiplier: 2,   // simple markup-on-cost fallback logic
};

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
    allowOverwrite: true,
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

  try {
    if (req.method === 'GET') {
      const settings = await readBlob(SETTINGS_PATH);
      return res.status(200).json({ ...DEFAULT_SETTINGS, ...(settings || {}) });
    }

    if (req.method === 'POST') {
      const { settings, pin } = await parseBody(req);
      const config   = await readBlob(CONFIG_PATH);
      const validPin = config?.pin || DEFAULT_PIN;

      if (!pin) return res.status(401).json({ error: 'PIN missing' });
      if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
      if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Invalid data — expected object' });

      const merged = { ...DEFAULT_SETTINGS, ...settings };
      await writeBlob(SETTINGS_PATH, merged);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('settings handler error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
