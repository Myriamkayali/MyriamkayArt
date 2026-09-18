const { put, list } = require('@vercel/blob');

const ORDERS_PATH = 'mk-data/orders.json';
const PRINTS_PATH = 'mk-data/prints.json';
const CONFIG_PATH = 'mk-data/config.json';
const DEFAULT_PIN = '1234';

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

async function writeBlob(path, data) {
  await put(path, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function fmtMoney(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString();
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY is not configured.');
    err.missingConfig = true;
    throw err;
  }
  const from = process.env.RESEND_FROM_EMAIL || 'Myriam Kayali Art <orders@myriamkay.art>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Email send failed (${res.status})`);
  }
  return res.json();
}

function orderLinesHtml(order) {
  const priceLine = order.price > 0
    ? `Quantity: ${order.quantity} × ${fmtMoney(order.price)} — Total: ${fmtMoney(order.price * order.quantity)}`
    : `Quantity: ${order.quantity} — price to be confirmed`;
  return `<p><strong>${order.printTitle}</strong>${order.printSize ? ` — ${order.printSize}` : ''}<br>${priceLine}</p>`;
}

function notifyMyriamEmailHtml(order) {
  return `
    <div style="font-family:Georgia,serif;color:#1E0F07;max-width:480px">
      <h2 style="font-weight:400">New Print Order</h2>
      ${orderLinesHtml(order)}
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p><strong>${order.clientName}</strong><br>
      ${order.clientEmail}<br>
      ${order.clientPhone}</p>
      <p>${order.shippingStreet}<br>${order.shippingCity}, ${order.shippingCountry} ${order.shippingPostalCode}</p>
      <p style="color:#999;font-size:12px">Order ${order.id} — ${order.createdAt}</p>
    </div>`;
}

function clientConfirmationEmailHtml(order) {
  const firstName = (order.clientName || '').split(' ')[0] || 'there';
  return `
    <div style="font-family:Georgia,serif;color:#1E0F07;max-width:480px;line-height:1.6">
      <p>Hi ${firstName},</p>
      <p>Thank you so much — your order has been received!</p>
      ${orderLinesHtml(order)}
      <p>I'll be in touch directly with payment instructions shortly. No need to do anything else for now.</p>
      <p>Thank you for supporting my work!<br>Myriam</p>
    </div>`;
}

function paymentLinkEmailHtml(order) {
  const firstName = (order.clientName || '').split(' ')[0] || 'there';
  return `
    <div style="font-family:Georgia,serif;color:#1E0F07;max-width:480px;line-height:1.6">
      <p>Hi ${firstName},</p>
      <p>Here's the payment link for your order:</p>
      ${orderLinesHtml(order)}
      <p>Please complete payment via the link below. Once received, your print will go into production.</p>
      <p><a href="${order.paymentLink}" style="color:#B85C38">${order.paymentLink}</a></p>
      <p>Thank you!<br>Myriam</p>
    </div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const pin = req.query?.pin;
      const config = await readBlob(CONFIG_PATH);
      const validPin = config?.pin || DEFAULT_PIN;
      if (!pin) return res.status(401).json({ error: 'PIN missing' });
      if (pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });
      const orders = await readBlob(ORDERS_PATH);
      return res.status(200).json(orders || []);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = await parseBody(req);

    // ── Public: create a new order. No PIN — customers don't have one. ──
    if (body.action === 'create') {
      const {
        printId, size, clientName, clientEmail, clientPhone,
        shippingStreet, shippingCity, shippingCountry, shippingPostalCode, quantity,
      } = body;

      if (!printId || !size || !clientName || !clientEmail || !clientPhone || !shippingStreet || !shippingCity || !shippingCountry || !shippingPostalCode) {
        return res.status(400).json({ error: 'Please fill in every field.' });
      }
      if (!isValidEmail(clientEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      const qty = Math.max(1, parseInt(quantity) || 1);

      const prints = (await readBlob(PRINTS_PATH)) || [];
      const print = prints.find(p => p.id === printId);
      if (!print) return res.status(404).json({ error: 'That print could not be found.' });

      const sizeOption = (print.sizeOptions || []).find(o => o.size === size) || { size };
      const editionSize = Number(sizeOption.editionSize) || 0;
      const numberSold = Number(sizeOption.numberSold) || 0;
      if (editionSize > 0 && (editionSize - numberSold) <= 0) {
        return res.status(400).json({ error: 'That size is sold out.' });
      }

      const order = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        createdAt: new Date().toISOString(),
        printId: print.id,
        printTitle: print.title,
        printSize: size,
        price: Number(sizeOption.price) || 0, // authoritative — never trust a client-submitted price
        quantity: qty,
        clientName: String(clientName).trim(),
        clientEmail: String(clientEmail).trim(),
        clientPhone: String(clientPhone).trim(),
        shippingStreet: String(shippingStreet).trim(),
        shippingCity: String(shippingCity).trim(),
        shippingCountry: String(shippingCountry).trim(),
        shippingPostalCode: String(shippingPostalCode).trim(),
        paymentLink: '',
        paymentStatus: 'New',
      };

      const orders = (await readBlob(ORDERS_PATH)) || [];
      orders.unshift(order);
      await writeBlob(ORDERS_PATH, orders);

      // Order is already saved at this point — email failures below must never fail the request.
      const emailResults = { notifySent: false, confirmationSent: false, emailError: null };
      try {
        const notifyTo = process.env.NOTIFY_EMAIL;
        if (notifyTo) {
          await sendEmail({ to: notifyTo, subject: `New order: ${order.printTitle}`, html: notifyMyriamEmailHtml(order) });
          emailResults.notifySent = true;
        }
        await sendEmail({ to: order.clientEmail, subject: 'Your order has been received', html: clientConfirmationEmailHtml(order) });
        emailResults.confirmationSent = true;
      } catch (e) {
        console.error('order email error:', e);
        emailResults.emailError = e.message;
      }

      return res.status(200).json({ ok: true, orderId: order.id, ...emailResults });
    }

    // ── Everything below is admin-only ──
    const config = await readBlob(CONFIG_PATH);
    const validPin = config?.pin || DEFAULT_PIN;
    if (!body.pin) return res.status(401).json({ error: 'PIN missing' });
    if (body.pin !== validPin) return res.status(401).json({ error: 'Invalid PIN' });

    const orders = (await readBlob(ORDERS_PATH)) || [];

    if (body.action === 'update') {
      const idx = orders.findIndex(o => o.id === body.orderId);
      if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
      const allowed = ['paymentStatus', 'paymentLink'];
      allowed.forEach(f => {
        if (body.patch && body.patch[f] !== undefined) orders[idx][f] = body.patch[f];
      });
      await writeBlob(ORDERS_PATH, orders);
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'send-payment-link') {
      const idx = orders.findIndex(o => o.id === body.orderId);
      if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
      const order = orders[idx];
      if (!order.paymentLink) return res.status(400).json({ error: 'Add a payment link before sending.' });

      await sendEmail({ to: order.clientEmail, subject: 'Payment link for your order', html: paymentLinkEmailHtml(order) });
      order.paymentStatus = 'Link Sent';
      await writeBlob(ORDERS_PATH, orders);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('orders handler error:', e);
    const status = e.missingConfig ? 200 : 500;
    return res.status(status).json({ error: e.message || 'Internal server error', configured: !e.missingConfig });
  }
};
