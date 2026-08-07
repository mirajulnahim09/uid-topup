# BRANDING_MANAGEMENT_REPORT.md

**Scope:** Remove all hardcoded branding and replace it with a complete, admin-managed Brand Identity system — logos, text, metadata, PWA, email and social cards — configurable entirely from the admin panel.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**)

| Suite | Result |
|---|---|
| **Branding verification (live browser)** | **48/48** ✅ |
| Pages audit (32 pages × 3 viewports) | **0 issues** ✅ |
| Tables audit | **0 issues** ✅ |
| System audit (security, a11y, SEO, DB) | **54/54** ✅ |
| Telegram enterprise | **94/94** ✅ |
| Money invariants | **18/18** ✅ |

---

## 1. The claim, proven

The requirement was that branding be changeable **without touching source code or config files**. So the test does exactly that — it uploads a logo and renames the platform *through the admin API only*, then checks every surface:

```
PASS  logo uploaded — /uploads/brand/1785930499309-odj9qdfg.png
PASS  branding saved — 9 keys
PASS  homepage <title> uses new name — ZZ BRAND PROBE — probe title
PASS  homepage og:site_name updated
PASS  homepage nav renders uploaded logo
PASS  footer copyright updated
PASS  favicon link points at upload
PASS  login page renders uploaded logo
PASS  register page renders uploaded logo
PASS  manifest name updated — ZZ BRAND PROBE manifest
PASS  manifest short_name updated — ZZPROBE
PASS  manifest icon uses upload
PASS  admin panel renders uploaded logo
PASS  browser tab title updated
PASS  dark theme shows exactly one primary logo — 1 visible
PASS  light theme shows exactly one primary logo — 1 visible
48/48 passed
```

Not one file was edited between the "before" and "after" states. Everything was restored afterwards, verified: `original name restored`, `probe logo no longer referenced`.

---

## 2. Architecture

### 2.1 Two files with two different jobs
| File | Role |
|---|---|
| `src/lib/brand.ts` | code-level **fallback constants** — safe in the client bundle, works with no database |
| `src/lib/branding.ts` | **runtime resolution** from `Setting` rows — server-only |

Merging them would force every client component to pull the DB. Keeping them apart means a fresh install with an empty database still renders a complete, branded site.

### 2.2 Ten slots, two themes, one settings row each
`brand_logo_<slot>_<theme>` — 20 keys total. Slots: primary, secondary, compact, square, favicon, pwa, login, loading, email, og.

**Three fallback layers, so one upload brands the whole site:**
1. Missing theme variant → the other theme's image (most logos work on both).
2. Missing slot → a defined chain: `login → primary`, `loading → square → primary`, `pwa → square → favicon`, `compact → square → primary`, and so on.
3. Nothing uploaded at all → the existing `VoltMark`.

The admin is never forced to prepare 20 files, and the site is never logo-less.

### 2.3 Theme switching is CSS, not JavaScript
`BrandLogo` renders **both** images; CSS (`:root[data-theme='light']`) hides one.

> Picking in JS from `useTheme().resolved` would paint the wrong logo on the first frame and cause a hydration mismatch — the server cannot know the visitor's theme. The CSS approach is correct from frame one, with no flash.

Verified in-browser: **exactly one** primary logo visible in each theme (not zero, not two).

### 2.4 One server→client handoff
`BrandProvider` is mounted once in the root layout and hands the resolved branding to the whole client tree; `useLogo(slot)` reads it. Client pages like login and register get their logo with **no extra request and no late-arriving flash** — a per-component fetch would have added a round-trip to every page.

### 2.5 Email
Emails embed a `<!--BRAND_HEADER-->` placeholder that `send()` swaps for the real header immediately before dispatch.

Editing all 8 `wrap()` call sites would have worked, but missing one would leave a single email permanently on the old brand. A single choke point cannot drift.

**Email logos need an absolute URL** — an email client has no "site" to resolve `/uploads/x.png` against. If `site_url` isn't set, the text wordmark is used rather than a broken-image icon.

---

## 3. Admin UI — `/admin/branding`

Three tabs:

**🖼️ লোগো** — all 10 slots, each with a dark and light drop-zone (20 upload targets, verified). Each zone supports **drag-and-drop and click-to-browse**, shows a **live preview**, and offers **replace** and **delete**. Every preview sits on that theme's actual background colour — a white logo on a white card is invisible, so it couldn't be judged otherwise.

**✍️ ব্র্যান্ড তথ্য** — all 15 text fields with per-field character counters and hints. Empty means "use the sensible default" (copyright, for instance, generates itself from company + year).

**👁️ লাইভ প্রিভিউ** — desktop/mobile × dark/light, showing the branding as it will actually appear in: browser tab, navigation, login card, loading overlay, footer, **Google search result**, **social share card**, and **PWA home-screen icon**. Nothing is saved to see it.

Plus a guarded **reset-all** that clears branding and removes the uploaded files.

