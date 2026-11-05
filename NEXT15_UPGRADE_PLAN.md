# Next.js 14 → 15 নিরাপত্তা-আপগ্রেড পরিকল্পনা (২০২৬-০৯-২৬)

> এটি **পরিকল্পনা মাত্র** — কোনো নির্ভরতা বদলানো হয়নি। major আপগ্রেড মালিকের অনুমোদনের পরে, আলাদা শাখায়।

## ১. বর্তমান অবস্থা (মাপা, `npm audit`)
- ইনস্টল করা: `next@14.2.35` — এটিই 14.x-এর শেষ; **14.x-এ কোনো প্যাচ নেই**।
- সব Next advisory ঠিক হয়েছে কেবল **15.5.x**-এ; critical দুটি `< 15.5.24`:
  - GHSA-p293-qw3h-jr36 — Windows-হোস্টেড সার্ভারে RCE → **প্রযোজ্য নয়** (Vercel = Linux)। স্থানীয় Windows ডেভে প্রযোজ্য।
  - GHSA-2xp9-vwfh-vxw4 — Image Optimizer + AVIF-এ RCE → **প্রশমিত**: `next.config.js` `images.formats = ['image/webp']` (AVIF বন্ধ)।
- প্রযোজ্য ও খোলা (high/moderate): CSP-nonce App Router-এ XSS (GHSA-ffhc-5mcf-pf4q — অ্যাপ nonce ব্যবহার করে), Server Components DoS (GHSA-q4gf, GHSA-8h8q), RSC cache poisoning (GHSA-wfc6), Image Optimizer DoS (GHSA-h64f, GHSA-9g9p — `remotePatterns` আছে)।
- প্রযোজ্য নয় (কোডে যাচাই): Server Actions (`'use server'` নেই), Pages Router/i18n (`src/pages` নেই), custom server, rewrites, WebSocket upgrade।
- dev-নির্ভরতা: `vitest@2` (critical, `<=4.1.10`) ও `eslint-config-next@14` — কেবল ডেভ/CI; প্রোডাকশন বান্ডলে নয়।

## ২. লক্ষ্য
`next@15.5.24` (বা তার পরের 15.5.x) + `eslint-config-next@15.5.x`; React 19 (Next 15 App Router-এর প্রয়োজন)। Next 16-এ লাফ নয় — ধাপে ধাপে।

## ৩. জানা ভাঙন-বিন্দু (এই কোডবেসে খুঁজতে হবে)
1. **Async request APIs** — `cookies()`, `headers()`, `draftMode()` এখন Promise; `params`/`searchParams` পাতায় ও route-এ Promise। (যেমন `app/account/orders/[id]/page.tsx`-এর `params.id`, `api/account/password`-এর `cookies()`)। codemod: `npx @next/codemod@canary next-async-request-api`।
2. **fetch/GET route cache ডিফল্ট বদল** — Next 15-এ GET route handler ও `fetch` ডিফল্টে cache হয় না (এই প্রকল্প বেশিরভাগ `force-dynamic`, তবু ISR পাতা যাচাই)।
3. **React 19** — `useFormState` → `useActionState`, ref-as-prop, কিছু টাইপ বদল; framer-motion/next-auth-এর React 19 সামঞ্জস্য দেখতে হবে।
4. **next-auth v4** — Next 15-এ চলে, কিন্তু `getServerSession`/`getToken`-এর ভেতরে `cookies()` async সতর্কতা যাচাই।
5. **middleware** — CSP nonce-পথ (`src/middleware.ts`) ও `authCookies` নাম; edge runtime আচরণ।
6. **Image config** — `images.remotePatterns` (UPL-01 blob-হোস্ট) ও `formats` অপরিবর্তিত রাখা।

## ৪. নিরাপদ ধাপ
1. আলাদা শাখা; `npm i next@15.5.24 react@19 react-dom@19 eslint-config-next@15.5.24` + `@types/react@19`।
2. codemod চালানো, তারপর `npm run typecheck` — প্রতিটি ত্রুটি হাতে দেখা (auth/টাকার পথ বিশেষভাবে)।
3. `npm test` (৫০০+), `npm run lint`, `npm run build`।
4. mirror-এ প্রোডাকশন রিগ + TLS: `scripts/verify/*` (prod-auth-e2e, customer/admin journey, security-probes, csp-nonce, upload-security, route-guard-audit) ও Phase-1 smoke।
5. Vercel preview deploy-এ কেবল পড়া-পথ যাচাই → তারপর প্রোডাকশন।
6. রোলব্যাক: আগের `package-lock.json` কমিটে ফেরা (DB স্কিমা এতে জড়িত নয়)।

## ৫. ঝুঁকি
- মাঝারি–উচ্চ: async request API বদল অথ-পথে (`requireUser`, পাতা-গার্ড, password route-এর কুকি-পুনঃইস্যু)।
- মাঝারি: React 19-এর সাথে তৃতীয়-পক্ষ UI লাইব্রেরি।
- কম: Prisma/DB — অপরিবর্তিত।
