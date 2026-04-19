const { put } = require('@vercel/blob');
const multiparty = require('multiparty');
const fs = require('fs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = new multiparty.Form();

  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });

  const file = files?.file?.[0];
  if (!file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const stream = fs.createReadStream(file.path);
  const blob = await put(file.originalFilename || 'upload', stream, {
    access: 'public',
    contentType: file.headers['content-type'],
  });

  fs.unlink(file.path, () => {});

  return res.status(200).json({ url: blob.url });
}