### Image handling
Crop, resize and compression happen **in the browser** via the existing `processImage` (aspect ratio per slot, per-slot max dimension, quality 0.9) — so large files never reach the server and the admin sees the result immediately. **SVG is passed through untouched**: rasterising a vector onto a canvas would destroy exactly the quality that makes SVG worth uploading.

---

## 4. Security

| Control | Result |
|---|---|
| Admin-only endpoints | ✅ GET and POST both 401 anonymous |
| **Magic-byte mime detection** | ✅ a shell script named `evil.png` is rejected (400) — the declared type is never trusted |
| Folder traversal | ✅ `../../etc` rejected (400) |
| `javascript:` logo URL | ✅ rejected via `safeUrl()` (400) |
| Unknown logo slot | ✅ allowlisted, rejected |
| Unknown text field | ✅ allowlisted, rejected |
| Size cap | ✅ 8 MB server-side, plus a client-side pre-check with a clearer message |
| Format allowlist | ✅ PNG / JPEG / WebP / SVG / GIF only |
| Orphan files | ✅ replacing or deleting a logo removes the old file from storage |
| Audit log | ✅ every branding change recorded with which keys changed |

The last one matters: the previous audit found orphaned `Media` rows pointing at deleted files. Branding writes now clean up after themselves rather than repeating that.

---

## 5. Coverage — where branding now appears

| Surface | Source |
|---|---|
| Browser title, meta title/description, keywords | `generateMetadata` → `getBranding()` |
| Favicon, Apple touch icon | `metadata.icons` (falls back to static `icon.svg`) |
| OpenGraph + Twitter card (title, description, image) | `generateMetadata` |
| PWA manifest name / short name / description / icons | `manifest.ts` (`force-dynamic`) |
| Navigation | `Navbar` → `primary` |
| Footer + copyright + footer text | `Footer` → `secondary` |
| Login / Register | `useLogo('login')` |
| Loading overlay & boot splash | `EnergyCore logoUrl` → `loading` |
| Admin panel header | `AdminLayout` → `compact` |
| Email header | `send()` → `email` (absolute URL) |
| Telegram messages | site name via `getSettings()` (already dynamic) |
| Install prompt / home screen | manifest `pwa` icon |

**`manifest.ts` needed `force-dynamic`** — without it Next renders the manifest once at build time and admin changes would never appear. Any future brand-consuming route needs the same.

---

## 6. Quality

**Accessibility:** every one of the 20 upload inputs is labelled (verified 0 unlabelled); drop-zones are keyboard-reachable via their buttons; the missing-image placeholder carries a descriptive `aria-label`; theme-hidden logos are marked `aria-hidden` so screen readers don't announce the logo twice.

**Responsive:** 0 px overflow at 390 px and 1440 px on the branding page.

**No regressions:** pages 0 issues, tables 0 issues, system 54/54, Telegram enterprise 94/94, money 18/18, shared JS unchanged at 87.3 kB.

---

## 7. Honest limitations

1. **Crop is automatic, not interactive.** `processImage` crops to each slot's aspect ratio from the centre; there is no draggable crop box. For logos — usually already trimmed — centre-crop is almost always right, but an off-centre mark would need pre-trimming. An interactive cropper is a contained future addition; the underlying function already accepts an offset.
2. **`site_url` must be set for email logos.** Without it, emails fall back to the text wordmark. This is stated in the field's hint, and the fallback is deliberate — a text wordmark beats a broken-image icon in an inbox.
3. **`app/icon.svg` remains as the static default favicon.** Next requires a real file there. Once an admin uploads a favicon, `metadata.icons` overrides it — but the file stays as the zero-config fallback. It is no longer the *only* favicon, which was the point.
4. **Telegram messages carry the site name, not the logo.** Telegram bots send text; attaching an image to every notification would be noise, not branding.
5. **No brand-asset versioning or history.** Replacing a logo deletes the old file. Reverting means re-uploading.
6. **The old `site_logo` setting still works** and is checked before the fallback chain, for backwards compatibility with anything configured before this system existed.

---

## 8. Files

**New:** `src/lib/branding.ts` · `src/components/brand/BrandLogo.tsx` · `src/components/brand/BrandProvider.tsx` · `src/components/admin/BrandingManager.tsx` · `src/app/admin/branding/page.tsx` · `src/app/api/admin/branding/route.ts` · `scripts/branding-test.ts`

**Changed:** `layout.tsx` (metadata + BrandProvider + boot logo) · `manifest.ts` (dynamic, admin-driven) · `Navbar.tsx` · `Footer.tsx` · `(public)/layout.tsx` · `admin/layout.tsx` · `login/page.tsx` · `register/page.tsx` · `EnergyCore.tsx` (optional logo) · `email.ts` (header injection) · `admin/upload/route.ts` (`brand` folder) · `AdminNav.tsx` (menu entry) · `globals.css` (theme-swap rules) · `MANUAL_PRO.md` §28
