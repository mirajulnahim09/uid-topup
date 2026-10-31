/**
 * Probe (audit 2026-10-31): after login from /login?callbackUrl=/product/…,
 * where does the browser land, and what does the page say? Diagnoses the
 * customer-journey "returns to product page" failure. Dev DB only (_db guard).
 *
 * Run: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/_probe-login-return.ts
 */
import bcrypt from 'bcryptjs';
import { db, BASE } from './_db';
import { openBrowser } from './_browser';

(async () => {
  const tag = Date.now().toString(36);
  const email = `probe-${tag}@test.local`;
  const password = 'ProbeLogin2026Pass';
  const product = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  if (!product) throw new Error('no active product in dev DB');
  const user = await db.user.create({
    data: {
      email, name: 'Login Probe', phone: `017${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(password, 10), referralCode: `PRB${tag.toUpperCase()}`.slice(0, 16),
    },
  });
  await db.rateLimitBucket.deleteMany({});
  const want = `/product/${product.id}/${encodeURIComponent(product.slug)}`;
  const browser = await openBrowser({ headless: true });
  try {
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } })).newPage();
    const logs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
    page.on('response', (r) => { if (/\/api\/auth\//.test(r.url())) logs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(want)}`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    const t0 = Date.now();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
    const landed = new URL(page.url());
    const alert = await page.locator('.alert-error').first().textContent().catch(() => null);
    console.log(JSON.stringify({
      want, landed: landed.pathname + landed.search, ms: Date.now() - t0,
      alert, ok: landed.pathname.startsWith(`/product/${product.id}`), logs: logs.slice(0, 12),
    }, null, 2));
  } finally {
    await browser.close();
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
  }
})();
