# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal artist portfolio and studio management system for Myriam Kayali, an oil painter based in Beirut. Two standalone HTML files — no build step, no framework, no dependencies.

- **`index.html`** — Public-facing portfolio website (SPA)
- **`admin.html`** — PIN-protected admin dashboard for managing paintings

## Development

No build process. Open files directly in a browser or serve locally:

```bash
# Serve locally (Python)
python3 -m http.server 8000

# Or with npx
npx serve .
```

## Architecture

### Data Layer

All data persists in `localStorage`. No backend or server.

| Key | Value |
|-----|-------|
| `mk_paintings` | JSON array of painting objects |
| `mk_pin` | 4-digit admin PIN (default: `1234`) |

**Painting object shape:**
```js
{
  id: string,          // timestamp-based
  title: string,
  year: number,
  medium: string,      // e.g. "Oil on linen"
  category: string,    // "Portrait" | "Figure" | "Study"
  width: number,       // cm
  height: number,      // cm
  price: number,
  description: string,
  featured: boolean,
  status: string,      // "Available" | "Sold" | "Private"
  imageData: string    // base64-encoded image
}
```

### index.html — Public Website

Single-page app with section-based navigation. `showSection(name)` hides all sections and reveals the target one. Gallery pulls from `localStorage` and falls back to 7 hardcoded default paintings if empty.

Sections: Home, About, Collection, Prints, Commission, Contact.

Filter tabs in the Collection section filter by `category` field.

### admin.html — Studio Dashboard

Three screens managed by `showScreen(name)`: `list`, `add`, `settings`.

- Paintings are added/edited via form; images are base64-encoded on upload before storing.
- Settings screen supports PIN change, full JSON export/import, and data wipe.
- Toast notifications (`showToast(msg)`) and confirmation modals used for destructive actions.

### Styling

CSS custom properties defined on `:root`:
- `--cream: #F4EDE0` — primary background
- `--terracotta: #B85C38` — accent / hover
- `--umber: #1E0F07` — dark text / buttons
- `--brown-light: #A07858` — secondary text

Fonts: **Cormorant Garamond** (headings) and **Jost** (body) from Google Fonts.

## Image Storage — Vercel Blob

Images uploaded in the admin are sent to `POST /api/upload` (an Edge function at `api/upload.js`), which stores them in Vercel Blob and returns a public URL. That URL is saved in the painting's `imageData` field in localStorage instead of a base64 string.

**Required env variable in Vercel dashboard:** `BLOB_READ_WRITE_TOKEN`

## Financial Dashboard & Traffic — admin.html

The admin Dashboard screen (`showScreen('dashboard')`) tracks studio finances and site traffic:

- **Revenue** is derived from existing paintings with `status: 'Sold'` (their `price` field) — no separate revenue record. A painting's optional `soldDate` field (added via the Edit form, auto-filled to today when status is set to Sold) drives month-level revenue trends; paintings marked Sold without a `soldDate` fall back to their `year` field for yearly-only totals.
- **Expenses** are a new record type stored at `mk-data/expenses.json` in Blob via `api/expenses.js`, following the same `readBlob`/`writeBlob`/PIN-protected-POST pattern as `api/paintings.js`. Each entry: `{ id, amount, category, date, note }`.
- **Traffic** pulls from the Vercel Web Analytics REST API via `api/traffic.js` (PIN-protected GET). Requires these env variables in the Vercel dashboard:
  - `VERCEL_API_TOKEN` — access token from vercel.com/account/tokens, scoped to this project/team
  - `VERCEL_PROJECT_ID` — Project Settings → General → "Project ID"
  - `VERCEL_TEAM_ID` — only if the project lives under a Vercel Team

  Web Analytics must also be enabled for the project (Project → Analytics tab). Without these, the Dashboard shows setup instructions instead of numbers.

## Business Tools — admin.html (Supplies, Pricing, Receipt OCR)

