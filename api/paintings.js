const { readJson, writeJson, setPublicCache } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const PAINTINGS_PATH = 'mk-data/paintings.json';

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

// Only what the public site shows. Cost estimates, revenue and sold dates stay
// admin-only, and a price marked hidden is not sent at all.
function publicPainting(p) {
  const { costEstimate, revenueReceived, soldDate, ...rest } = p || {};
  if (rest.hidePrice) rest.price = '';
  return rest;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Admin: ?admin=1 plus the PIN header gets the full records (costs, revenue),
      // fresh and never cached. Everyone else gets public fields only, edge-cached.
      if (req.query && req.query.admin) {
        res.setHeader('Cache-Control', 'no-store');
        const auth = await verifyPin(req, pinFromRequest(req));
        if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
        return res.status(200).json((await readJson(PAINTINGS_PATH, { fresh: true })) || []);
      }
      const fresh = setPublicCache(req, res);
      const paintings = (await readJson(PAINTINGS_PATH, { fresh }) || []).filter(p => p && p.status !== 'Private').map(publicPainting);
      return res.status(200).json(paintings || []);
    }

    if (req.method === 'POST') {
      const { paintings, pin } = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, { pin }));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!Array.isArray(paintings)) return res.status(400).json({ error: 'Invalid data — expected array' });

      await writeJson(PAINTINGS_PATH, paintings);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('paintings handler error:', e);
    res.setHeader('Cache-Control', 'no-store'); // never let the edge cache an error
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
