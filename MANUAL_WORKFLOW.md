# MANUAL_WORKFLOW.md

**The ideal manual top-up workflow — customer journey and admin operations**

**Date:** 2026-07-18
**Status:** Design proposal. Nothing here is implemented.
**Premise:** Manual verification is treated as a **deliberate product choice**, not a limitation to apologise for. A human checking a real bank transaction before money moves is a genuine fraud control. The design goal is to make that human step *invisible in latency* and *visible in trustworthiness*.

---

# PART A — CUSTOMER JOURNEY

## A0. The Governing Insight

In a manual-fulfilment business the customer is not buying diamonds. They are buying **certainty that a stranger on the internet will honour a bKash transfer.**

Every design decision below follows from that. The competitive axis is not price or speed — it is *confidence per second of waiting*.

Three anxieties dominate, in order:
1. **"Will I get it at all?"** → answered by proof and status
2. **"Did I enter the right UID?"** → answered by validation
3. **"How long?"** → answered by a stated SLA and a live countdown

---

## A1. Journey Map

```
DISCOVER → SELECT → VALIDATE UID → PAY → CONFIRM → WAIT → RECEIVE → RETURN
   │         │           │           │       │        │        │        │
 trust    clarity    certainty   guidance  receipt  progress  proof   habit
```

The two steps competitors under-build are **VALIDATE UID** and **WAIT**. Both are pure-confidence steps that move no money and are cheap to build.

---

## A2. Stage 1 — Discover

**Goal:** convert scepticism into "this is a real business".

Above the fold, in priority order:
1. **What you sell + who for** — unambiguous, one line
2. **Real proof** — recent verified order count, real review excerpts. Never a round unverifiable number.
3. **Named payment rails** — bKash / Nagad / Rocket / Upay logos
4. **A stated SLA** — "typically 10–30 minutes, guaranteed within 2 hours"
5. **A visible human** — support hours, a real phone number, a response-time promise

**Trust-first ordering matters.** A returning customer scrolls past proof to the product grid; a first-timer needs it. Optimise for the first-timer, because the returning customer navigates by muscle memory anyway.

**Live operational honesty:** if fulfilment is currently slow (admin asleep, high queue), say so. A banner reading "orders currently taking ~45 min — we're catching up" converts *far* better than silence followed by a late delivery. Under-promise publicly, over-deliver privately.

---

## A3. Stage 2 — Select

**Goal:** get to a chosen package in as few decisions as possible.

- **Category → product → package**, never deeper.
- **Package grid, 2 columns on mobile.** Diamond count large, price large, nothing else competing.
- **Per-package delivery badge** — honest and per-SKU (`~10 min`, `~30 min`, `Out of stock`). Never a blanket "Instant" on a manual system.
- **Anchor pricing**: show `oldPrice` strikethrough only where genuinely true. A fake anchor is detectable and destroys the trust built in Stage 1.
- **Highlight one "most popular" tier** — reduces choice paralysis in a 20+ tier grid.
- **Value hint on large tiers** — "৳0.63 per diamond" makes bulk tiers self-justifying and lifts average order value honestly.
- **Sold-out shown, not hidden** — proves the catalogue is maintained.

---

## A4. Stage 3 — Validate UID ★ the highest-value step

**Goal:** eliminate the only unrecoverable failure in the business.

```
[ Player UID: 123456789 ]  [ Verify ]
        ↓
   ✓ ProGamerBD
   Is this your account?  [ Yes, continue ]  [ No, re-enter ]
```

**Why this matters more than anything else in this document:**

Wrong-UID delivery is unrecoverable. The diamonds land in a stranger's account; there is no clawback. The customer loses money, blames the merchant, and posts publicly. Every competitor except uidtopup handles this with a disclaimer — which allocates blame but prevents nothing.

**Design requirements:**
- Verification is a **hard gate** before payment for any product where a lookup is available.
- Returned name shown **large and unmissable**, with explicit yes/no confirmation.
- The verified name is **stored on the order** and shown to the admin at fulfilment — a second checkpoint.
- **Graceful degradation:** if the lookup API is unavailable, fall back to double-entry (type the UID twice) plus the existing disclaimer. Never block sales on a third-party outage.
- **Recently used UIDs** offered as one-tap chips for returning customers — most people top up the same account repeatedly.

