const { readJson, writeJson, setPublicCache } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

// The list of painting collections (the public Collection tabs and the admin's
// "Collections" checkboxes), in display order. Public GET, PIN-protected POST.
const COLLECTIONS_PATH = 'mk-data/collections.json';

// Used until the admin saves a list for the first time.
const DEFAULT_COLLECTIONS = ['Beirut Diaries', 'On the Line', 'Mixed Arts', 'Landscape & Abstract', 'Commission', 'Home Premiere'];

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

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = String(item || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.length <= 30 ? out : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const fresh = setPublicCache(req, res); // admin passes ?fresh=1
      const list = await readJson(COLLECTIONS_PATH, { fresh });
      return res.status(200).json(Array.isArray(list) ? list : DEFAULT_COLLECTIONS);
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, body));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const list = cleanList(body.collections);
      if (!list) return res.status(400).json({ error: 'Invalid list of collections.' });
      await writeJson(COLLECTIONS_PATH, list);
      return res.status(200).json({ ok: true, collections: list });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('collections handler error:', e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
