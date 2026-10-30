/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অ্যাডমিন কেয়স — আসল ব্রাউজারে, আসল বোতামে (Playwright)
 *
 *   `tests/chaos-cross-action.test.ts` HTTP-স্তরে লক প্রমাণ করে। এটি দেখে
 *   **UI** কী করে যখন দুই অ্যাডমিন দুই ট্যাবে একই ডিপোজিটে একজন "অনুমোদন",
 *   অন্যজন "বাতিল" নিশ্চিত করেন একই মুহূর্তে, এবং একজন নিশ্চিতকরণ বোতামে
 *   পাগলের মতো ক্লিক করেন। দাবি:
 *     ১. ঠিক একটি সিদ্ধান্ত DB-তে বসে, টাকা ০ বা ঠিক একবার
 *     ২. হেরে যাওয়া ট্যাব একটি বোধগম্য ত্রুটি-টোস্ট দেখায় (নীরব নয়, ৫০০ নয়)
 *     ৩. খতিয়ান = ব্যালেন্স
 *
 *   চালানো (সিম/যাচাই-রিগে, **কখনো লাইভে নয়**):
 *     VERIFY_BASE=https://localhost:3443 VERIFY_DATABASE_URL=…uidtopup_sim \
 *       npx tsx scripts/verify/admin-chaos-ui.ts
 * ═══════════════════════════════════════════════════════════
 */
// ★ `_db` সবার আগে — নাহলে টেস্ট-সারি লাইভ Neon-এ লেখা হতে পারে
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import type { BrowserContext, Page } from 'playwright-core';
import bcrypt from 'bcryptjs';

const ADMIN = {
  email: process.env.CHAOS_ADMIN_EMAIL || 'admin@uidtopup.local',
  password: process.env.CHAOS_ADMIN_PASSWORD || 'Admin@2026Secure',
};
const ROUNDS = Number(process.env.CHAOS_ROUNDS || 5);
const TAG = `chaos-${Date.now().toString(36)}`;

let pass = 0; const fails: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fails.push(`${name} — ${note}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function adminContext(): Promise<BrowserContext> {
  const browser = await openBrowser();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await db.rateLimitBucket.deleteMany({});
  // ★ context.request কুকি-জার পাতাগুলোর সাথে ভাগ করে — তাই লগইন একবারই
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: ADMIN.email, password: ADMIN.password, json: 'true' },
    maxRedirects: 0, failOnStatusCode: false,
  });
  const s = await (await ctx.request.get(`${BASE}/api/auth/session`)).json();
  if (s?.user?.email !== ADMIN.email) throw new Error('অ্যাডমিন লগইন হয়নি');
  return ctx;
}

async function openQueue(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/deposits`, { waitUntil: 'domcontentloaded' });
  // ★ বুট-ওভারলে = হাইড্রেশন-গেট; এর আগে ক্লিক করলে হ্যান্ডলার বসেনি
  await page.locator('#v-boot').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  return page;
}

/** কার্ড খুঁজে, দরকার হলে সব ঝুঁকি-সতর্কতায় টিক দিয়ে, ডায়ালগ খোলা */
async function openDialog(page: Page, depositNo: number, action: 'APPROVE' | 'REJECT') {
  const card = page.locator(`article[aria-label="ডিপোজিট #${depositNo}"]`);
  await card.waitFor({ timeout: 20_000 });
  for (const box of await card.locator('input[type=checkbox]').all()) await box.check();
  await card.getByRole('button', { name: action === 'APPROVE' ? /অনুমোদন/ : /বাতিল/ }).click();
  return page.getByRole('button', { name: action === 'APPROVE' ? 'হ্যাঁ, অনুমোদন করুন' : 'হ্যাঁ, বাতিল করুন' });
}

async function toastText(page: Page): Promise<string> {
  await page.waitForTimeout(1500);
  return (await page.locator('[role=status], [role=alert]').allInnerTexts().catch(() => [])).join(' | ');
}

async function ledgerOk(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
  const s = await db.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return { ok: Math.abs(Number(u.balance) - Number(s._sum.amount ?? 0)) < 0.001, bal: Number(u.balance) };
}

