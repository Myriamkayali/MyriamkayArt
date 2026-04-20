const { put } = require('@vercel/blob');

async function bufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const filename    = decodeURIComponent(req.headers['x-filename'] || 'upload');
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  try {
    const buffer = await bufferBody(req);

    if (buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received.' });
    }

    const blob = await put(filename, buffer, { access: 'public', contentType, addRandomSuffix: true });
    return res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
};
