const crypto = require('crypto');
const { readJson, writeJson } = require('./blob');

// Admin PIN checks for every /api function, with a lockout so the 4-digit PIN
// can't be brute-forced (there are only 10,000 possibilities).
//
// Wrong attempts are counted per IP in memory. After FAIL_LIMIT wrong attempts
// that IP is locked out for LOCK_MINUTES, and the lock is saved to private
// storage (mk-data/auth.json) so it applies on every server instance. Storage is
// only written when a lock starts, so an attacker can't use failed attempts to
// run up storage operations.

const CONFIG_PATH = 'mk-data/config.json';
const AUTH_PATH = 'mk-data/auth.json';
const DEFAULT_PIN = '1234';
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MINUTES = 15;

const failures = new Map(); // ip -> { count, first }

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  return fwd.split(',')[0].trim() || String(req.headers['x-real-ip'] || '') || 'unknown';
}

function samePin(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The PIN an admin request sent: the x-admin-pin header (preferred, never lands in
// URLs or logs), or `pin` in the JSON body for the existing POST endpoints.
function pinFromRequest(req, body) {
  return req.headers['x-admin-pin'] || (body && body.pin) || '';
}

// Returns { ok: true, config } or { ok: false, status, error }.
async function verifyPin(req, pin) {
  const ip = clientIp(req);
  const now = Date.now();

  const auth = (await readJson(AUTH_PATH)) || {};
  const locks = auth.locks || {};
  if (locks[ip] && locks[ip] > now) {
    const mins = Math.ceil((locks[ip] - now) / 60000);
    return { ok: false, status: 429, error: `Too many wrong PIN attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }

  const config = await readJson(CONFIG_PATH);
  const validPin = (config && config.pin) || DEFAULT_PIN;
  if (pin && samePin(pin, validPin)) {
    failures.delete(ip);
    return { ok: true, config };
  }

  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) f = { count: 0, first: now };
  f.count += 1;
  failures.set(ip, f);

  if (f.count >= FAIL_LIMIT) {
    failures.delete(ip);
    const fresh = {};
    for (const [k, until] of Object.entries(locks)) if (until > now) fresh[k] = until; // drop expired locks
    fresh[ip] = now + LOCK_MINUTES * 60000;
    await writeJson(AUTH_PATH, { ...auth, locks: fresh });
    return { ok: false, status: 429, error: `Too many wrong PIN attempts. Try again in ${LOCK_MINUTES} minutes.` };
  }

  await sleep(400); // slows down scripted guessing
  return { ok: false, status: 401, error: pin ? 'Invalid PIN' : 'PIN missing' };
}

module.exports = { verifyPin, pinFromRequest };