**Expected effect:** near-elimination of the largest refund category, the largest support-ticket category, and the most reputation-damaging failure mode.

---

## A5. Stage 4 — Pay

Two paths, offered side by side. **Never force wallet prepay for a first purchase.**

### Path 1 — Direct Pay (default for new customers)
For a customer buying one ৳78 package, asking them to prepay into a wallet is an unjustifiable trust demand.

1. Exact amount displayed prominently — `৳78`
2. Destination number with **one-tap copy** and the account type (Personal/Agent)
3. Explicit method warning — *Send Money*, not *Cash Out*
4. Fields: **TrxID** and **sender number**
5. Optional screenshot upload — clearly labelled as *speeds up approval*
6. Submit

### Path 2 — Wallet (default for returning customers)
Balance already verified → **one-tap order, zero payment friction.** This is the entire strategic point of the wallet: the *second* purchase should take five seconds.

### Making the wallet earn its prepay
The wallet must be sold on customer benefit, not merchant convenience:
- **Instant ordering** — no waiting for verification on future orders
- **Small top-up bonus** — e.g. +2% on ৳1000+ (funded by the retention gain)
- **Refunds return to wallet instantly** — versus a bank-refund conversation

### Friction reducers that matter
- **Amount echoed everywhere** — the number to send appears at least twice, identically
- **Copy button on the account number** — typing a phone number wrong is a real failure mode
- **TrxID format hint + live shape validation** — catch a malformed ID before submission, not after
- **Duplicate-TrxID check on blur** — tell them immediately, not after they wait 20 minutes
- **Never clear the form on error** — losing a typed TrxID is infuriating

---

## A6. Stage 5 — Confirm (the receipt moment)

**Goal:** convert "I sent money into the void" into "this is being handled".

The instant a claim is submitted, show a **receipt** — not a toast that disappears:

```
Order #1043 received
Free Fire [BD SERVER] — 240 Diamond
Player: ProGamerBD (123456789)     ← verified name, reassuring
Amount: ৳158
TrxID: 9A7B2C4D1E

Status: Verifying your payment
Expected delivery: within 30 minutes  (typical: 12 min)

[ Track this order ]  [ Save receipt ]  [ Contact support ]
```

**Requirements:**
- A **persistent, linkable** page — not an ephemeral notification
- The **expected delivery window stated as a time, not a vague promise**
- Support escalation available **from the receipt** — the moment anxiety peaks
- Delivered simultaneously to **in-app notification + email + (ideally) SMS**

---

## A7. Stage 6 — Wait (where trust is won or lost)

This is the stage every competitor neglects. It is also the cheapest to build well, because **nothing is happening** — it is pure communication design.

### A visible status pipeline
```
✓ Payment claim received      11:42
✓ Payment verified            11:47      ← admin approved
◉ Delivering to your account  in progress
○ Complete
```

Four honest states, each timestamped. The customer can see exactly where they are.

### Supporting mechanics
- **Live countdown to the SLA deadline**, not an open-ended spinner
- **Auto-refresh** on the order page (already built in this project via `AutoRefresh`)
- **Push/email at every transition** — never make them come back to check
- **If the SLA is breached, the system apologises first.** An automatic message at deadline+1min ("we're running late, here's why, here's your compensation") pre-empts the angry ticket. Being told you're late by the merchant is a completely different experience from discovering it yourself.
- **Support link carries full order context** — the customer should never have to re-type their TrxID

### On rejection
A rejected payment claim is the highest-risk moment in the entire system — the customer believes they paid. It must be handled with maximum care:
- **A specific reason, never a generic failure** — "TrxID not found in our bKash statement", "amount received ৳150, order was ৳158"
- **A clear remedy** — "reply with your payment screenshot and we'll re-check"
- **A direct human escalation path**
- **Never** a bare "Rejected" with no explanation

---

## A8. Stage 7 — Receive

- **Completion notification within seconds** of the admin marking delivery
- **In-game confirmation prompt**: "Did the diamonds arrive?" `Yes` / `No, help me`
  - `Yes` → **immediately request a review** (peak satisfaction is the only good moment to ask)
  - `No` → **open a support thread pre-filled with the full order context**
