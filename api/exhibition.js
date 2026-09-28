const { readJson, writeJson, setPublicCache } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const EXHIBITION_PATH = 'mk-data/exhibition.json';

const DEFAULT_EXHIBITION = {
  title: 'A Taste of Home',
  subtitle: 'Exhibition, Dubai, 2025',
  description: 'A selection of works exploring memory, food, and the quiet persistence of everyday objects.',
  images: [],
  pressImageUrl: 'https://eahxvq5wimrwyuwv.public.blob.vercel-storage.com/dubai-exhibit3-jzKsshrDr0JuPJxKbJVufD53hmM31q.jpg',
  pressTitle: 'Myriam Kayali Paints a Love Letter to Beirut',
  pressSubtitle: 'Through colour, memory and emotion, the artist captures the city that continues to shape her.',
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
      const fresh = setPublicCache(req, res); // public page views hit the edge cache; admin passes ?fresh=1
      let exhibition;
      try {
        exhibition = await readJson(EXHIBITION_PATH, { fresh });
      } catch (e) {
        // Home page still renders the default exhibition text if storage is unavailable.
        console.error('exhibition read error:', e);
        res.setHeader('Cache-Control', 'no-store');
      }
      return res.status(200).json(exhibition || DEFAULT_EXHIBITION);
    }

    if (req.method === 'POST') {
      const { data, pin } = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, { pin }));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data — expected object' });

      await writeJson(EXHIBITION_PATH, data);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('exhibition handler error:', e);
    res.setHeader('Cache-Control', 'no-store'); // never let the edge cache an error
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
