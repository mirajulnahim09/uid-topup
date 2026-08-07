# Login Loading Experience — Redesign Report

**Date:** 2026-08-06 · **Scope:** complete replacement of the loading experience, not a patch
**Verified against:** production build (`next build` → `next start`) for performance; `next dev` for auth-dependent suites
**Result:** `scripts/loading-test.ts` **63/63 passed** · typecheck ✅ · lint ✅ · build ✅

---

## 1. What was actually wrong

The previous mascot was not merely unattractive — the codebase had **three parallel loading systems** that had to negotiate with each other at runtime:

| System | Where it lived | How it was triggered |
|---|---|---|
| `EnergyCore` / `BrandedLoader` | `src/components/fx/` | global `fetch` interceptor |
| `MascotLoader` + `CatMascot` | `src/components/mascot/` | mounted by `/login`, `/register`, `GoogleButton` |
| `#v-boot` boot screen | `layout.tsx` | server-rendered, pre-hydration |

Because two of them could fire for the same request, `MascotLoader` called `claimLoadingScope(/^\/api\/auth\//)` to make the global interceptor stand down, and set a `data-mascot-busy` attribute on `<html>` so CSS could freeze the background. Both mechanisms existed **only** to stop the two systems fighting.

The visual itself had specific, nameable failures — all of which only showed up in screenshots:

- the cat read as a flat dark blob (no rim light, no occlusion, no depth);
- the striking paw was drawn *behind* the body, so the "strike" frame showed nothing happening;
- the tail crossed over the body and read as a detached squiggle;
- the "cotton ball" was a small pale dot, not an energy orb.

---

## 2. Removing the old system

Everything below was **deleted**, not deprecated:

```
src/components/fx/BrandedLoader.tsx        deleted
src/components/fx/EnergyCore.tsx           deleted
src/components/mascot/MascotLoader.tsx     deleted
src/components/mascot/CatMascot.tsx        deleted
src/components/mascot/types.ts             deleted
src/components/mascot/                     directory removed
scripts/mascot-test.ts                     deleted (superseded)
globals.css  .v-core* block                59 lines removed
globals.css  .mascot-* block              163 lines removed
i18n  mascot.*, load.auth/page/processing  removed
LoadingProvider  claimLoadingScope()       removed
```

Call sites cleaned: `/login`, `/register`, `GoogleButton`, `DeliveryConfirm`.

Two coordination mechanisms disappeared as a consequence rather than being rewritten:

- **`claimLoadingScope()`** — with only one system, there is nobody to negotiate with. `/api/auth/*` is already in `BLOCKING_PATHS`, so login, register and logout get the overlay for free and the auth pages mount no loader of their own.
- **`data-mascot-busy`** — the background freeze is now `body:has(.v-ovl)`. The DOM *is* the condition, so there is no second source of truth that can stick if a component crashes.

**`GoogleButton` is the one deliberate exception** and it gets no overlay at all: `signIn('google')` is a full-page redirect, not a `fetch`, so the interceptor cannot see it — and a full-screen loader is the wrong answer for something that leaves in one frame. It shows a 16 px `InlinePulse` inside the button.

### The single architecture

```
src/components/loading/
  NovaCat.tsx        geometry only · server component · no hooks
  LoadingStage.tsx   mascot + rotating message + progress sweep
  InlinePulse.tsx    the only permitted inline indicator
```

Rendered from exactly two places, both using the same component and the same CSS:

| Where | Why separate |
|---|---|
| `.v-ovl` (`LoadingProvider`) | React is running |
| `#v-boot` (`layout.tsx`) | React is **not** running yet (F5 / cold visit) |

`NovaCat` is a server component with no hooks, and the message rotation is **pure CSS**, precisely so the boot screen behaves identically before any JavaScript executes.

