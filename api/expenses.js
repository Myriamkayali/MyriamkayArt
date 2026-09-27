const { readJson, writeJson } = require('../lib/blob');

const EXPENSES_PATH = 'mk-data/expenses.json';
const CONFIG_PATH   = 'mk-data/config.json';
const DEFAULT_PIN   = '1234';

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
      const expenses = await readJson(EXPENSES_PATH, { fresh: true });
      return res.status(200).json(expenses || []);
    }

    if (req.method === 'POST') {
      const { expenses, pin } = await parseBody(req);
      const config   = await readJson(CONFIG_PATH, { fresh: true });
      const validPin = config?.pin || DEFAULT_PIN;

      if (!pin) return res.status(401).json({ error: 'PIN missing' });
      if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
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
