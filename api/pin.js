const { readJson, writeJson } = require('../lib/blob');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, pin, currentPin, newPin } = await parseBody(req);
  let config;
  try {
    config = await readJson(CONFIG_PATH, { fresh: true });
  } catch (e) {
    // Never fall back to the default PIN just because storage couldn't be read.
    console.error('pin handler error:', e);
    return res.status(503).json({ error: 'Storage is unavailable right now. Please try again later.' });
  }
  const validPin = config?.pin || DEFAULT_PIN;

  if (action === 'verify') {
    return res.status(200).json({ valid: pin === validPin });
  }

  if (action === 'change') {
    if (currentPin !== validPin) return res.status(401).json({ error: 'Current PIN is incorrect.' });
    if (!newPin || !/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    try {
      await writeJson(CONFIG_PATH, { ...(config || {}), pin: newPin });
    } catch (e) {
      console.error('pin handler error:', e);
      return res.status(503).json({ error: 'Could not save the new PIN. Please try again later.' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
