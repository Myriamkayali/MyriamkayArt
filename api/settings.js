const { readJson, writeJson } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const SETTINGS_PATH = 'mk-data/settings.json';

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
      res.setHeader('Cache-Control', 'no-store');
      const auth = await verifyPin(req, pinFromRequest(req)); // business data: admin only
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const settings = await readJson(SETTINGS_PATH, { fresh: true });
      return res.status(200).json({ ...DEFAULT_SETTINGS, ...(settings || {}) });
    }

    if (req.method === 'POST') {
      const { settings, pin } = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, { pin }));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Invalid data — expected object' });

      const merged = { ...DEFAULT_SETTINGS, ...settings };
      await writeJson(SETTINGS_PATH, merged);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('settings handler error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