- This single question closes the loop, catches failures the admin cannot see, and harvests the social proof identified as the top trust asset in the competitor analysis.

---

## A9. Stage 8 — Return (repeat purchase)

Retention is where a manual business becomes profitable — the trust cost is paid once.

- **Reorder in one tap** — same product, same package, same UID, wallet-funded
- **Saved UIDs** as selectable chips
- **Referral prompt at peak satisfaction** — immediately after a confirmed successful delivery, never before
- **Wallet balance visible in the header** as a standing invitation
- **Re-engagement via owned channels** (Telegram/Messenger) — restock alerts, event offers. Free, unlike ads.
- **Loyalty on volume, not gimmicks** — e.g. every 10th order gets a bonus; simple, honest, and it makes the wallet stickier

---

## A10. Cross-Cutting Customer Requirements

| Requirement | Rationale |
|---|---|
| **Mobile-first, bottom tab bar** | Traffic is overwhelmingly mobile |
| **Bengali-first, English secondary** | Matches the audience |
| **Every money figure identical everywhere** | One rounding inconsistency destroys trust |
| **Every state has an empty/loading/error design** | Manual systems have many in-between states |
| **Order history is permanent and complete** | It is the customer's receipt archive |
| **Support reachable from every order** | Context-free support requests waste both sides' time |
| **No dead ends** | Every failure screen offers a next action |

---

# PART B — ADMIN WORKFLOW

## B0. The Governing Insight

**The admin is the bottleneck, and the admin is a single person on a phone.**

Customer-perceived speed is entirely a function of admin throughput. Therefore admin ergonomics are not an internal nicety — they are a *customer-facing performance feature*. Every second removed from verification is a second removed from every waiting customer.

Design target: **a deposit verified in under 10 seconds, on a phone, one-handed.**

---

## B1. Deposit Verification — the critical path

### The real-world loop today
```
See notification → open admin → find deposit → open bKash app →
search TrxID → compare amount → compare sender → return → approve
```
The expensive part is **app-switching and manual comparison**, not clicking.

### Design principles

**1. Queue, not table.** Default view is a single-column queue of *pending* items, oldest first, one card per screen on mobile. Not a spreadsheet requiring horizontal scroll.

**2. All comparison data on one card** — TrxID, amount, sender number, method, customer name, customer history, screenshot thumbnail. **Zero scrolling to decide.**

**3. One-tap copy on the TrxID** — it will be pasted into the banking app every single time.

**4. Auto-surface risk signals** — the admin should be *told* what's unusual, not have to notice it:
   - `⚠ First-time customer`
   - `⚠ Sender number ≠ registered phone`
   - `⚠ 3rd claim in 10 minutes`
   - `⚠ Amount is unusual for this customer`
   - `✓ Trusted — 14 successful deposits`

**5. Trust-graded flow.** A customer with 14 clean deposits and a matching sender number should be approvable in one tap. A first-timer with a mismatched number should demand deliberate review. **Uniform friction on every item is wasted admin time.**

**6. Approve must be one tap; reject must require a reason.** Asymmetric friction, deliberately — rejection is the customer-damaging action.

**7. Structured rejection reasons** — a picklist (`TrxID not found`, `amount mismatch`, `duplicate`, `unclear screenshot`) that generates a specific, helpful customer message automatically. This is where generic rejections come from today: writing a good message by hand every time is too slow, so nobody does it.

**8. Keyboard shortcuts on desktop** — `J/K` navigate, `A` approve, `R` reject. A power admin clearing 50 deposits should never touch a mouse.

### Bulk operations — carefully bounded
Bulk **approve** on money-in is dangerous and should be restricted to a filtered, explicitly-selected set with a confirmation showing the **total value** being approved. Blind "approve all" must not exist.

Bulk operations that *are* safe and valuable:
- Bulk **mark orders as processing** (claiming a batch to work)
- Bulk **complete** after a fulfilment session
- Bulk **notify** ("all pending orders delayed 30 min")

---

## B2. Order Fulfilment

The admin's real loop is: read UID → switch to the game/panel → deliver → return → mark complete.

