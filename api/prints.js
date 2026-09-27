const { readJson, writeJson, setPublicCache } = require('../lib/blob');

const PRINTS_PATH = 'mk-data/prints.json';
const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

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
      const fresh = setPublicCache(req, res); // public page views hit the edge cache; admin passes ?fresh=1
      const prints = await readJson(PRINTS_PATH, { fresh });
      return res.status(200).json(prints || []);
    }

    if (req.method === 'POST') {
      const { prints, pin } = await parseBody(req);
      const config   = await readJson(CONFIG_PATH, { fresh: true });
      const validPin = config?.pin || DEFAULT_PIN;

      if (!pin) return res.status(401).json({ error: 'PIN missing' });
      if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
      if (!Array.isArray(prints)) return res.status(400).json({ error: 'Invalid data — expected array' });

      await writeJson(PRINTS_PATH, prints);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('prints handler error:', e);
    res.setHeader('Cache-Control', 'no-store'); // never let the edge cache an error
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
