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
- **Pricing Calculator** (`showScreen('pricing')`): pure client-side math, no backend call — computes break-even/suggested/minimum price from cost inputs and margin targets, live on every keystroke (`recalcPricing()`).
- **Receipt OCR**: `api/receipt-ocr.js`, PIN-protected POST, calls the Claude API (vision) with a forced tool call to extract line items from a photographed receipt. **Requires `ANTHROPIC_API_KEY` in Vercel env vars — this is a real per-call cost billed to that key, not a free tier.** Model used: `claude-opus-5` (change the `MODEL` constant in `api/receipt-ocr.js` to something cheaper like `claude-sonnet-5` or `claude-haiku-4-5` if per-scan cost matters more than accuracy). Extracted items are always shown in an editable review table before anything is saved to Supplies — nothing is auto-committed.
- **Prints module**: `mk-data/prints.json` via `api/prints.js` — public GET (index.html reads it directly), PIN-protected POST, same shape as `api/paintings.js`. Each entry: `{ id, title, description, imageData, width, height, editionSize, numberSold, price, status ('Available'|'Sold Out'|'Private'), productionCost, paperCost, packagingCost, shippingCost, certificateCost }`. `numberRemaining`, cost/unit, profit/unit, margin, and full-edition revenue/profit are always computed live (`computePrintMetrics()` in admin.html) — never stored, so they can't drift out of sync. Managed from the admin "Prints" screen (list + add/edit form), image upload reuses the same crop-and-upload flow as paintings (`applyCrop()` target `'print'`).
- **Public print pages**: the site's `#prints` section (`renderPrintsSection()` in index.html) fetches `/api/prints`, hides any `status: 'Private'` entries, and shows the original "Fine Art Prints — Coming Soon" block only when there are zero public prints. Once prints exist, it renders a grid — image, title, size, "Physical Limited Edition Print" label, "Edition of N — M remaining" (or "Sold Out"), description, price, and a WhatsApp inquiry button (`inquirePrint()`, same pattern as painting inquiries).

## Deployment

Deploy to Vercel (required for the `/api/upload` Edge function and Blob storage). Push to `main` triggers a deploy automatically once the project is connected.
