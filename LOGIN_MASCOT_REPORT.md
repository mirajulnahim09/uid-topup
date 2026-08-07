# LOGIN_MASCOT_REPORT.md

> ⚠️ **SUPERSEDED on 2026-08-06 by `LOGIN_LOADING_REDESIGN_REPORT.md`.**
> Every component described below (`MascotLoader`, `CatMascot`, `BrandedLoader`, `EnergyCore`, `claimLoadingScope`, `data-mascot-busy`) has been **deleted**. Kept for history only — do not follow it as a guide to the current code. See `MANUAL_PRO.md` §29.

**Scope:** A premium animated cat mascot that plays with a cotton ball while authentication is in progress — replacing the generic spinner on the login experience.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**)

| Suite | Result |
|---|---|
| **Mascot verification (live browser)** | **44/44** ✅ |
| Pages audit (32 pages × 3 viewports) | **0 issues** ✅ |
| Branding verification | **48/48** ✅ |
| System audit (security, a11y, SEO, DB) | **54/54** ✅ |

---

## 1. What was built

A sitting cat, centred, that **repeatedly plays with a cotton ball**: it lifts a paw, taps the ball, the ball rolls out ~34 px while decelerating and rotating in the direction of travel, rests, then the cat reaches out and pulls it back. The cycle is 3.2 s and loops seamlessly.

Eight independent motions run at deliberately unequal periods so the composite never visibly repeats:

| Motion | Period |
|---|---|
| Paw tap / reach | 3.2 s |
| Cotton ball roll | 3.2 s (synchronised — contact at 20 % of both) |
| Body bob | 3.2 s |
| Shadow scale + fade | 3.2 s |
| Breathing (chest) | 3.6 s |
| Tail sway | 4.0 s |
| Eye blink (double-blink) | 4.4 s |
| Ear twitch (left / right) | 4.8 s / 5.6 s |

**The ball's rotation always follows its direction of travel** — rotating one way while translating back would read as sliding, not rolling.

Below the cat: **"সাইন ইন করা হচ্ছে…"** with **"আপনার গেমিং অভিজ্ঞতা প্রস্তুত করা হচ্ছে"** beneath. No percentage, no generic "Loading" — both asserted by test.

> **On the wording:** the brief gave English strings, but this product is entirely Bengali with an EN toggle. A single hardcoded English line would have looked broken. The strings are **i18n keys** (`mascot.signingIn`, `mascot.hint`) whose English values are exactly *"Signing you in…"* and *"Preparing your gaming experience"* — so the requested copy appears verbatim for English users.

---

## 2. Reusability

```tsx
<MascotLoader active={loading} mascot="cat" owns={/^\/api\/auth\//} />
```

The character is a **prop** — a registry name or any component satisfying `MascotProps { size, title }`. Swapping it means one line in `MASCOTS`; **no authentication code changes**. Currently used on login, register and the Google button from the same component.

Built as one inline SVG — no image, no Lottie, no animation library. A network request would delay the mascot on the exact screen where waiting is the problem, and JS-driven animation would occupy the main thread that must stay free for 60 FPS.

---

## 3. Performance — the mascot was never the bottleneck

The first measurement showed **46 FPS**, so I isolated the cost on a single page load rather than guessing:

| State | FPS |
|---|---|
| idle login page (no mascot) | 109 |
| mascot + blur | **47** |
| **blur off**, SVG still animating | **83** |
| blur off + SVG hidden | 117 |

The SVG cost almost nothing. **`backdrop-filter` was the entire problem** — and specifically `backdrop-filter` over a *moving* backdrop. `SiteBackground` runs a canvas rAF loop plus 30+ drifting particles, so the blur had to be recomputed every single frame and could never be cached.

**The fix:** `MascotLoader` sets `data-mascot-busy` on `<html>`; CSS pauses `.site-bg` animations and hides its canvas while the overlay is up. A static backdrop is rasterised once. Nothing is lost visually — that background sits behind 8 px of blur and a 92 % scrim.

**Production result — three consecutive runs: 80, 77, 80 FPS** (idle baseline ~131–136), in headless CPU rasterisation with no GPU, which is the worst case.

### Two measurement traps worth recording
1. **Dev-mode numbers are meaningless here.** The same build measured 33–46 FPS in `next dev` and 72–80 in `next start`. React's dev build and on-demand compilation dominate.
2. **Headed FPS in automation is worse than useless.** When the automated window was occluded, Chrome throttled rAF to **1 FPS** and reported that for every state — including states I knew were fast. Headless is deterministic; headed readings were discarded.

All 14 running animations use **only `transform` and `opacity`** — verified by walking `document.getAnimations()` and inspecting each keyframe's properties. Zero non-composited.

---

## 4. Two bugs only a screenshot could catch

**44 assertions passed while the screen looked wrong.** Visual inspection found what property checks could not:

