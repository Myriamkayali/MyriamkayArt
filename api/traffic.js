const { list } = require('@vercel/blob');

const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

async function readBlob(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const blob = blobs.find(b => b.pathname === path);
    if (!blob) return null;
    const res = await fetch(blob.url + '?t=' + Date.now()); // bypass CDN cache
    return await res.json();
  } catch {
    return null;
  }
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

async function vercelFetch(path, params) {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    const err = new Error('MISSING_CONFIG');
    err.missingConfig = true;
    throw err;
  }

  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set('projectId', projectId);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error)) || `Vercel API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const pin = req.query?.pin;
    const config = await readBlob(CONFIG_PATH);
    const validPin = config?.pin || DEFAULT_PIN;
    if (!pin) return res.status(401).json({ error: 'PIN missing' });
    if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const trendStart = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1); // ~24 months back

    const [allTime, thisYear, thisMonth, trend] = await Promise.all([
      vercelFetch('/v1/query/web-analytics/visits/count', {}),
      vercelFetch('/v1/query/web-analytics/visits/count', { since: isoDate(startOfYear), until: isoDate(now) }),
      vercelFetch('/v1/query/web-analytics/visits/count', { since: isoDate(startOfMonth), until: isoDate(now) }),
      vercelFetch('/v1/query/web-analytics/visits/aggregate', { since: isoDate(trendStart), until: isoDate(now), by: 'month' }),
    ]);

    const byMonth = (trend.data || []).map(row => ({
      month: row.timestamp,
      pageviews: row.pageviews || 0,
      visitors: row.visitors || 0,
    }));

    return res.status(200).json({
      configured: true,
      allTime: allTime.data || { pageviews: 0, visitors: 0 },
      thisYear: thisYear.data || { pageviews: 0, visitors: 0 },
      thisMonth: thisMonth.data || { pageviews: 0, visitors: 0 },
      byMonth,
    });
  } catch (e) {
    if (e.missingConfig) {
      return res.status(200).json({
        configured: false,
        error: 'Traffic analytics is not set up yet.',
      });
    }
    console.error('traffic handler error:', e);
    return res.status(200).json({ configured: false, error: e.message || 'Failed to load traffic analytics.' });
  }
};
