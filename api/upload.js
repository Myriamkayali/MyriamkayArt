const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const filename = decodeURIComponent(req.headers['x-filename'] || 'upload');
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  try {
    const blob = await put(filename, req, { access: 'public', contentType });
    return res.status(200).json({ url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
