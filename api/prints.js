const { readJson, writeJson, setPublicCache } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const PRINTS_PATH = 'mk-data/prints.json';

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

// Only what the public site shows: the charged price (display_price) and edition
// counts for sold-out status. base_price and every cost field stay admin-only.
function publicPrint(pr) {
  return {
    id: pr.id,
    title: pr.title,
    description: pr.description,
    imageData: pr.imageData,
    status: pr.status,
    sizeOptions: (pr.sizeOptions || []).map(o => ({
      size: o.size,
      display_price: o.display_price,
      editionSize: o.editionSize,
      numberSold: o.numberSold,
    })),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Admin: ?admin=1 plus the PIN header gets the full records (base price, costs),
      // fresh and never cached. Everyone else gets public fields only, edge-cached.
      if (req.query && req.query.admin) {
        res.setHeader('Cache-Control', 'no-store');
        const auth = await verifyPin(req, pinFromRequest(req));
        if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
        return res.status(200).json((await readJson(PRINTS_PATH, { fresh: true })) || []);
      }
      const fresh = setPublicCache(req, res);
      const prints = (await readJson(PRINTS_PATH, { fresh }) || []).filter(pr => pr && pr.status !== 'Private').map(publicPrint);
      return res.status(200).json(prints || []);
    }

    if (req.method === 'POST') {
      const { prints, pin } = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, { pin }));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
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
