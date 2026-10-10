const { readJson, updateJson } = require('../lib/blob');
const { verifyPin, pinFromRequest } = require('../lib/auth');
const {
  EDITION_SIZES, SOLD_STATUSES, isLimitedEdition, reservationExpiry, holdsReservation,
  editionState, nextEditionNumbers, formatEditionNumber,
} = require('../lib/editions');

const ORDERS_PATH = 'mk-data/orders.json';
const PRINTS_PATH = 'mk-data/prints.json';

// Automatic order emails (alert to Myriam + client confirmation) are OFF for now:
// orders are followed up on WhatsApp instead. To turn them back on, finish the
// Resend setup (see CLAUDE.md) and set ORDER_EMAILS_ENABLED=true in Vercel.
const ORDER_EMAILS_ENABLED = process.env.ORDER_EMAILS_ENABLED === 'true';

const ORDER_STATUSES = ['New', 'Link Sent', 'Paid', 'Shipped', 'Completed', 'Cancelled'];

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

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { httpStatus: status }, extra);
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
  const editionLine = order.limitedEdition
    ? ((order.editionNumbers || []).length
      ? `<br>Edition no. ${order.editionNumbers.map(n => formatEditionNumber(n, order.editionTotal)).join(', ')}`
      : `<br>Limited edition of ${order.editionTotal}, signed and numbered`)
    : '';
  return `<p><strong>${order.printTitle}</strong>${order.printSize ? ` · ${sizeLabel(order.printSize)}` : ''}<br>${priceLine}${editionLine}</p>`;
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

// The print an order belongs to, falling back to what the order itself recorded
// in case the print was since deleted.
function printForOrder(prints, order) {
  return (prints || []).find(p => p.id === order.printId)
    || { id: order.printId, editionTotal: order.editionTotal };
}

// Start (or restart) an unpaid order's hold on its share of the edition.
function renewReservation(order, orders, print, now) {
  if (!holdsReservation(order, now)) {
    const state = editionState(print, orders, { now, excludeOrderId: order.id });
    const qty = Number(order.quantity) || 1;
    if (state.available < qty) {
      throw httpError(409, `This order's hold has expired and the edition no longer has room for it (${state.available} left).`);
    }
  }
  order.reservedUntil = reservationExpiry(now);
}

