# GLOBAL_LOADING_SYSTEM_REPORT.md

**Scope:** Premium global gaming loading experience — new brand mark, non-spinner loading animation, intelligent blocking/non-blocking tiers, one reusable system app-wide.
**Date:** 2026-08-01
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · Playwright **16/16** in a live headed browser · both themes · desktop + mobile · reduced-motion.

---

## 1. The logo — one mark, everywhere

### The problem found first
The site was shipping **two unrelated logos**:

| Surface | What it showed |
|---|---|
| Navbar, footer | `VoltMark` — a cut-corner hexagonal plate |
| Browser tab, PWA icon (`src/app/icon.svg`) | a **brilliant-cut diamond**, copied from `Diamond.tsx` |

The tab and the header did not look like the same company. No amount of animation polish fixes that, so it was fixed first.

### VoltMark v2
A **pointy-top hexagon with a negative-space lightning bolt** — the bolt is *cut out* of the plate with an SVG `mask`, not drawn on top.

- **Professional / premium** — a single filled shape with one brand gradient (lime → ice → violet, the existing brand triad, so it reads as an evolution rather than a replacement).
- **Unique & memorable** — the knockout bolt is the whole identity; there is nothing else to remember, which is what makes it stick.
- **Minimal & scalable** — 6-vertex hexagon + 6-point bolt. Inner HUD detail auto-drops below 22 px so a favicon never turns to mud.
- **Both themes** — the mark is *filled*, so it stands as a solid coloured shape on white as well as on black; the outline keeps its edge on light backgrounds.
- **Favicon / PWA / app icon** — `plate` prop adds the dark rounded-square backing (a bare hexagon's lime edge vanishes on a light tab bar). `icon.svg` is now that exact geometry.

> ⚠️ `icon.svg` is a static copy — **if the mark changes, both files must change.** Noted in `MANUAL_PRO.md` §23.1.

---

## 2. The animation — Energy Core, not a spinner

`src/components/fx/EnergyCore.tsx`. Five layers:

| Layer | Motion | Requested style it satisfies |
|---|---|---|
| Hexagonal waves ×2 | expand outward from the core and fade | energy rings · cyber pulse · hexagonal energy field |
| Halo | radial light breathing behind the mark | neon glow · gradient glow · dynamic lighting |
| Brand mark | soft scale breathing | soft breathing effect · floating motion |
| Scan line | light bar sweeping down across the mark | holographic scan · light sweep |
| HUD brackets | four corner ticks pulsing | HUD-inspired · animated outlines |

**Why it never feels mechanical:** the five layers run on **deliberately unequal periods — 2.4 s · 2.6 s · 2.9 s · 3.3 s · 3.7 s**. They drift against one another, so the composite does not visibly repeat; the eye can't lock onto a loop. This was a design decision, not an accident of tuning.

**Zero rotating spinners remain in the codebase.** The old conic-gradient ring is gone, and the one raw `animate-spin` border circle (`DeliveryConfirm.tsx`, photo upload) now uses the same core. Verified: `document.querySelectorAll('.animate-spin, .v-loader-ring').length === 0`.

---

## 3. Coverage — every sector, including reload and page switching

> **Revised after your feedback** ("reload overlay isn't working", "set this loading overlay to all sector, also with page switching"). The first cut showed the full overlay only for money/identity/upload and used a thin beam for everything else. It now covers everything.

| Trigger | What shows | Grace |
|---|---|---|
| **Full page load / reload** | `#v-boot` — server-rendered Energy Core on an opaque backdrop | 180 ms |
| **Page switching** — any internal navigation | full Energy Core overlay | 150 ms |
| **Money / identity / uploads** | full Energy Core overlay | 120 ms |
| **All other mutations** — admin actions, product updates, wallet, tracking | full Energy Core overlay | 220 ms |
| Background reads (GET/HEAD) | **nothing** | — |

The 2 px top beam still runs *alongside* the overlay as a secondary signal.

### The reload gap — why it existed and how it's fixed
`LoadingProvider` is a React component, so it **cannot paint before hydration**. I reproduced the reported problem with Playwright: on a throttled reload the trace showed `boot=false overlay=false beam=false text=0` — roughly **2.5 seconds of nothing**, then content. No client-side code can fix that, because no client-side code is running yet.

The fix is a **server-rendered** boot layer in `layout.tsx` driven by pure CSS, so it is visible on first paint with zero JavaScript. `EnergyCore` is already a server component with CSS-only animation, so the boot screen and the in-app overlay are literally the same visual.

Two safety rules, both deliberate:
1. **180 ms grace** — a fast load never flashes it.
2. **8 s self-dismiss** — if JS never runs, the screen removes *itself*. Without this, one JS failure would leave the entire site permanently covered by an opaque overlay.

`BootDismiss` fades it on hydration, freezing the current computed opacity first — the element may still be mid-fade-in, and snapping to full opacity before fading out would produce exactly the flash the grace period exists to prevent.

### The one rule that did not change
**GET/HEAD still show nothing.** `/api/me` was measured at **5.2 s** on a cold Neon connection, and it polls on every page. Blocking on reads would freeze every page load for five seconds. This is load-bearing, not a preference — everything else became blocking, this stayed silent.

### The restraint rules that keep it premium
1. **GET/HEAD never show anything.** `/api/me` was measured at **5.2 s** on a cold Neon connection — surfacing reads would freeze every page load.
2. **Grace delay** — 260 ms blocking / 180 ms ambient / 400 ms route. Faster work finishes invisibly; a flashed overlay is worse than none.
3. **Min-show 420 ms** so it can never strobe.
4. **20 s safety release** — a hung promise can never trap the user behind the overlay.

---

## 4. One system, no duplicates

- **`NavProgress.tsx` deleted.** Its top bar *is* the ambient tier now. Keeping both would have run two bars on the same navigation.
- `BrandedLoader` rewritten onto `EnergyCore`, API unchanged, so existing callers needed no edits.
- `DeliveryConfirm`'s hand-rolled spinner removed.
- All loading now flows through `LoadingProvider` → `BrandedLoader`/`EnergyCore`.

---

## 5. Performance — and a real problem this exposed

The Playwright audit walks `document.getAnimations()` and asserts which CSS properties each animation touches. `transform` and `opacity` are compositor-only; anything else repaints every frame.

**The loading system:** 7 animations, properties `["transform","opacity"]` — clean.

**But the audit also caught two pre-existing offenders**, both converted to transform sweeps with identical appearance:

| Class | Where it runs | Cost before |
|---|---|---|
| `.v-flow-line` | navbar **+** footer **+** mobile tab bar | three continuous repaints on **every page**, permanently |
| `.skeleton` | every loading skeleton | a repaint per block; a loading page can have 20+ |

After the fix the audit reports **zero non-composited animations anywhere on the page**. This is the single biggest FPS win in the pass, and it came from the brief's performance requirement rather than from the loader itself.

Other performance properties: pure CSS (no per-frame JS), `will-change` used once on the core, job bookkeeping in refs rather than state, and `prefers-reduced-motion` collapses every animation to 0 ms while leaving the mark fully visible.

---

## 6. Verification

Live headed Chromium against the dev server. All API calls are `page.route()` stubs — **no database writes**; confirmed afterwards by querying `Deposit`/`LedgerEntry` (latest row still 2026-07-19, ledger unchanged).

| Check | Result |
|---|---|
| Logo in header is the hexagon + negative-space bolt | ✅ mask present |
| Favicon geometry matches the header mark, diamond gone | ✅ |
| No generic spinners on the page | ✅ 0 |
| Order → blocking tier | ✅ |
| Admin save → ambient only, screen never blocked | ✅ |
| Upload → blocking tier | ✅ |
| Blocking intercepts input | ✅ centre hit-test lands inside `.v-ovl` |
| Ambient never blocks | ✅ `pointer-events:none`, hit-test passes through |
| Loading animations are compositor-only | ✅ `["transform","opacity"]` |
| Non-composited animations elsewhere | ✅ none remaining |
| Light theme | ✅ theme-specific scan/halo overrides |
| Mobile 390 px | ✅ core 134 px, centred, fits |
| Reduced motion | ✅ collapsed to 0 ms, mark still fully visible |
| Failed requests accounted for | ✅ final run: **zero** non-2xx responses |
| Console errors | ✅ clean |
| Admin action also blocks (all sectors) | ✅ |
| GET polling still silent | ✅ |

**17/17 passed.**

### Reload & page-switching suite (second pass, 7/7)
| Check | Result |
|---|---|
| Boot markup present in raw server HTML | ✅ `#v-boot` + energy core, no JS needed |
| Boot overlay visible during a slow reload | ✅ frames at full opacity |
| Boot removed after hydration | ✅ |
| Page switching shows the full overlay | ✅ `off → B → off` navigating to `/faq` |
| Page-switch overlay clears on arrival | ✅ no stuck overlay |
| Ordinary admin action now blocks | ✅ |
| GET still silent | ✅ |

---

## 7. Findings I am reporting rather than fixing

**`POST /api/deposit` returns 500 on a malformed body, not 400.** My stubs briefly leaked real requests to the dev server (test bug, since fixed), which surfaced this: `await req.json()` throws on an unparseable body, and that throw is not an `ApiError`, so the catch-all maps it to 500. Any route using `await req.json()` shares the shape.

I did **not** fix it in this pass: it sits on a money path, and `MANUAL_PRO.md` §21.5 requires re-running `npm run test:money` (18/18) after touching those. That is a deliberate, separate change — not something to slip into a UI pass. Suggested fix: a shared `readJson(req)` helper that throws `new ApiError('Invalid request body', 400)`.

**Mistakes in my own test harness, corrected during the run** (listed because each nearly became a false bug report):
- Measured centring against `window.innerWidth`, which includes the scrollbar → a phantom 5 px offset. Correct reference is the overlay's own box.
- Read `className` on an SVG element, which is an `SVGAnimatedString`, not a string.
- Scoped the animation audit by class-name substring, which swept in unrelated site animations.
- Called `unroute()` while stubs were still in flight, letting requests escape to the real API.

---

## 8. Honest limitations

1. **Light theme reads softer than dark.** The scrim is `--v-void` at 72 %, which in light theme is a near-white veil, so the core has less punch than on dark (the product default). Contrast is compliant and it matches the existing light-theme system; restyling shared tokens on a hunch would be a larger, separate decision.
2. **Programmatic `router.push()` isn't detected as a route *start*** — Next 14 exposes no hook that fires there. In practice such redirects follow a mutation whose own request already shows the overlay.
5. **Blocking everything is a real trade-off, made on your instruction.** With the overlay on every mutation and every navigation, a fast action now costs the grace delay plus the 420 ms minimum-show. The grace windows (120–220 ms) are what keep quick actions invisible; if any sector starts to feel heavy, raising its grace is a one-line change in `graceFor()`.
3. **FPS was verified structurally, not with a frame-rate capture** — the audit proves every animation is compositor-only (the property that determines smoothness) rather than sampling FPS on real hardware. A field profile on a mid-tier Android remains the honest next step, and is already item 7 on the `MANUAL_PRO.md` roadmap.
