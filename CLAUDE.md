# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal artist portfolio and studio management system for Myriam Kayali, an acrylic painter based in Beirut. Two standalone HTML files — no build step, no framework, no dependencies.

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
  medium: string,      // e.g. "Acrylic on canvas"
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

Fonts on the public site (index.html): **Fraunces** (headings, variable `opsz`/`wght` axis) and **Hanken Grotesk** (body) from Google Fonts — switched from Cormorant Garamond/Jost for a livelier, more expressive feel. admin.html still uses Cormorant Garamond/Jost (internal dashboard, not restyled).

## Image Storage — Vercel Blob

Images uploaded in the admin are sent to `POST /api/upload` (an Edge function at `api/upload.js`), which stores them in Vercel Blob and returns a public URL. That URL is saved in the painting's `imageData` field in localStorage instead of a base64 string.

**Required env variable in Vercel dashboard:** `BLOB_READ_WRITE_TOKEN`

## Financial Dashboard & Traffic — admin.html

The admin Dashboard screen (`showScreen('dashboard')`) tracks studio finances and site traffic:

- **Revenue** is derived from existing paintings with `status: 'Sold'` (their `price` field) — no separate revenue record. A painting's optional `soldDate` field (added via the Edit form, auto-filled to today when status is set to Sold) drives month-level revenue trends; paintings marked Sold without a `soldDate` fall back to their `year` field for yearly-only totals.
- **Expenses** are a new record type stored at `mk-data/expenses.json` in Blob via `api/expenses.js`, following the same `lib/blob.js` + PIN-protected-POST pattern as `api/paintings.js`. Each entry: `{ id, amount, category, date, note }`.
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
- **Prints module**: `mk-data/prints.json` via `api/prints.js` — public GET (index.html reads it directly), PIN-protected POST, same shape as `api/paintings.js`. Each print offers **multiple A-series sizes**, not one fixed size: `{ id, title, description, imageData, status ('Available'|'Sold Out'|'Private'), sizeOptions: [{ size: 'A4'|'A3'|'A2'|'A1', base_price, display_price, editionSize, numberSold, paperCost, productionCost, packagingCost, shippingCost, certificateCost }, ...] }`. The A-labels are relabeled cm sizes, not literal ISO paper dimensions — currently A4=$61 (20×30cm), A3=$96 (30×45cm), A2=$146 (40×60cm), A1=$242 (60×80cm), all in USD. **`base_price`** is the true price used for every cost/profit/margin calculation; **`display_price`** is what's actually shown to the public and charged on orders (currently `base_price` + a 1% conversion-cost markup, admin-editable per size, auto-suggested via `suggestDisplayPrice()`/`onBasePriceInput()` in admin.html) — the two are intentionally decoupled so the 1% markup never inflates reported profit. A size with `base_price` at 0/blank is treated as not offered and never shown publicly. Prints here are **not** limited editions — `editionSize`/`numberSold` stay at 0 (unlimited) unless a real edition cap is set. Per-size cost/profit/margin/remaining come from `computeSizeMetrics(sizeOption)` (profit always off `base_price`); per-print aggregates (used in the list view and Dashboard) come from `computePrintMetrics(print)`, which sums/best-cases across every offered size. Managed from the admin "Prints" screen — the add/edit form renders one cost/pricing block per size (`sizeOptionBlockHtml()`); image upload reuses the same crop-and-upload flow as paintings (`applyCrop()` target `'print'`).
- **Public print pages**: the site's `#prints` section is an **editorial lookbook + sticky shop panel**, not a single carousel or a plain image grid — `renderPrintsSection()` in index.html fetches `/api/prints`, matches titles against the fixed `PRINT_NAME_ORDER` array (6 prints, in display order) to build `purchasablePrints`, and shows `comingSoonPrintsHtml()` only when none match. Layout is `.prints-layout` (two columns on desktop, stacked on mobile): the left `.print-editorial-col` renders a hero shot (`PRINT_GALLERY_IMAGES[0]`) plus a 2-column masonry gallery of the rest of `PRINT_GALLERY_IMAGES` (separate array from the print product data — these are lifestyle/photoshoot images, not per-print thumbnails); the right `.print-shop-panel` is `position: sticky` and holds `renderPrintSelector()`'s output — a large preview of the selected print, a 6-up swatch row (`.print-chip`) to switch prints, and a `.print-size-list` of all 4 sizes each showing its own `display_price` in USD (`printsSelectSizeTag()`/`printsSelectPrint()`) — switching prints resets to the first size. Below the size list, two standing disclaimers are always shown: shipping is not included in the listed price (calculated by location, confirmed before payment), and sizes/prices may adjust slightly since some paintings are square rather than a standard rectangle — the order modal's review step repeats the shipping note. "Order This Print →" opens the order flow pre-selected to the current print + size. Note: `showSection()` force-sets inline `display` per section on nav — `#prints` needs `'block'` (the default case), `#commission` needs `'flex'` (has an explicit case), so a new section relying on CSS `display` must be added there too or its layout silently breaks.
- **Business summary + insights** (top of the Dashboard, `computeBusinessSummary()` / `generatePricingInsights()`): an "Originals vs Prints" card set (revenue, profit, units sold/remaining, avg. cost per painting, avg. margin, best-margin item — all-time only, since print sales have no per-unit date) and a plain-language "Pricing Insights" list (typical cost for your most-documented painting size, average original margin, potential revenue/profit if remaining print editions sell out, a month-over-month material cost increase note, and the current best-margin item) — simple threshold/average rules over existing data, no ML, each insight only appears once there's enough data to support it.

