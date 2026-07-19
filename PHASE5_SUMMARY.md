# PHASE 5 — SUMMARY

**Status:** Partially complete and closed at the owner's direction.
**Date closed:** 2026-07-20
**Scope rule applied:** work was implemented only where it could be completed *honestly* — without
inventing business values, fabricating content, or building placeholder logic.

---

## 1. What was delivered

| ID | Task | Status |
|---|---|---|
| **5.1** | On-page reviews (display half) | ✅ Complete — verified |
| **5.11** | Status badges (Sold Out / discount) | ✅ Complete — verified |
| **5.12** | Related items cross-sell | ✅ Complete — verified |
| **5.4** | Referral prompt at peak satisfaction | ⚠️ Built — **not browser-verified** (see §3) |

Nothing else in Phase 5 was started. No partial or placeholder implementations were left in the
codebase.

---

## 2. Work found already complete (not redone)

A survey before writing code found two tasks were already partly built. They were **not**
re-implemented, and the pre-existing work was left untouched:

- **5.11** — `OrderForm` already rendered `স্টক শেষ`, strikethrough `oldPrice`, `জনপ্রিয়`, and a
  low-stock warning at the **variant** level. Only the **catalogue-card** level was missing, and
  only that was added.
- **5.1 (submission half)** — the `Review` model, `POST /api/review`, and the rating form in
  `DeliveryConfirm` all shipped in Phase 2. Reviews were being **collected but displayed nowhere**,
  so the trust-building purpose was never actually served. Only the display half was added.

---

## 3. Detail of delivered work

### 5.1 — Review display
Product pages now show the average rating, the review count, and the six most recent published
reviews.

- **No "verified purchase" badge.** `/api/review` already makes an unverified review impossible
  (must be the customer's own order, `COMPLETED`, customer-confirmed, one per order). A badge would
  be decoration, not information.
- **Privacy:** only the customer's **first name** is displayed. They consented to leaving feedback,
  not to publishing their full name.
- **Renders nothing when a product has no reviews.** "No reviews yet" harms a new product while
  conveying nothing.

**Verified** against real data (one published 5-star review on product 1): stars, average, count,
body, and first-name truncation all render correctly.

### 5.11 — Catalogue status badges
Flags are computed **server-side** and passed to the client as two primitives (`soldOut`,
`discountPct`) rather than shipping variant rows (CLAUDE.md §7, §15). Only three variant fields are
selected.

Three deliberate rules:

- **`সব শেষ` outranks the discount badge** — advertising a discount on something unbuyable is a
  cruel joke.
- **A product with zero variants is not "sold out"** — that is a different state (no packages
  configured), and a false "Sold Out" is worse than no badge.
- **Discount % ignores out-of-stock variants** — a discount you cannot buy is not a discount.

> **`stock = -1` means untracked/unlimited in this codebase**, not negative stock. The new logic
> uses `=== 0` exactly, matching `OrderForm`'s existing convention.

**Verified** via temporary QA data (the live catalogue had zero sold-out and zero discounted
variants). Data was captured, mutated, verified, then **restored and confirmed field-by-field**.
Badges disappearing after the restore also proves they are data-driven rather than hardcoded.

### 5.12 — Related items
Same-category products, current one excluded, capped at 4, rendered as a Server Component (zero
client JS).

**No recommendation algorithm — deliberately.** Click/purchase-history recommendations would
require data this site does not collect, and at this catalogue size would produce noise rather than
relevance.

### 5.4 — Referral prompt
Placed in the post-review success state — the customer has just received their order **and** rated
it. That is the one point where asking for a referral is not presumptuous.

**Deliberately not shown** before ordering or while awaiting delivery. Asking someone to recommend
you before you have delivered is how trust is lost.

`referralCode` is passed from the server via a single-field `select` (CLAUDE.md §8), not fetched
client-side.

---

## 4. Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ Pass |
| `npm run build` | ✅ Pass |
| Playwright — 5.1 review section (real data) | ✅ |
| Playwright — 5.11 both badges + absence after restore | ✅ |
| Playwright — 5.12 related section, current product excluded | ✅ |
| Playwright — 5.4 | ❌ **Not performed** |

> **⚠️ 5.4 is unverified in the browser.** Its prompt only appears after a specific customer both
> confirms delivery *and* submits a review, which requires authenticating as that customer. Their
> password is not known, and resetting it to enable a test would be a destructive change to real
> account data. The code passes typecheck, lint and build — that is not the same as a live run.
>
> **To close this:** provide a test login, or authorise creating a throwaway account.

---

## 5. Remaining Phase 5 items — classified

**None of the following were implemented. None are marked complete.**

### 5a. Business decision required

| ID | Task | Decision needed |
|---|---|---|
| **5.5** | Wallet top-up bonus | Bonus percentage, qualifying thresholds, per-user caps, abuse limits. **These are financial policy.** Inventing a percentage would be inventing business policy with real money consequences. |
| **5.6** | Loyalty (every 10th order) | Reward value and qualifying rules. Depends on 5.5. |
| **5.2** | Catalogue depth + bundles | Which products, at what prices, in what bundles. This is merchandising, not engineering. |
| **5.13** | Dual-currency display | Which currency, and **the rate source**. A hardcoded rate silently goes stale and misprices the catalogue. |

### 5b. External dependency

| ID | Task | Dependency |
|---|---|---|
| **5.3** | Telegram / Messenger channel | The actual channel must exist, and someone must staff it. A support channel nobody answers is worse than none. |
| **5.7** | Per-product tutorial videos | Real video URLs. |
| **5.8** | Bengali SEO blog | Written content + content strategy. XL scope. |

### 5c. Future enhancement

| ID | Task | Note |
|---|---|---|
| **5.14** | Native app wrapper | XL; lives outside this codebase. Best revisited once the web product is stable in production. |

### 5d. Conflicts with a prior decision — not future work

| ID | Task | Conflict |
|---|---|---|
| **5.9** | Reseller API + scoped keys | Introduces a **second privileged tier**, directly contradicting the single-administrative-role decision recorded in roadmap 4.10, `CLAUDE.md` §13, and `AUDIT_REPORT.md` L8. |
| **5.10** | Affiliate programme | Depends on 5.9; inherits the same conflict. |

> These two are **not** "not done yet." Building them would reverse a decision the owner made
> deliberately. They require an explicit reversal of that decision before they can be considered.

---

## 6. Final state

**Delivered: 3 verified, 1 pending verification. Blocked: 8. Conflicting: 2.**

No placeholder business logic, invented values, or stub implementations were introduced anywhere in
the codebase.
