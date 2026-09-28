const { writeJson } = require('../lib/blob');
const { verifyPin } = require('../lib/auth');

const CONFIG_PATH = 'mk-data/config.json';

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
  res.setHeader('Cache-Control', 'no-store');

  const { action, pin, currentPin, newPin } = await parseBody(req);

  try {
    if (action === 'verify') {
      const auth = await verifyPin(req, pin);
      if (auth.status === 429) return res.status(429).json({ valid: false, error: auth.error });
      return res.status(200).json({ valid: auth.ok });
    }

    if (action === 'change') {
      const auth = await verifyPin(req, currentPin);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.status === 429 ? auth.error : 'Current PIN is incorrect.' });
      if (!newPin || !/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
      await writeJson(CONFIG_PATH, { ...(auth.config || {}), pin: newPin });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    // Never fall back to the default PIN just because storage couldn't be read.
    console.error('pin handler error:', e);
    return res.status(503).json({ error: 'Storage is unavailable right now. Please try again later.' });
  }
};
