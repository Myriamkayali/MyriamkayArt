// Limited edition prints: one shared edition per artwork (e.g. 20 prints in
// total across A2 and A1, numbered 1/20 to 20/20), tracked entirely from orders.
//
// A print is a limited edition when its record has `editionTotal` > 0. Every order
// placed for it is stamped `limitedEdition: true` and moves through:
//
//   New / Link Sent  -> holds a reservation until `reservedUntil` (released when it
//                       expires or the order is Cancelled)
//   Paid / Shipped / Completed -> sold; edition numbers are assigned on the move to
//                       Paid and stay on the order for good
//   Cancelled        -> releases a reservation. If the order already had edition
//                       numbers they are retired, never reissued, so a cancelled
//                       paid print shrinks the edition rather than reusing its number.
//
// Orders placed before an artwork became a limited edition aren't stamped and never
// count toward it.

const EDITION_SIZES = ['A2', 'A1']; // the only sizes a limited edition is sold in
const UNPAID_STATUSES = ['New', 'Link Sent'];
const SOLD_STATUSES = ['Paid', 'Shipped', 'Completed'];
const RESERVATION_HOURS = Number(process.env.PRINT_RESERVATION_HOURS) || 72;

function isLimitedEdition(print) {
  return Number(print && print.editionTotal) > 0;
}

function reservationExpiry(now = Date.now()) {
  return new Date(now + RESERVATION_HOURS * 3600 * 1000).toISOString();
}

function holdsReservation(order, now = Date.now()) {
  return order.limitedEdition
    && UNPAID_STATUSES.includes(order.paymentStatus)
    && !(order.editionNumbers || []).length
    && Date.parse(order.reservedUntil || 0) > now;
}

// Counts for one print. `excludeOrderId` leaves one order's own reservation out,
// for when that order is being renewed or paid.
function editionState(print, orders, { now = Date.now(), excludeOrderId = null } = {}) {
  const total = Number(print.editionTotal) || 0;
  const mine = (orders || []).filter(o => o && o.limitedEdition && o.printId === print.id);

  const issued = new Set(); // every number ever assigned, including retired ones
  mine.forEach(o => (o.editionNumbers || []).forEach(n => issued.add(Number(n))));

  const sold = mine
    .filter(o => SOLD_STATUSES.includes(o.paymentStatus))
    .reduce((sum, o) => sum + (o.editionNumbers || []).length, 0);

  const reserved = mine
    .filter(o => o.id !== excludeOrderId && holdsReservation(o, now))
    .reduce((sum, o) => sum + (Number(o.quantity) || 1), 0);

  const available = Math.max(0, total - issued.size - reserved);
  return { total, sold, reserved, retired: issued.size - sold, issued, available };
}

// The lowest numbers never issued for this print, or null if there aren't enough.
function nextEditionNumbers(state, qty) {
  const out = [];
  for (let n = 1; n <= state.total && out.length < qty; n++) {
    if (!state.issued.has(n)) out.push(n);
  }
  return out.length === qty ? out : null;
}

function formatEditionNumber(n, total) {
  const width = String(total).length;
  return `${String(n).padStart(width, '0')}/${total}`;
}

module.exports = {
  EDITION_SIZES, UNPAID_STATUSES, SOLD_STATUSES, RESERVATION_HOURS,
  isLimitedEdition, reservationExpiry, holdsReservation, editionState,
  nextEditionNumbers, formatEditionNumber,
};