## Print Orders — capture, email, payment links

- **Order capture (public)**: each print card's "Order This Print →" button opens a 2-step modal (`#order-modal`, `openOrderModal()`/`renderOrderStep()` in index.html) — Contact & Shipping (validated per-step before advancing) → Review → on-screen Confirmation. No page reload, mobile-first (`type="tel"`/`type="email"` for the right mobile keyboard). Size is pre-selected from whichever tag was active on the card, but stays changeable at the top of step 1 (`orderSizeSelectorHtml()`) if the print offers more than one; the sticky summary at the top of each step reflects the current selection.
- **Backend**: `api/orders.js`, storing `mk-data/orders.json`. Unlike every other collection in this project, **writes are split by trust level**: `POST { action: 'create', ... }` is intentionally *not* PIN-protected (customers don't have the PIN) but only accepts a fixed set of fields and looks up the print's real price/size server-side — a client can never submit its own price. The stored `order.price` is the size option's **`display_price`** (what the client is actually charged), never `base_price` — margin reporting reads `base_price` straight from the print record, not from past orders. `GET` (list all orders) and `POST { action: 'update' | 'send-payment-link', pin, ... }` require the admin PIN, same as everywhere else.
- **Order record**: `{ id, createdAt, printId, printTitle, printSize, price, quantity, clientName, clientEmail, clientPhone, shippingBuilding, shippingStreet, shippingApartment, shippingCity, shippingCountry, shippingPostalCode, paymentLink, paymentStatus }`. `clientPhone` includes the dial code the customer picked from a dropdown on the order form (e.g. `+961 71234567`) — free text after that, not validated per-country. `shippingBuilding`/`shippingApartment` are optional. `paymentStatus`: `New → Link Sent → Paid → Shipped → Completed`. No payment processing anywhere — this is a manual tracking field Myriam updates herself.
- **WhatsApp follow-up (current primary channel)**: the order confirmation screen shows a "Send my order on WhatsApp" button (`orderWhatsAppUrl()` in index.html) that opens `wa.me/${MYRIAM_WHATSAPP}` (+961 3 678 875, the same constant used by the contact form and painting "Inquire" buttons) pre-filled with the print, size, qty, price, order ref, contact details and address. If saving the order fails, the client is offered the same WhatsApp message instead.
- **Emails are currently OFF**: `api/orders.js` only sends order emails when `ORDER_EMAILS_ENABLED=true` is set in Vercel. Resend was never set up (no DNS records for myriamkay.art at GoDaddy), so turning it on also needs the Resend setup below.
- **Emails (Resend, when enabled)**: on order creation, two emails fire automatically and non-fatally (the order still saves even if email sending fails or isn't configured yet) — a notification to `NOTIFY_EMAIL` with full order details, and a warm "order received" confirmation to the client (no payment/automation language). Separately, admin's "Send payment link to client" button (Orders tab) fires a third email with the pasted payment link and flips `paymentStatus` to "Link Sent" — this only ever happens when Myriam explicitly triggers it, never automatically.
- **Required Vercel env vars**: `RESEND_API_KEY` (from resend.com — also requires verifying myriamkay.art's DNS with Resend before it can send from your own domain), `RESEND_FROM_EMAIL` (e.g. `Myriam Kayali Art <orders@myriamkay.art>`, defaults to that if unset — will fail to actually deliver until the domain is verified), `NOTIFY_EMAIL` (where new-order alerts go — if unset, that email is simply skipped, the client confirmation still sends).
- **Admin Orders tab** (`showScreen('orders')`, `renderOrders()`): one row per order — client info, shipping address, print/size, price × qty, date, an editable status dropdown, and a payment-link input + "Send payment link to client" button.

## Image delivery — /media proxy (index.html + vercel.json)

The public site never loads images straight from `*.public.blob.vercel-storage.com`. `vercel.json` rewrites `/media/<file>.(jpg|png|webp|gif|avif)` to the Blob store, and index.html maps every Blob image URL to `/media/...` via `mediaUrl()` / `mapMedia()` (defined in an early `<script>` in `<head>`): hardcoded `src`s are written as `/media/...`, and `getPaintings()`, `getPrintsPublic()` and `getExhibition()` pass their API data through `mapMedia()`. A capture-phase `error` listener retries any failed `/media/` image once from the Blob domain directly.

Why: images served from the storage domain broke on some laptops while phones were fine. Serving them from the site's own domain avoids networks/filters that block the storage domain and any error responses cached during the Sept 2026 store pause. Admin data keeps the real Blob URLs (index.html only rewrites for display, never writes back).

HEIC/HEIF images only render in Safari. Admin upload handlers reject them (`rejectHeic()`), as does a pasted `.heic` URL; the crop step always re-encodes to JPEG.

## Shareable links (URL routing) — index.html + vercel.json

Every page and item has its own URL: `/about`, `/collection`, `/prints`, `/commission`, `/contact`, `/collection/<painting-slug>`, `/prints/<print-slug>`. `vercel.json` rewrites every path except `/api/`, `/images/`, `/media/` and `admin*` to `index.html`; `applyRoute()` reads `location.pathname` on load and on back/forward (`popstate`) and opens the right section, painting lightbox or selected print.

- `showSection(id)` pushes the section URL unless called with `{ fromRoute: true }` (used by the router itself). `openPainting()` pushes `/collection/<slug>`, `closeLightbox()` replaces it with `/collection`, `printsSelectPrint()` replaces with `/prints/<slug>`.
- Slugs come from titles (`slugify()`). Paintings with duplicate titles get `-<id>` appended (`paintingSlug()`, computed over the full unfiltered list so links don't change with the filter tab). A raw id also resolves.
- Because pages can load at nested paths, **asset paths in index.html must be absolute** (`/images/...`, `/api/...`), never relative.
- "Share this painting" / "Share this print" buttons call `shareCurrent()` (native share sheet on phones, copy link on desktop).
- Link previews (WhatsApp/Instagram cards) are still the site-wide ones from index.html's head; per-artwork preview images would need server-rendered meta tags.

## Admin auth — lib/auth.js

Every PIN check goes through `verifyPin(req, pin)` in `lib/auth.js` (never compare against `config.pin` inline). After 8 wrong PINs from one IP in 15 minutes that IP is locked out for 15 minutes; the lock is saved in private `mk-data/auth.json` (written only when a lock starts, so failed guesses can't run up storage operations). Admin requests send the PIN in an `x-admin-pin` header (`pinFromRequest()`), never in a URL; older POST endpoints still also accept `pin` in the JSON body.

- `GET /api/paintings` and `/api/prints` return **public fields only** (`publicPainting()` / `publicPrint()`): no cost estimates, revenue, sold dates, `base_price` or per-size costs; a hidden price is blanked and `Private` items are omitted. The admin gets full records via `?admin=1` + PIN header (always `no-store`, so it never shares the edge cache with the public response).
- `GET /api/expenses`, `/api/supplies`, `/api/settings`, `/api/orders`, `/api/traffic` and `POST /api/upload` all require the PIN.
- admin.html only marks a collection loaded after a successful read (`loaded`, `adminGetJson()`); `savePaintings/Prints/Expenses/Supplies` refuse to save before that, so a failed load can never overwrite data with an empty list.

## Blob storage access — lib/blob.js

**Private data:** the Blob store is public (anyone with a file's URL can read it), so `mk-data/config.json` (admin PIN), `orders.json` (customer PII), `expenses.json`, `supplies.json` and `settings.json` are stored at `mk-private/<secret>/<name>.json` instead (`PRIVATE_FILES` / `storagePath()` in `lib/blob.js`). `<secret>` is an HMAC of the server-only `BLOB_READ_WRITE_TOKEN`, or `PRIVATE_DATA_KEY` if set; store contents can't be listed without the token. Callers still pass the logical `mk-data/...` path. On first use per cold start, any of these files still at its old public path is copied to the private path and the public copy deleted. **If the Blob token is ever rotated, set `PRIVATE_DATA_KEY` to the old secret first or the private files will read as empty.** `/api/upload` requires the admin PIN in an `x-admin-pin` header.

Every `/api` function reads and writes its JSON through `lib/blob.js` (`readJson`, `writeJson`, `setPublicCache`), never through `list()`. `list()` is a Vercel Blob **Advanced Operation** and the free tier allows only 2,000/month; calling it on every page view got the store paused for 30 days in Sept 2026. Rules:

- Reads fetch the blob's public URL directly (store base URL derived from `BLOB_READ_WRITE_TOKEN`, or `BLOB_PUBLIC_BASE_URL` if set). A missing file returns `null`; any other failure **throws** (flagged `storageUnavailable`) so a failed read is never treated as empty and written back over real data, and the PIN never silently falls back to the default.
- Use `{ fresh: true }` before any read-modify-write, for PIN/config checks, and for admin reads. Public reads use the CDN copy.
- Public GETs (`/api/paintings`, `/api/prints`, `/api/exhibition`) call `setPublicCache()`: edge-cached for 60s (`s-maxage=60, stale-while-revalidate=600`). admin.html requests paintings/prints with `?admin=1` (PIN-protected, full data) and exhibition with `?fresh=1`; both bypass the edge cache so edits always start from the latest data. Error responses are always `no-store`.

## Deployment

Deploy to Vercel (required for the `/api/upload` Edge function and Blob storage). Push to `main` triggers a deploy automatically once the project is connected.