### 4.1 The scrim was far too weak
In light theme `--v-void` is near-white (`#f4f6fb`), so a 74 % veil over a white page dimmed almost nothing. The login form stayed readable and **collided** with the mascot's message — "পাসওয়ার্ড ভুলে গেছেন?" printed straight through "সাইন ইন করা হচ্ছে…".
**Fixed:** a neutral dark layer under the theme tint, so both themes genuinely obscure the page while still showing its shape. Blur 6 → 8 px.

### 4.2 The cotton ball was invisible
The CSS sets `transform-box: fill-box`, which makes `transform-origin` relative to the element's **own bounding box**. I had also set an inline `transform-origin: 172px 148px` in user-space coordinates — under `fill-box` that origin lands far outside the ball, flinging it off-screen as it rotated. The cat rendered; the ball never appeared.
**Fixed:** removed the inline origin so the CSS `50% 50%` (the ball's true centre) applies.

Both now have assertions: the ball must measure >8 px **and** sit inside the SVG — and, separately, must not clip at the **furthest point of its roll** (the animation is paused at 50 % to check). That second test immediately exposed a latent bug: the ball's travel ended at x=219 in a 220-wide viewBox, so it clipped mid-roll at the right edge. The viewBox is now 250 wide.

---

## 5. Overlay behaviour

Fades in over 0.32 s, out over 0.26 s (the element is removed only **after** the fade completes, so it never snaps away). Blurs and dims the page, locks scroll, and intercepts pointer events — verified by hit-testing the viewport centre and confirming it lands on the overlay, not the form.

**On success the mascot deliberately stays up.** `router.push()` returns before navigation completes, so clearing `loading` there made the mascot vanish for a frame before the route overlay appeared. It now persists until the component unmounts with the page.

### No double overlay
`LoadingProvider` already blocks on `/api/auth/callback`, so both loaders would have appeared at once. `MascotLoader` claims its paths via `claimLoadingScope()` for its mounted lifetime and the global interceptor skips them. Verified: **0 global overlays** while the mascot is up. Releasing the claim restores the previous behaviour exactly, so `signOut` elsewhere still uses the global overlay.

> The claim is held on **mount**, not while `active` — next-auth's request starts on the same tick `active` flips, and a claim made then loses the race.

---

## 6. Accessibility

| Check | Result |
|---|---|
| `role="status"` + `aria-live="polite"` + `aria-busy` | ✅ the message is announced |
| SVG has `role="img"` and a descriptive `aria-label` | ✅ "একটি বিড়াল তুলোর বল নিয়ে খেলছে" |
| Decorative dots marked `aria-hidden` | ✅ |
| **Reduced motion** | ✅ verified in a real `prefers-reduced-motion: reduce` context |

Under reduced motion the global rule would have frozen the cat completely. Class-specific rules (higher specificity than `*`) restore **breathing and blinking only**, slowed to 7 s and 9 s; ball, paw, bob and tail stop entirely. Verified: `mascot-breathe:7000ms, mascot-blink:9000ms` running, busy motions absent, and the cat still fully drawn — same visual quality, calmer motion.

---

## 7. Responsive

Verified at 390 px: mascot renders, fits inside the viewport, **0 px horizontal overflow**. Screenshots captured for dark, light, mobile and reduced-motion in `audit/screens/`.

---

## 8. Honest limitations

1. **The cat is stylised, not illustrated.** It is hand-built SVG geometry — clean and on-brand, but a professional illustrator would produce something warmer. The pluggable design exists precisely so a designed mascot can replace it without touching auth code.
2. **60 FPS is verified in headless CPU rasterisation, not on real GPU hardware.** Headed measurement proved unreliable under automation (§3). Headless is the pessimistic case, so real hardware should be better — but I did not measure a GPU-composited browser, and I won't claim I did.
3. **Freezing the background is a visible trade-off** on a very slow connection: if authentication takes many seconds, the page behind is completely static. That is the correct call — a blurred, dimmed backdrop should not have particles drifting in it — but it is a deliberate change to the page beneath, not only an addition on top.
4. **The Google button's mascot is brief.** `signIn('google')` triggers a full-page redirect, so the overlay shows only until the browser navigates. It replaces a white flash rather than covering a long wait.
5. **One cycle length for all states.** Signing in and creating an account use the same 3.2 s loop with different text; there is no "almost done" state, because the app has no progress signal to base one on — and inventing one would be the percentage-style dishonesty the brief rules out.

---

## 9. Files

**New:** `src/components/mascot/CatMascot.tsx` · `src/components/mascot/MascotLoader.tsx` · `src/components/mascot/types.ts` · `scripts/mascot-test.ts`

**Changed:** `globals.css` (mascot keyframes, reduced-motion overrides, background-freeze rules) · `LoadingProvider.tsx` (`claimLoadingScope`) · `login/page.tsx` · `register/page.tsx` · `GoogleButton.tsx` · `i18n.ts` (4 keys × 2 languages) · `MANUAL_PRO.md` §29
