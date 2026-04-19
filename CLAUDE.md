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

## Deployment

Deploy to Vercel (required for the `/api/upload` Edge function and Blob storage). Push to `main` triggers a deploy automatically once the project is connected.