- **Copy-UID button** — the single most-used control on the page
- **Show the verified player name** beside the UID — the second checkpoint against mis-delivery
- **Claim/lock an order** while working it — essential the moment there is more than one admin
- **Complete / Fail with a required note on failure**
- **Failure auto-refunds atomically** (already correct in this codebase)
- **Group the queue by product** — batching 12 Free Fire top-ups is far faster than context-switching between games
- **Internal notes** invisible to the customer, for admin-to-admin context

---

## B3. Search — one box, everything

A single global search resolving: order number, deposit number, TrxID, phone, email, Player UID, customer name.

The dominant real-world query is a support message: *"I sent money, TrxID 9A7B2C4D1E, where is it?"* — the admin must be able to paste that string into one box and land on the answer.

**A customer's full history must be one click from any of their records** — orders, deposits, ledger, notes, all on one screen.

---

## B4. Refunds

- **Refund is always atomic across balance + stock + coupon** (already correct here)
- **Reason mandatory**, from a structured list
- **Customer notified immediately** with the reason
- **Refunds go to wallet by default** (instant, retains the customer); bank refund as an explicit exception
- **Full reversal visible in the ledger** — never a silent balance edit
- **Partial refunds** for partial delivery (e.g. an SMM order half-fulfilled)

---

## B5. Audit Logs

Already strong in this codebase (`AdminLog` with actor/action/target/amount/IP). To reach ideal:

- **Cover every admin route** — currently product/variant/coupon/banner/settings routes do not log
- **Filterable by admin, action type, date, customer**
- **Immutable and exportable** — the record of resort in a payment dispute
- **Every money movement traceable to a named human and a timestamp**
- **Surface a per-customer log view** — "everything any admin ever did to this account"

---

## B6. Support Workflow

- **Every support conversation opens with full order context** attached
- **Customer timeline view**: orders, deposits, notes, refunds, prior tickets on one screen
- **Canned responses** for the top 5 recurring situations
- **Escalation flags** for money disputes
- **Link the ticket to the order** so resolution updates order state

---

## B7. Operational Awareness

The admin needs a dashboard answering, at a glance:

| Question | Why |
|---|---|
| How many pending deposits, and how old is the oldest? | SLA risk |
| How many pending orders, oldest age? | SLA risk |
| Any order past SLA **right now**? | Immediate action |
| Today: revenue, order count, approval rate | Business health |
| Rejection rate trending up? | Fraud attempt or a broken payment number |
| Stock nearing zero? | Prevent overselling |

**SLA breach must be an alarm, not a number on a dashboard.** If an order is 90 minutes old and unfulfilled, the admin should be pushed a notification — the customer certainly noticed.

### Coverage-gap honesty
A one-person manual operation cannot be online 24/7, but competitors advertise "24/7". The honest and higher-converting approach:
- **Publish real operating hours**
- **Show live status** — "Verifying now" vs "Offline until 9am — orders queued"
- **Extend the promised SLA automatically outside hours** rather than silently missing it

A customer told "your order will be delivered at 9am" is satisfied. A customer promised 30 minutes at 3am is a refund request and a bad review.

---

## B8. Fraud Controls (manual-specific)

The manual model's strength is the human check. Support it with data:

- **Duplicate TrxID rejection** (already implemented)
- **Flag sender-number mismatches** against the registered phone
- **Velocity limits** — N claims per user per hour
- **Flag new accounts making large first deposits**
- **Retain screenshots** as dispute evidence
- **Never auto-approve on client-supplied data** — the entire security model rests on this, and it must remain non-negotiable

---

## B9. Admin Ergonomics Summary

| Principle | Consequence |
|---|---|
| Admin speed *is* customer speed | Optimise the queue like a customer-facing funnel |
| Mobile-first for admin too | Verification happens on a phone, in a shop, on a bus |
| One-tap approve, deliberate reject | Asymmetric friction toward customer safety |
| Surface risk, don't make them hunt it | Humans miss patterns; systems don't |
| Structured reasons over free text | Good customer messaging must be the fast path |
| Everything money-related is logged | Disputes are inevitable |
| Never batch-approve money blindly | The one place friction is a feature |
