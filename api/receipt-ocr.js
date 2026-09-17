const { list } = require('@vercel/blob');
const Anthropic = require('@anthropic-ai/sdk');

const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

// Costs real money per call (Claude API, billed to your own ANTHROPIC_API_KEY) —
// see CLAUDE.md for setup. Not part of any free tier.
const MODEL = 'claude-opus-5';

async function readBlob(path) {
  try {
    const { blobs } = await list({ prefix: path });
    const blob = blobs.find(b => b.pathname === path);
    if (!blob) return null;
    const res = await fetch(blob.url + '?t=' + Date.now());
    return await res.json();
  } catch {
    return null;
  }
}

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

const RECEIPT_TOOL = {
  name: 'record_receipt_items',
  description: 'Record the line items, vendor, and date extracted from a photographed or scanned receipt/invoice for art supplies.',
  input_schema: {
    type: 'object',
    properties: {
      vendor: { type: 'string', description: 'Store or supplier name, if visible on the receipt. Empty string if not visible.' },
      date: { type: 'string', description: 'Purchase date in YYYY-MM-DD format, if visible. Empty string if not visible.' },
      items: {
        type: 'array',
        description: 'Every distinct line item on the receipt.',
        items: {
          type: 'object',
          properties: {
            itemName: { type: 'string', description: 'Name/description of the purchased item.' },
            quantity: { type: 'number', description: 'Quantity purchased. Default to 1 if not shown.' },
            unitPrice: { type: 'number', description: 'Price per unit. If only a line total is shown, set this equal to the line total when quantity is 1, otherwise estimate as total / quantity.' },
            total: { type: 'number', description: 'Line total for this item (quantity × unit price), as printed on the receipt.' },
          },
          required: ['itemName', 'total'],
        },
      },
    },
    required: ['items'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mediaType, pin } = await parseBody(req);

    const config   = await readBlob(CONFIG_PATH);
    const validPin = config?.pin || DEFAULT_PIN;
    if (!pin) return res.status(401).json({ error: 'PIN missing' });
    if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });

    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(200).json({
        configured: false,
        error: 'Receipt scanning is not set up yet. Add ANTHROPIC_API_KEY in your Vercel project settings.',
      });
    }

    // Accept either a raw base64 string or a full data: URL.
    let data = imageBase64;
    let detectedType = mediaType;
    const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(imageBase64);
    if (dataUrlMatch) {
      detectedType = detectedType || dataUrlMatch[1];
      data = dataUrlMatch[2];
    }
    const finalMediaType = detectedType || 'image/jpeg';

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      tools: [RECEIPT_TOOL],
      tool_choice: { type: 'tool', name: 'record_receipt_items' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: finalMediaType, data } },
          {
            type: 'text',
            text: 'This is a photo or scan of a receipt or invoice for art supplies. Extract every line item using the record_receipt_items tool — item name, quantity, unit price, and line total for each. Also capture the vendor name and purchase date if visible. If a value truly is not visible or printed, leave it blank rather than guessing.',
          },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(200).json({ configured: true, error: 'The model declined to process this image.' });
    }

    const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'record_receipt_items');
    if (!toolUse) {
      return res.status(200).json({ configured: true, error: 'Could not extract line items from this image. Try a clearer photo.' });
    }

    const result = toolUse.input || {};
    return res.status(200).json({
      configured: true,
      vendor: result.vendor || '',
      date: result.date || '',
      items: Array.isArray(result.items) ? result.items : [],
    });
  } catch (e) {
    console.error('receipt-ocr handler error:', e);
    return res.status(200).json({ configured: true, error: e.message || 'Failed to process receipt.' });
  }
};
