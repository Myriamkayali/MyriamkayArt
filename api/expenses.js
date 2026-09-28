const { readJson, writeJson } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const EXPENSES_PATH = 'mk-data/expenses.json';

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
      const expenses = await readJson(EXPENSES_PATH, { fresh: true });
      return res.status(200).json(expenses || []);
    }

    if (req.method === 'POST') {
      const { expenses, pin } = await parseBody(req);
      const auth = await verifyPin(req, pinFromRequest(req, { pin }));
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!Array.isArray(expenses)) return res.status(400).json({ error: 'Invalid data — expected array' });

      await writeJson(EXPENSES_PATH, expenses);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('expenses handler error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
};