// Status changes for a limited edition order. Edition numbers are assigned on the
// move to Paid and are permanent: they're never taken back or reissued.
function applyEditionStatus(order, next, orders, print, now) {
  const hasNumbers = (order.editionNumbers || []).length > 0;
  if (order.paymentStatus === 'Cancelled') {
    throw httpError(400, 'This order was cancelled and its reservation released. Place a new order instead.');
  }
  if (next === 'Cancelled') {
    order.paymentStatus = 'Cancelled';
    order.cancelledAt = new Date(now).toISOString();
    return;
  }
  if (SOLD_STATUSES.includes(next)) {
    if (!hasNumbers) {
      const qty = Number(order.quantity) || 1;
      const state = editionState(print, orders, { now, excludeOrderId: order.id });
      const numbers = state.available >= qty ? nextEditionNumbers(state, qty) : null;
      if (!numbers) {
        throw httpError(409, `The edition is full, so this order can't be marked paid (${state.available} left). Its hold may have expired.`);
      }
      order.editionNumbers = numbers;
      order.paidAt = new Date(now).toISOString();
    }
    order.paymentStatus = next;
    return;
  }
  // Back to an unpaid status.
  if (hasNumbers) {
    throw httpError(400, 'This order already has its edition number, so it can\'t go back to unpaid. Cancel it instead if needed.');
  }
  renewReservation(order, orders, print, now);
  order.paymentStatus = next;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Public: how many prints are left in each limited edition. Counts only,
      // nothing about who ordered. Edge-cached briefly; orders are always checked
      // against live data when placed.
      if (req.query && req.query.availability) {
        const [prints, orders] = await Promise.all([readJson(PRINTS_PATH), readJson(ORDERS_PATH)]);
        const out = {};
        (prints || []).filter(p => p && p.status !== 'Private' && isLimitedEdition(p)).forEach(p => {
          const { total, available } = editionState(p, orders || []);
          out[p.id] = { total, available };
        });
        res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
        return res.status(200).json(out);
      }

      const pin = pinFromRequest(req); // header, never the URL
      const auth = await verifyPin(req, pin);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      res.setHeader('Cache-Control', 'no-store');
      const orders = await readJson(ORDERS_PATH, { fresh: true });
      return res.status(200).json(orders || []);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Cache-Control', 'no-store');

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
      const print = prints.find(p => p.id === printId && p.status !== 'Private');
      if (!print) return res.status(404).json({ error: 'That print could not be found.' });
      const limited = isLimitedEdition(print);

      const sizeOption = (print.sizeOptions || []).find(o => o.size === size) || { size };
      if (limited) {
        if (print.status === 'Sold Out') {
          return res.status(409).json({ error: 'This edition has sold out.', available: 0, soldOut: true });
        }
        if (!EDITION_SIZES.includes(size) || !(Number(sizeOption.display_price) > 0)) {
          return res.status(400).json({ error: 'That size isn\'t available for this print.' });
        }
      } else {
        const editionSize = Number(sizeOption.editionSize) || 0;
        const numberSold = Number(sizeOption.numberSold) || 0;
        if (editionSize > 0 && (editionSize - numberSold) <= 0) {
          return res.status(400).json({ error: 'That size is sold out.' });
        }
      }

      const now = Date.now();
      const order = {
        id: now.toString(36) + Math.random().toString(36).slice(2, 7),
        createdAt: new Date(now).toISOString(),
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
        ...(limited ? {
          limitedEdition: true,
          editionTotal: Number(print.editionTotal),
          editionNumbers: [], // assigned when the order is marked Paid
          reservedUntil: reservationExpiry(now),
        } : {}),
      };

      // Checked and saved in one conditional write, so two customers can never
      // both get the last print of an edition.
      const editionAvailable = await updateJson(ORDERS_PATH, current => {
        const orders = current || [];
        let left = null;
        if (limited) {
          const { available } = editionState(print, orders, { now });
          if (available < qty) {
            throw httpError(409, available > 0
              ? `Only ${available} ${available === 1 ? 'print is' : 'prints are'} left in this edition.`
              : 'This edition has just sold out.', { available });
          }
          left = available - qty;
        }
        return { data: [order, ...orders], result: left };
      });

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

      return res.status(200).json({
        ok: true, orderId: order.id, reservedUntil: order.reservedUntil || null,
        ...(limited ? { editionAvailable, editionTotal: order.editionTotal } : {}), ...emailResults,
      });
    }

    // ── Everything below is admin-only ──
    const auth = await verifyPin(req, pinFromRequest(req, body));
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    if (body.action === 'update') {
      const patch = body.patch || {};
      if (patch.paymentStatus !== undefined && !ORDER_STATUSES.includes(patch.paymentStatus)) {
        return res.status(400).json({ error: 'Unknown status.' });
      }
      let prints = null;
      const order = await updateJson(ORDERS_PATH, async current => {
        const orders = current || [];
        const idx = orders.findIndex(o => o.id === body.orderId);
        if (idx === -1) throw httpError(404, 'Order not found.');
        const order = { ...orders[idx] };
        const now = Date.now();

        if (patch.paymentLink !== undefined) order.paymentLink = String(patch.paymentLink);
        const statusChange = patch.paymentStatus !== undefined && patch.paymentStatus !== order.paymentStatus;
        if (order.limitedEdition && (statusChange || body.renewReservation)) {
          prints = prints || (await readJson(PRINTS_PATH, { fresh: true })) || [];
          const print = printForOrder(prints, order);
          if (statusChange) applyEditionStatus(order, patch.paymentStatus, orders, print, now);
          else if (order.paymentStatus === 'Cancelled' || (order.editionNumbers || []).length) {
            throw httpError(400, 'Only unpaid orders have a hold to extend.');
          } else renewReservation(order, orders, print, now);
        } else if (statusChange) {
          order.paymentStatus = patch.paymentStatus;
        }

        orders[idx] = order;
        return { data: orders, result: order };
      });
      return res.status(200).json({ ok: true, order });
    }

    if (body.action === 'send-payment-link') {
      const orders = (await readJson(ORDERS_PATH, { fresh: true })) || [];
      const order = orders.find(o => o.id === body.orderId);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!order.paymentLink) return res.status(400).json({ error: 'Add a payment link before sending.' });

      await sendEmail({ to: order.clientEmail, subject: 'Payment link for your order', html: paymentLinkEmailHtml(order) });

      // Sending the link restarts an unpaid limited edition order's hold.
      let prints = null;
      const updated = await updateJson(ORDERS_PATH, async current => {
        const orders = current || [];
        const idx = orders.findIndex(o => o.id === body.orderId);
        if (idx === -1) throw httpError(404, 'Order not found.');
        const o = { ...orders[idx] };
        const unpaid = o.paymentStatus === 'New' || o.paymentStatus === 'Link Sent';
        if (!unpaid) return { result: o }; // already paid or cancelled: leave the status alone
        if (o.limitedEdition) {
          prints = prints || (await readJson(PRINTS_PATH, { fresh: true })) || [];
          try { renewReservation(o, orders, printForOrder(prints, o), Date.now()); }
          catch (e) { console.error('hold not renewed:', e.message); } // email already went out; keep the old hold
        }
        o.paymentStatus = 'Link Sent';
        orders[idx] = o;
        return { data: orders, result: o };
      });
      return res.status(200).json({ ok: true, order: updated });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    if (!e.httpStatus) console.error('orders handler error:', e); // sold out etc. are expected, not errors
    if (e.httpStatus) {
      return res.status(e.httpStatus).json({ error: e.message, ...(e.available !== undefined ? { available: e.available, soldOut: e.available === 0 } : {}) });
    }
    if (e.storageUnavailable || e.storageBusy) {
      return res.status(503).json({ error: "Orders can't be placed right now. Please try again in a little while, or message me on Instagram @myriamkay.art." });
    }
    const status = e.missingConfig ? 200 : 500;
    return res.status(status).json({ error: e.message || 'Internal server error', configured: !e.missingConfig });
  }
};