- **Art Supply Cost Database**: `mk-data/supplies.json` via `api/supplies.js`, same pattern as expenses. Each entry: `{ id, itemName, category, supplier, purchaseDate, quantity, unitCost, totalCost, currency, notes }`. Categories: Canvas, Paint, Brushes/Tools, Varnish, Packaging, Printing Paper, Print Production, Framing, Shipping, Other. Supply totals are folded into the Dashboard's cost KPIs alongside Expenses.
- **Business Assumptions**: `mk-data/settings.json` via `api/settings.js` (currency, target/min margin, hourly rate, default packaging/shipping/certificate costs, wastage %, markup multiplier). Edited on the Settings screen; feeds the Pricing Calculator and per-painting cost defaults.
- **Cost Estimation per artwork**: paintings now carry `costEstimate: { canvasCost, materialCost, varnishToolsCost, packagingShippingCost, framingCost, total }` and `revenueReceived`, editable on the Add/Edit Painting form. A "Suggest from similar-sized paintings" button averages cost data from past paintings within ~20% of the same area (`findHistoricalCostEstimate()` in admin.html).
- **Pricing Calculator** (`showScreen('pricing')`): pure client-side math, no backend call — computes break-even/suggested/minimum price from cost inputs and margin targets, live on every keystroke (`recalcPricing()`). Also includes two size-based breakdown tables on the same screen: **Painting Price Breakdown** (`recalcPaintingBreakdown()`) takes a material cost at one reference size and scales it by area across every distinct size already in the paintings catalog (`getCatalogPaintingSizes()`), and **Print Price Breakdown** (`recalcPrintBreakdown()`) does the same across the fixed A4/A3/A2/A1 ISO paper sizes (`A_SERIES_SIZES`). Both add flat packaging/shipping/certificate costs and the target margin on top of the scaled material cost.
- **Receipt OCR**: `api/receipt-ocr.js`, PIN-protected POST, calls the Claude API (vision) with a forced tool call to extract line items from a photographed receipt. **Requires `ANTHROPIC_API_KEY` in Vercel env vars — this is a real per-call cost billed to that key, not a free tier.** Model used: `claude-opus-5` (change the `MODEL` constant in `api/receipt-ocr.js` to something cheaper like `claude-sonnet-5` or `claude-haiku-4-5` if per-scan cost matters more than accuracy). Extracted items are always shown in an editable review table before anything is saved to Supplies — nothing is auto-committed.
- **Prints module**: `mk-data/prints.json` via `api/prints.js` — public GET (index.html reads it directly), PIN-protected POST, same shape as `api/paintings.js`. Each print offers **multiple A-series sizes**, not one fixed size: `{ id, title, description, imageData, status ('Available'|'Sold Out'|'Private'), sizeOptions: [{ size: 'A4'|'A3'|'A2'|'A1', price, editionSize, numberSold, paperCost, productionCost, packagingCost, shippingCost, certificateCost }, ...] }`. A size with `price` at 0/blank is treated as not offered and never shown publicly. Per-size cost/profit/margin/remaining come from `computeSizeMetrics(sizeOption)`; per-print aggregates (used in the list view and Dashboard) come from `computePrintMetrics(print)`, which sums/best-cases across every offered size. Managed from the admin "Prints" screen — the add/edit form renders one cost/pricing block per A-size (`sizeOptionBlockHtml()`); image upload reuses the same crop-and-upload flow as paintings (`applyCrop()` target `'print'`).
- **Public print pages**: the site's `#prints` section (`renderPrintsSection()` in index.html) fetches `/api/prints`, hides any `status: 'Private'` entries and any print with zero priced sizes, and shows the original "Fine Art Prints — Coming Soon" block only when nothing is left to show. Each card lists its offered sizes as clickable tags (`.size-tag`, `selectPrintSize()`) — clicking one updates the shown price/remaining-count for that card — then "Order This Print →" opens the order flow pre-selected to whichever size tag was active.
- **Business summary + insights** (top of the Dashboard, `computeBusinessSummary()` / `generatePricingInsights()`): an "Originals vs Prints" card set (revenue, profit, units sold/remaining, avg. cost per painting, avg. margin, best-margin item — all-time only, since print sales have no per-unit date) and a plain-language "Pricing Insights" list (typical cost for your most-documented painting size, average original margin, potential revenue/profit if remaining print editions sell out, a month-over-month material cost increase note, and the current best-margin item) — simple threshold/average rules over existing data, no ML, each insight only appears once there's enough data to support it.

## Print Orders — capture, email, payment links

- **Order capture (public)**: each print card's "Order This Print →" button opens a 2-step modal (`#order-modal`, `openOrderModal()`/`renderOrderStep()` in index.html) — Contact & Shipping (validated per-step before advancing) → Review → on-screen Confirmation. No page reload, mobile-first (`type="tel"`/`type="email"` for the right mobile keyboard). Size is pre-selected from whichever tag was active on the card, but stays changeable at the top of step 1 (`orderSizeSelectorHtml()`) if the print offers more than one; the sticky summary at the top of each step reflects the current selection.
- **Backend**: `api/orders.js`, storing `mk-data/orders.json`. Unlike every other collection in this project, **writes are split by trust level**: `POST { action: 'create', ... }` is intentionally *not* PIN-protected (customers don't have the PIN) but only accepts a fixed set of fields and looks up the print's real price/size server-side — a client can never submit its own price. `GET` (list all orders) and `POST { action: 'update' | 'send-payment-link', pin, ... }` require the admin PIN, same as everywhere else.
- **Order record**: `{ id, createdAt, printId, printTitle, printSize, price, quantity, clientName, clientEmail, clientPhone, shippingStreet, shippingCity, shippingCountry, shippingPostalCode, paymentLink, paymentStatus }`. `paymentStatus`: `New → Link Sent → Paid → Shipped → Completed`. No payment processing anywhere — this is a manual tracking field Myriam updates herself.
- **Emails (Resend)**: on order creation, two emails fire automatically and non-fatally (the order still saves even if email sending fails or isn't configured yet) — a notification to `NOTIFY_EMAIL` with full order details, and a warm "order received" confirmation to the client (no payment/automation language). Separately, admin's "Send payment link to client" button (Orders tab) fires a third email with the pasted payment link and flips `paymentStatus` to "Link Sent" — this only ever happens when Myriam explicitly triggers it, never automatically.
- **Required Vercel env vars**: `RESEND_API_KEY` (from resend.com — also requires verifying myriamkay.art's DNS with Resend before it can send from your own domain), `RESEND_FROM_EMAIL` (e.g. `Myriam Kayali Art <orders@myriamkay.art>`, defaults to that if unset — will fail to actually deliver until the domain is verified), `NOTIFY_EMAIL` (where new-order alerts go — if unset, that email is simply skipped, the client confirmation still sends).
- **Admin Orders tab** (`showScreen('orders')`, `renderOrders()`): one row per order — client info, shipping address, print/size, price × qty, date, an editable status dropdown, and a payment-link input + "Send payment link to client" button.

## Deployment

Deploy to Vercel (required for the `/api/upload` Edge function and Blob storage). Push to `main` triggers a deploy automatically once the project is connected.
