# PERFORMANCE_OPTIMIZATION_REPORT.md

**Date:** 2026-07-31 · Basis: clean production `next build` (exit 0) + source audit. No business logic changed. One safe optimization applied; the rest are honestly-scoped recommendations.

## Build reality (measured, not estimated)
Clean build, Next.js 14.2.35:

| Metric | Value | Assessment |
|--------|-------|------------|
| **Shared First Load JS (all routes)** | **87.3 kB** | Excellent — under the 100 kB "good" bar for an app with animation. |
| Heaviest route | `/product/[id]/[slug]` **159 kB** | Good — and it's **SSG-prerendered** (11 static paths), so users get static HTML. |
| Other notable | register 148 / login 147 / admin/site 140 kB | All reasonable. |
| API routes | **0 B** client JS | Correct — server-only. |
| Middleware | 49.2 kB | Acceptable (bundles next-auth JWT verify). |
| Shared chunks | 31.7 kB + 53.6 kB (framework + framer-motion) | Expected. |

There is **no bundle-size problem** here. The numbers are already where most teams *aim to get to* after optimization.

## What's already done well (verified in source)
- **Rendering strategy is correct per route:** public/marketing pages are **ISR** (`revalidate = 60` for home & product, `3600` for legal/sitemap); user- and admin-specific pages are `force-dynamic`; product detail pages are **SSG** with `generateStaticParams`. Mutations call `revalidatePath('/', 'layout')` so cached pages refresh on data change — cache without staleness.
- **Images:** `next/image` throughout with `formats: ['image/avif','image/webp']`, tuned `deviceSizes`/`imageSizes` (automatic responsive `srcset`), `priority` on the first banner (LCP), `loading="lazy"` on below-the-fold review images. Remote images restricted to the Blob host.
- **Code splitting / hydration:** heavy libraries (framer-motion, GSAP) live in `'use client'` islands — they don't enter Server-Component payloads. GSAP is registered once (`lib/gsapClient.ts`) and only client-side. `MotionConfig reducedMotion="user"` means reduced-motion users skip animation work entirely.
- **React rendering:** `reactStrictMode: true`; Toast provider memoizes its callbacks (`useCallback`); the `CountUp` animation uses a single `requestAnimationFrame` loop with cleanup (no timer leaks).
- **Database efficiency (this is where real app latency usually hides — it's clean):**
  - Parallelized fetches with `Promise.all` (homepage, account, admin lists).
  - `select` projections and `_count` instead of loading full relations.
  - `groupBy` for the admin order grouping instead of per-group queries — an explicit, commented **N+1 avoidance**.
  - Bounded reads (`take: 100/300`) so no unbounded scans.
  - Pooled Postgres (Neon) connection.
- **API response time:** money paths use short-lived, row-locked `$transaction`s (20 s timeout ceiling) touching only the locked rows; the rate limiter is a single atomic statement and self-cleans expired rows probabilistically (~2% of calls) rather than on every request.
- **Font loading:** single Google-Fonts `@import` with `display=swap` (no invisible-text FOIT).

## Optimization applied this pass (safe, non-visual)
- **Font `preconnect` hints** added to `src/app/layout.tsx` (`fonts.googleapis.com` + `fonts.gstatic.com` crossorigin). The CSS `@import` can't start the font TCP/TLS handshake until the CSS is parsed; preconnect warms that connection earlier, shaving font-fetch latency. Purely additive — no visual, CSP, or logic change. `display=swap` was already present, so text is never blocked.

## Recommendations (not applied — each would be a change with trade-offs, listed honestly)
1. **Self-host fonts via `next/font`** (medium effort, medium win): eliminates the third-party Google round-trip entirely and removes render-blocking `@import`, at the cost of reworking the 5-family font setup and re-verifying Bengali rendering. Deferred because it touches the type system that prior passes tuned for Bengali numerals — not worth risking visual regression right before launch.
2. **Trim the font families** (low effort, low–medium win): 5 families (Space Grotesk, Hind Siliguri, Anek Bangla, Unbounded, Chakra Petch) with many weights is the single biggest *network* cost on first paint. Dropping one display family would cut font bytes with minimal design impact — a design decision, so flagged not forced.
3. **`next/dynamic` for the success-celebration / confetti-style islands** (low win): framer-motion is already in the shared chunk (used broadly), so lazy-loading one-off effects yields little; not worth the complexity now.
4. **Admin list pagination** (see UX report): lists cap at `take: 100/300`. Fine for launch volume and *good* for performance (bounded), but at scale add cursor pagination so old records stay reachable without raising the cap.

## Verdict
Performance is **production-ready as-is**. Bundle sizes are excellent, rendering/caching strategy is correct per-route, images and DB queries are already optimized, and the one safe win available (font preconnect) has been applied. The remaining items are optional refinements, not fixes.
