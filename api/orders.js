const { readJson, writeJson } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');

const ORDERS_PATH = 'mk-data/orders.json';
const PRINTS_PATH = 'mk-data/prints.json';

// Automatic order emails (alert to Myriam + client confirmation) are OFF for now:
// orders are followed up on WhatsApp instead. To turn them back on, finish the
// Resend setup (see CLAUDE.md) and set ORDER_EMAILS_ENABLED=true in Vercel.
const ORDER_EMAILS_ENABLED = process.env.ORDER_EMAILS_ENABLED === 'true';

const SIZE_DIMENSIONS = { A1: '60×85cm', A2: '42×60cm', A3: '30×42cm', A4: '21×30cm' };
function sizeLabel(size) {
  return SIZE_DIMENSIONS[size] ? `${size} (${SIZE_DIMENSIONS[size]})` : size;
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
    ? `Quantity: ${order.quantity} × ${fmtMoney(order.price)}. Total: ${fmtMoney(order.price * order.quantity)}`
    : `Quantity: ${order.quantity}, price to be confirmed`;
  return `<p><strong>${order.printTitle}</strong>${order.printSize ? ` · ${sizeLabel(order.printSize)}` : ''}<br>${priceLine}</p>`;
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
      <p>${order.shippingBuilding ? order.shippingBuilding + '<br>' : ''}${order.shippingStreet}${order.shippingApartment ? ', ' + order.shippingApartment : ''}<br>${order.shippingCity}, ${order.shippingCountry} ${order.shippingPostalCode}</p>
      <p style="color:#999;font-size:12px">Order ${order.id}, ${order.createdAt}</p>
    </div>`;
}

function clientConfirmationEmailHtml(order) {
  const firstName = (order.clientName || '').split(' ')[0] || 'there';
  return `
    <div style="font-family:Georgia,serif;color:#1E0F07;max-width:480px;line-height:1.6">
      <p>Hi ${firstName},</p>
      <p>Thank you so much, your order has been received!</p>
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
      const pin = pinFromRequest(req); // header, never the URL
      const auth = await verifyPin(req, pin);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      res.setHeader('Cache-Control', 'no-store');
      const orders = await readJson(ORDERS_PATH, { fresh: true });
      return res.status(200).json(orders || []);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = await parseBody(req);

    // ── Public: create a new order. No PIN — customers don't have one. ──
    if (body.action === 'create') {
      const {
        printId, size, clientName, clientEmail, clientPhone,
        shippingBuilding, shippingStreet, shippingApartment, shippingCity, shippingCountry, shippingPostalCode, quantity,
      } = body;

      if (!printId || !size || !clientName || !clientEmail || !clientPhone || !shippingStreet || !shippingCity || !shippingCountry || !shippingPostalCode) {
        return res.status(400).json({ error: 'Please fill in every field.' });
      }
      if (!isValidEmail(clientEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      const qty = Math.max(1, parseInt(quantity) || 1);

      const prints = (await readJson(PRINTS_PATH, { fresh: true })) || [];
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
        price: Number(sizeOption.display_price) || 0, // authoritative — never trust a client-submitted price. display_price is what the client is actually charged (base_price + conversion-cost markup); base_price is admin-only, for margin reporting.
        quantity: qty,
        clientName: String(clientName).trim(),
        clientEmail: String(clientEmail).trim(),
        clientPhone: String(clientPhone).trim(),
        shippingBuilding: String(shippingBuilding || '').trim(),
        shippingStreet: String(shippingStreet).trim(),
        shippingApartment: String(shippingApartment || '').trim(),
        shippingCity: String(shippingCity).trim(),
        shippingCountry: String(shippingCountry).trim(),
        shippingPostalCode: String(shippingPostalCode).trim(),
        paymentLink: '',
        paymentStatus: 'New',
      };

      const orders = (await readJson(ORDERS_PATH, { fresh: true })) || [];
      orders.unshift(order);
      await writeJson(ORDERS_PATH, orders);

      // Order is already saved at this point — email failures below must never fail the request.
      const emailResults = { notifySent: false, confirmationSent: false, emailError: null };
      if (ORDER_EMAILS_ENABLED) try {
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
    const auth = await verifyPin(req, pinFromRequest(req, body));
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const orders = (await readJson(ORDERS_PATH, { fresh: true })) || [];

    if (body.action === 'update') {
      const idx = orders.findIndex(o => o.id === body.orderId);
      if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
      const allowed = ['paymentStatus', 'paymentLink'];
      allowed.forEach(f => {
        if (body.patch && body.patch[f] !== undefined) orders[idx][f] = body.patch[f];
      });
      await writeJson(ORDERS_PATH, orders);
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'send-payment-link') {
      const idx = orders.findIndex(o => o.id === body.orderId);
      if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
      const order = orders[idx];
      if (!order.paymentLink) return res.status(400).json({ error: 'Add a payment link before sending.' });

      await sendEmail({ to: order.clientEmail, subject: 'Payment link for your order', html: paymentLinkEmailHtml(order) });
      order.paymentStatus = 'Link Sent';
      await writeJson(ORDERS_PATH, orders);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('orders handler error:', e);
    if (e.storageUnavailable) {
      return res.status(503).json({ error: "Orders can't be placed right now. Please try again in a little while, or message me on Instagram @myriamkay.art." });
    }
    const status = e.missingConfig ? 200 : 500;
    return res.status(status).json({ error: e.message || 'Internal server error', configured: !e.missingConfig });
  }
};
