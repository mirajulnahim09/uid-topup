# PAYMENT_ARCHITECTURE_REPORT.md

**Project:** UID TopUp (v2)
**Date:** 2026-07-31
**Goal:** a modular, SOLID, provider-based payment + fulfillment architecture that supports future automatic gateways **without major refactoring** — while keeping the current **manual** model and the **proven money engine** exactly as-is.

> Guardrail honored: reviewed the settings/deposit/refund mechanics first, designed against reality, and did **not** touch the money-moving code paths. No live gateway was implemented — only the architecture.

---

## 1. What was built

### 1.1 Payment Provider abstraction (`src/lib/payments/`)
- **`types.ts`** — the single contract business logic depends on (Dependency Inversion):
  - `PaymentProvider` interface: `id`, `label`, `kind` (`MANUAL`|`GATEWAY`), `capabilities`, `isConfigured()`, `verify(intent)`, `refund(args)`.
  - `ProviderCapabilities` (interface-segregation): `autoVerify`, `autoRefund`, `hostedCheckout`.
  - `PaymentIntent`, `VerifyOutcome` (`PENDING_MANUAL`|`VERIFIED`|`FAILED`), `RefundOutcome` (`MANUAL`|`REFUNDED`|`FAILED`), `ProviderInfo` (serializable for UI).
- **`providers/manual.ts`** — the concrete **Manual** provider: `verify()` → `PENDING_MANUAL`, `refund()` → `MANUAL`, always configured. This *formalizes the current human-verified flow* without changing it.
- **`providers/gatewayStub.ts`** — a factory for **future gateways**: `isConfigured()` derives from env keys; `verify()`/`refund()` throw a clear "ready but inactive" error until an SDK is dropped in. **Impossible to accidentally move money through a half-built gateway.**
- **`registry.ts`** — the one place providers are listed (**Open/Closed**): Manual + stubs for **bKash, Nagad, Rocket, SSLCommerz, Stripe, PayPal, Razorpay**. Exposes `getProvider`, `allProviders`, `enabledProviders`, `isProviderEnabled`, `providerInfos`. Enable/disable is settings-backed (`provider_<id>_enabled`, manual default-on).
  - **Adding a real gateway = one line here + fill the stub's `verify()`/`refund()` — no other code changes.**

### 1.2 Fulfillment policy (`src/lib/fulfillment/policy.ts`)
- `FulfillmentConfig` (`paymentMode` manual/automatic/hybrid; `depositApproval`/`orderApproval`/`refundMode` manual/automatic), read from settings, **defaults to manual**, invalid values normalized to manual.
- Decision functions: `decideDepositApproval`, `decideOrderApproval`, `decideRefund`.
- **Invariant safety rule:** a flow goes automatic **only if** the admin set that mode **and** a provider both *supports* the capability *and* is *configured*. Since no gateway is configured today, **every decision resolves to `manual`** → the proven money model is byte-for-byte unchanged.

### 1.3 Admin configuration (no code change to switch behaviour)
- **`/admin/payments`** page + **`FulfillmentSettings`** component + **"পেমেন্ট" nav tab**: segmented toggles for Payment/Deposit/Order/Refund modes, and per-provider enable switches with `MANUAL`/`GATEWAY` + `configured` badges and capability chips. A warning banner makes the "automatic safely falls back to manual" rule explicit.
- Persists via the **existing** `/api/admin/settings` route (added the new keys to its allow-list; audit-logged like all settings).

### 1.4 The integration seam (wired, safe, no-op today)
- In `api/deposit/route.ts`, after the deposit is recorded, a **guarded** consultation (`getFulfillmentConfig` + `decideDepositApproval(cfg, getProvider('manual'))`) marks exactly where a future gateway's `verify()` → auto-approve would plug in. It is wrapped in `try/catch` and, because the manual provider has `autoVerify=false`, the auto-branch is **unreachable today** — behaviour is identical to before.

---

## 2. Why this is SOLID
- **S** — each file has one job: a provider verifies/refunds; the registry lists; the policy decides; the UI configures.
- **O** — new providers/modes extend via one registry line + a settings value; core flows untouched.
- **L** — every provider is substitutable behind `PaymentProvider`; Manual and future gateways obey the same contract.
- **I** — `ProviderCapabilities` lets a provider declare only what it supports (a manual provider isn't forced to implement auto-refund meaningfully).
- **D** — business logic depends on the `PaymentProvider` interface + policy, never on a concrete gateway.

---

## 3. Verification
| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `next lint` | ✅ no warnings/errors |
| `next build` | ✅ 75 pages (`/admin/payments` compiled) |
| **`npm run test:money`** | ✅ **18 / 18** — proves the deposit seam did **not** regress the money model |
| Playwright — `/admin/payments` | ✅ renders: mode toggles (all manual), provider list (Manual on; gateways "not configured", off), safety banner |

---

## 4. How to add a real gateway later (the payoff)
1. Fill `verify()`/`refund()` in that gateway (replace the stub, or add `providers/<id>.ts`) using its SDK.
2. Set its env keys (e.g. `STRIPE_SECRET_KEY`) → `isConfigured()` becomes true.
3. In `/admin/payments`: enable the provider and set the relevant mode to **Automatic**.
4. The existing flows now route through it automatically — **no changes to deposit/order/refund business logic.**

*(Deposit auto-approval already has its seam; order auto-delivery and programmatic refunds have decision functions ready — wire their execution the same way when a gateway exists.)*

## 5. Limitations (honest)
- **No live gateway is implemented** — by design; all non-manual providers are structural stubs that throw until their SDK + keys are added.
- The order-auto-delivery and auto-refund **execution** paths are prepared (policy + capabilities) but intentionally not wired to money moves, since there is no gateway to verify against yet.
- Gateway env-var names are conventions in `registry.ts`; adjust to match the SDK you integrate.

## 6. Result
A production-quality, provider-based payment architecture is in place: manual today, gateway-ready tomorrow, admin-configurable, SOLID, and **verified not to disturb the money engine (18/18 invariants)**. Dev server and headed preview remain live.