async function main() {
  console.log(`═══ অ্যাডমিন কেয়স (UI) · ${BASE} · DB ${dbLabel()} · rounds=${ROUNDS} ═══`);
  const hash = await bcrypt.hash('ChaosCustomer2026x', 10);
  const [ctxA, ctxB] = [await adminContext(), await adminContext()];

  for (let r = 0; r < ROUNDS; r++) {
    const user = await db.user.create({
      data: {
        name: `Chaos ${r}`, email: `${TAG}-${r}@chaos.invalid`, password: hash,
        phone: `0171${String(Date.now()).slice(-7)}`, referralCode: `${TAG}${r}`.toUpperCase().slice(0, 16),
      },
    });
    const dep = await db.deposit.create({
      data: {
        userId: user.id, method: 'BKASH', amount: 250, senderNo: user.phone ?? '01712345678',
        trxId: `CH${Date.now().toString(36).toUpperCase()}${r}`, status: 'PENDING',
      },
    });

    const [pA, pB] = await Promise.all([openQueue(ctxA), openQueue(ctxB)]);
    const [okA, okB] = await Promise.all([openDialog(pA, dep.depositNo, 'APPROVE'), openDialog(pB, dep.depositNo, 'REJECT')]);

    // ★ একই মুহূর্তে দুই ট্যাবে নিশ্চিত — A তিনবার (পাগল-ক্লিক), B একবার
    await Promise.all([
      okA.click({ clickCount: 3, force: true }).catch(() => {}),
      okB.click({ force: true }).catch(() => {}),
    ]);
    const [tA, tB] = await Promise.all([toastText(pA), toastText(pB)]);

    const final = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    const credits = await db.ledgerEntry.count({ where: { refId: dep.id, type: 'DEPOSIT' } });
    const { ok, bal } = await ledgerOk(user.id);

    check(`R${r} একটিই সিদ্ধান্ত`, final.status === 'APPROVED' ? credits === 1 && bal === 250 : final.status === 'REJECTED' && credits === 0 && bal === 0,
      `status=${final.status} credits=${credits} bal=${bal}`);
    check(`R${r} খতিয়ান = ব্যালেন্স`, ok);
    check(`R${r} হেরে যাওয়া ট্যাব স্পষ্ট বার্তা পায়`, /আগেই প্রসেস/.test(tA + tB), `A="${tA}" B="${tB}"`);
    check(`R${r} কোনো ট্যাবে ৫০০-ধাঁচের বার্তা নেই`, !/Internal|500|সার্ভারে সমস্যা/i.test(tA + tB));

    // ★ বোনাস: একই পাতা থেকে ১০টি কাঁচা fetch (ডেভটুলস-ওয়ালা অ্যাডমিন)
    const dep2 = await db.deposit.create({
      data: { userId: user.id, method: 'NAGAD', amount: 100, senderNo: '01712345678', trxId: `CZ${Date.now().toString(36).toUpperCase()}${r}`, status: 'PENDING' },
    });
    const before = (await ledgerOk(user.id)).bal;
    const codes = await pA.evaluate(async (id) => {
      const one = (action: string) => fetch('/api/admin/deposit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: id, action, ...(action === 'REJECT' ? { rejectReason: 'TRX_NOT_FOUND' } : {}) }),
      }).then((x) => x.status);
      return Promise.all(Array.from({ length: 10 }, (_, i) => one(i % 2 ? 'REJECT' : 'APPROVE')));
    }, dep2.id);
    const after = await ledgerOk(user.id);
    check(`R${r} ১০টি কাঁচা fetch → একটি 200`, codes.filter((c) => c === 200).length === 1 && codes.every((c) => c === 200 || c === 409), codes.join(','));
    check(`R${r} ফলে ব্যালেন্স +০ বা +১০০`, [before, before + 100].includes(after.bal) && after.ok, `${before}→${after.bal}`);

    await Promise.all([pA.close(), pB.close()]);
  }

  console.log(`\n═══ ফল: ${pass} PASS · ${fails.length} FAIL ═══`);
  fails.forEach((f) => console.log(`  ✗ ${f}`));
  await Promise.all([ctxA.browser()?.close(), ctxB.browser()?.close()]);
  await db.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