The test enforces this: it scans source (comments stripped, so historical notes don't false-positive) and fails if any legacy name reappears, if more than one component renders `.v-ovl`, or if `src/components/loading/` gains a fourth file.

---

## 3. The mascot

A cat playing with an energy orb, on a 4.4 s master cycle: the orb drifts in → the cat tracks it with head and pupils, ears twitch → it strikes (sparks, body recoil) → the orb is flung away trailing particles → it drifts back → the cat squints happily.

**24 distinct animations, 34 running concurrently.** Every behaviour asked for is present and individually asserted:

| Requested | Animation |
|---|---|
| eye blinking | `nv-blink` (double blink, irregular) |
| ear twitch | `nv-ear-l` 5.2 s / `nv-ear-r` 6.1 s |
| tail movement | `nv-tail` |
| head movement | `nv-head` (tracks the orb) |
| paw movement | `nv-paw` (wind-up → strike → recover) |
| breathing | `nv-breathe` |
| small idle movements | `nv-body` |
| looking around | `nv-pupil` |
| happy reaction | `nv-happy` (^ ^ eyes at 60–72 %) |
| curious reaction | head + ears leading the orb |
| chases / catches the orb | `nv-orb` |
| particle trail | `nv-trail` ×3, staggered |
| pushes it away, bounces back | `nv-orb` keyframes 30 % → 52 % → 94 % |
| spark effects | `nv-spark` |
| tiny glowing particles | `nv-mote` ×6 |
| soft lighting / bloom | `nv-bloom`, `nv-amb`, rim gradients |
| light motion blur | `nv-streak` |
| ambient shadows | `nv-shadow`, `nv-orb-shadow` |

**Why it doesn't read as a loop:** the master cycle is 4.4 s, but breathing is 3.8 s, tail 4.6 s, ears 5.2 / 6.1 s, blink 5.4 s, ambience 5.6 s, motes 6.4–9 s. Sixteen distinct durations, deliberately coprime-ish, so the composite state never returns to the same place.

**What makes it read as premium rather than as a cartoon:**

1. **Rim light** — a lime→ice gradient stroke along the silhouette on the orb's side. This single layer is what turns a flat fill into a lit object.
2. **Layered shadow** — a soft radial floor shadow, a tight contact shadow, plus ambient occlusion under the chin, under the chest, and at the shoulder joint.
3. **Cool fill-light** from the opposite side, so the shadow side isn't dead.
4. **Layer order carries the acting** — tail *behind* the body, striking paw *in front*.
5. **Expression** — pupils and head lead the orb; the cat squints happily after the catch.

### Effects without the frame cost

No `filter`, no `feGaussianBlur`, anywhere. Every glow and bloom is a `radialGradient` — it looks like bloom and rasterises like an ordinary shape. Filter-based glow would have cost exactly the frame rate this screen is judged on.

---

## 4. Background, messages, and the loading feel

**Background:** `backdrop-filter: blur(16px) saturate(.85)`, plus a themed scrim and a soft vignette that keeps the eye on the mascot.

**Messages:** three premium status lines that cross-fade — *"নিরাপদে সংযুক্ত হচ্ছে…" / "আপনার গেমিং অভিজ্ঞতা প্রস্তুত হচ্ছে…" / "ড্যাশবোর্ড লোড হচ্ছে…"* (en: "Connecting securely…" / "Preparing your gaming experience…" / "Loading your dashboard…"). Nine-second cycle, CSS-only.

Money, order, upload and admin-save operations still show their **specific** label instead — rotating atmospheric copy over a payment would be dishonest. Auth and navigation return an empty label, and empty is the signal to rotate.

**No spinner, no percentage.** The only progress affordance is a sweeping 3 px bar. The test fails the build if `animate-spin` appears anywhere, or if anything inside `.v-ovl` animates a full 360° rotation — with the orb's orbit ring and satellites explicitly whitelisted as scenery.

---

## 5. Performance

Isolated on a single page load, **production build**, headless (CPU raster — the worst case; real GPUs do better):

| State | FPS |
|---|---|
| idle login page (baseline) | 130–138 |
| overlay up, 34 animations running | **81–96** |

- **Every animation is `transform`/`opacity` only** — asserted by walking `document.getAnimations()` and inspecting the animated property set of each keyframe.
- **No layout shift**, measured: the form's box moves Δx = 0.0, Δy = 0.0 px when the overlay mounts. Scroll lock is `overflow:hidden` **plus `scrollbar-gutter:stable`** — without the gutter, removing the scrollbar shifts the page ~15 px right, which is precisely the shift this screen must not cause.
- **The blur is the cost, not the SVG.** `backdrop-filter` is expensive only when its backdrop changes, and `SiteBackground` runs a canvas rAF loop with 30+ particles. Freezing the decoration while the overlay is up is what buys the frame rate:
  ```css
  body:has(> #v-boot) .site-bg canvas,
  body:has(.v-ovl)    .site-bg canvas { display:none !important; }
  ```

**Reduced motion:** the global rule zeroes every animation, which would freeze the cat solid. Class-specific rules restore breathing, blinking and the message rotation at 7 s / 9 s / 9 s; the orb, paw, head, tail, ears, sparks, trails and motes stop. Same drawing, calm motion — verified as a distinct scenario.

---

## 6. Verification

`npx tsx scripts/loading-test.ts [--headless]` — **63/63**

| Section | Covers |
|---|---|
| 0. Architecture | legacy files gone · no legacy refs in code · no `animate-spin` · exactly one `.v-ovl` owner · exactly three loading components |
| 1. Boot screen | renders **with JavaScript disabled** · same mascot · 3 rotating messages · no spinner · **actually painted** (fixed, z=200, 1280×860, opacity 1) not merely present in markup |
| 2. Idle | no overlay when nothing is happening · boot screen removed after hydration · baseline FPS + baseline background contrast recorded |
| 3. Login | overlay appears · exactly one · all parts drawn · **zero layout shift** · scroll locked · blurred · dimmed · z-order · clicks blocked · background frozen · rotation verified · no `%` · a11y |
| 4. Animation | 34 running · compositor-only · all 16 requested behaviours · 16 distinct durations · no spinner · orb not clipped **at its extreme** · 60 FPS |
| 5. Themes | dark + light: message legibility, scrim changes, **pixel-level obscuring** |
| 6. Teardown | overlay removed after failure · scroll lock released · form usable · no console errors |
| 7. Login → logout | overlay on successful login · no flash-off before redirect · lands authenticated · overlay on logout via the real nav drawer button |
| 8. Reduced motion | overlay still shown · busy motion stopped · calm motion kept |
| 9. Responsive | 390 / 768 / 1440 — overlay appears, mascot fits, no horizontal overflow |

**Regression suites** (against `next dev`): `audit-pages` **0 issues / 32 pages** · `audit-system` **54/54** · `branding-test` **48/48** · `money-invariants` **18/18** · `audit-deadcode` — no orphaned loading files.

Screenshots in `audit/loading/`: `login-dark`, `login-light`, `logout`, `boot-no-js`, `reduced-motion`, `responsive-{mobile,tablet,desktop}`.

---

## 7. Things that only screenshots caught

This is the part worth keeping. In every case below, the full assertion suite was green while the screen was visibly wrong.

| Symptom on screen | Cause |
|---|---|
| Nothing appeared to happen on the strike frame | The striking paw was drawn *behind* the body, and in a pale fur gradient that vanished inside the orb's bloom. |
| A white blob floating beside the cat | The tail tip was a thick white stub; the tail gradient is already light at the top, so tip and tail read as separate objects. Removed — a solid tail with a cool rim reads correctly. |
| A green smudge on the cat's cheek | The rim light was a *filled* shape inside the silhouette. A rim light is by definition an edge, so it must be a **stroke along the silhouette**. |
| The login form was still readable behind the overlay in light theme | 88 % white over **dark text** leaves 12 % of near-black, which is perfectly legible. Counter-intuitively the light theme needs a *stronger* scrim (96 %), not a weaker one. |

A fifth was caught by adding a check rather than by looking: the boot-screen test only asserted `#v-boot` **existed in the markup**. Tightening it to "is actually painted" exposed that the assertion had been reading the element *before its stylesheet applied* — an unstyled element defaults to `opacity: 1`, so a wait keyed on opacity exited instantly and measured a `static`, 241 px-tall box. The screenshot taken ~50 ms later always looked correct. The wait now keys on `position === 'fixed'`, which is the condition that actually means "the CSS arrived".

Two process changes came out of this:

1. **`scripts/loading-preview.ts`** — renders `LoadingStage` straight to static HTML (pulling the `.nv-*` block out of `globals.css`) and screenshots four points in the animation cycle. Judging the artwork went from a build-plus-login round trip to ~3 seconds. It also seeks the animation to the strike and fling frames, which is where the geometry bugs live.
2. **`regionContrast()`** — where a property can be measured in pixels, it now is. The test screenshots the nav strip, decodes it **inside the browser** on a canvas (no image library is installed in this project), and asserts the contrast behind the overlay collapses to under 30 % of its bare value. Measured: dark 47.2 → 2.9 (6 % left), light 34.6 → 1.8 (5 % left). This assertion would have failed on the old light-theme scrim.

---

## 8. Two findings worth recording

**Rotating messages were invisible where they mattered.** On the first pass, `labelFor()` returned a specific label for `/api/auth/*`, so login showed a static *"যাচাই করা হচ্ছে…"* and the rotating premium messages only ever played on the boot screen — the exact opposite of the requirement. Fixed by making auth and navigation return an empty label; the test now asserts rotation **during login** specifically.

**Auth-dependent suites must run against `next dev`.** Running them against a production build served over plain http produced a wave of convincing-looking failures — SSL errors, admin pages redirecting to `/login`, a "31 px horizontal overflow" on 22 pages. None were real: in production NextAuth issues `Secure` cookies, the browser drops them over http, so the server renders logged-out while the client hydrates logged-in, and the nav renders more items than fit. On `next dev` the same suites report 0 issues. Use `next start` only for FPS. This is now recorded in `MANUAL_PRO.md` §29.9 so the next person doesn't chase it.

---

## 9. Documentation

`MANUAL_PRO.md` **§29** rewritten end to end as *"NOVA — the one loading architecture"*, covering the single-visual rule, why login has no loader, labels vs. rotation, performance methodology, the scroll-lock and scrim reasoning, reduced motion, and the SVG traps (`fill-box` vs. inline `transform`, sizing the `viewBox` for the animation's extremes, rim light as stroke, layer order). §23.2 and §22 are annotated where they still named the removed components.


---

# 10. Second redesign — "The Charge-Up" (2026-08-06, later same day)

**Feedback:** the engineering was fine, the visual impact was not. The brief: design it as Riot / Steam / Epic would, make users smile and remember the brand, and replace the concept outright if a stronger one exists.

**The honest problem with v1.** It was a well-executed *generic* mascot. A cat batting a glowing orb says nothing about a Free Fire diamond top-up service in Bangladesh — any SaaS could have shipped it unchanged. Polishing it further would have raised craft without raising recognition.

**The replacement concept.** The loop now enacts the product:

> a **diamond** is struck by the cat into the **SS UID TOPUP hexagon** → the mark ignites, its negative-space bolt lights up, a shockwave and impact rays fire → the cat squints happily → it dims and repeats.

The hexagon uses `VoltMark.tsx`'s exact point set, rescaled — a logo that is *almost* right is not a logo. The cat wears a **lime collar with a hexagon tag**, which is the single cheapest thing that turns "a cat" into "this brand's cat". The stage is a hex energy platform; HUD corner brackets frame the scene like a launcher.

**Why it lands emotionally where v1 did not.** v1 had motion but no *event* — nothing was ever achieved, so there was nothing to feel. The new cycle has a dramatic structure with a payoff beat at 44%: anticipation → strike → flight → **ignition** → joy → reset. The happy-squint frame arriving right after the mark lights is the moment that makes someone smile.

**Measured:** 43 concurrent animations, 32 distinct, 24/24 required behaviours, all `transform`/`opacity` only, **103 FPS** on a production build (headless CPU raster, two consecutive samples). `loading-test.ts` **63/63**.

> One FPS sample read 52 — taken while the production build was still finishing on the same machine. Two clean samples immediately after both read 103. Reporting the contended number as the result would have been as wrong as hiding it.

**Screenshot-caught defects in this pass** (assertions were green throughout):
- the celebration paw read as a **detached white blob** — light fur on a light body at that rotation; fixed with a dark outline on the foreleg, a contrast problem not a geometry one;
- the charged glow **faded at 56%**, so the mark looked like it was switching off exactly while the cat celebrated — the payoff undercut itself;
- the waiting mark at 26% opacity was **nearly invisible in light theme**, so the diamond appeared to fly at nothing.

**Reduced motion** now freezes the scene in its *charged* state rather than its waiting state — the story cannot be told, but its outcome can be shown, so those users see a lit brand mark instead of a dim one.
