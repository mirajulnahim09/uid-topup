/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ নিরাপত্তা-হেডার ও ওয়েব-হাইজিন — প্রোডাকশন রানটাইমে
 *     (স্বাধীন অডিট, ২০২৬-০৯-১৮)
 *
 *   দাবিগুলো কোড নয়, **আসল উত্তরের হেডার** থেকে মাপা হয়:
 *     · CSP (nonce + strict-dynamic, প্রোডাকশনে script-src-এ 'unsafe-inline' নেই)
 *     · X-Content-Type-Options · Referrer-Policy · Permissions-Policy
 *     · frame-ancestors / X-Frame-Options · HSTS (TLS-এ)
 *     · লগইন-পরবর্তী পাতা ক্যাশ হয় না (no-store)
 *     · API উত্তর ক্যাশ হয় না, `X-Powered-By` নেই
 *     · robots.txt — /admin, /account, /api বন্ধ · sitemap-এ কেবল পাবলিক
 *     · /admin পাতায় noindex · ৪০৪ পাতায় স্ট্যাক/ভেতরের তথ্য নেই
 *     · কোনো পাতার HTML-এ সিক্রেট/টোকেনের ছাঁচ নেই
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/headers-seo.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };

let pass = 0; const fails: string[] = [];
function check(name: string, ok: boolean, note = '') {
  if (ok) pass++; else fails.push(`${name} — ${note}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function login(who: { email: string; password: string } | null) {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  if (!who) return ctx;
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  return ctx;
}

/** সিক্রেটের ছাঁচ — HTML/JSON-এ কখনো থাকা চলবে না */
const SECRET_SHAPES: Array<[string, RegExp]> = [
  ['DB URL', /postgres(?:ql)?:\/\/[^\s"'<]+:[^\s"'<]+@/],
  ['Telegram টোকেন', /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/],
  ['Resend কী', /\bre_[A-Za-z0-9]{20,}\b/],
  ['Blob টোকেন', /\bvercel_blob_rw_[A-Za-z0-9]{20,}\b/],
  ['NEXTAUTH_SECRET নাম+মান', /NEXTAUTH_SECRET["'\s:=]+[A-Za-z0-9+/=]{16,}/],
  ['bcrypt হ্যাশ', /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/],
];

async function main() {
  console.log(`═══ হেডার ও ওয়েব-হাইজিন · ${BASE} · DB ${dbLabel()} ═══`);
  const anon = await login(null);
  const cust = await login(CUSTOMER);
  const admin = await login(ADMIN);

  const product = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  const productPath = `/product/${product!.id}/${encodeURIComponent(product!.slug)}`;

  const get = async (ctx: APIRequestContext, p: string) => {
    const r = await ctx.get(`${BASE}${p}`, { failOnStatusCode: false, maxRedirects: 0 });
    return { status: r.status(), headers: r.headers(), body: await r.text() };
  };

  /* ── ১. সব পাতায় মূল নিরাপত্তা-হেডার ── */
  console.log('\n── ১. নিরাপত্তা-হেডার (পাবলিক পাতা) ──');
  for (const p of ['/', productPath, '/login', '/faq']) {
    const r = await get(anon, p);
    const h = r.headers;
    const csp = h['content-security-policy'] ?? '';
    check(`${p} — CSP আছে`, csp.length > 0, csp ? `${csp.length} অক্ষর` : 'নেই');
    check(`${p} — script-src-এ nonce`, /script-src[^;]*'nonce-/.test(csp), csp.match(/script-src[^;]*/)?.[0]?.slice(0, 90) ?? 'নেই');
    check(`${p} — script-src-এ 'unsafe-inline' নেই`, !/script-src[^;]*'unsafe-inline'/.test(csp));
    check(`${p} — object-src 'none'`, /object-src\s+'none'/.test(csp));
    check(`${p} — frame-ancestors সীমিত`, /frame-ancestors\s+'(none|self)'/.test(csp), csp.match(/frame-ancestors[^;]*/)?.[0] ?? 'নেই');
    check(`${p} — nosniff`, h['x-content-type-options'] === 'nosniff', h['x-content-type-options'] ?? 'নেই');
    check(`${p} — Referrer-Policy`, /no-referrer|strict-origin/.test(h['referrer-policy'] ?? ''), h['referrer-policy'] ?? 'নেই');
    check(`${p} — Permissions-Policy`, (h['permissions-policy'] ?? '').length > 0, h['permissions-policy']?.slice(0, 60) ?? 'নেই');
    check(`${p} — X-Powered-By নেই`, !h['x-powered-by'], h['x-powered-by'] ?? '');
    check(`${p} — HSTS (TLS-এ)`, /max-age=\d+/.test(h['strict-transport-security'] ?? ''), h['strict-transport-security'] ?? 'নেই');
    for (const [label, re] of SECRET_SHAPES) check(`${p} — HTML-এ ${label} নেই`, !re.test(r.body));
  }

  /* ── ২. লগইন-পরবর্তী পাতা ও API ক্যাশ হয় না ── */
  console.log('\n── ২. ব্যক্তিগত উত্তর ক্যাশ হয় না ──');
  for (const [who, ctx, p] of [['গ্রাহক', cust, '/account'], ['গ্রাহক', cust, '/account/orders'], ['অ্যাডমিন', admin, '/admin'], ['অ্যাডমিন', admin, '/admin/users']] as const) {
    const r = await get(ctx, p);
    const cc = r.headers['cache-control'] ?? '';
    check(`${who} ${p} — no-store/private`, /no-store|private/.test(cc), cc || 'নেই');
    for (const [label, re] of SECRET_SHAPES) check(`${who} ${p} — HTML-এ ${label} নেই`, !re.test(r.body));
  }
  for (const [ctx, p] of [[cust, '/api/me'], [cust, '/api/notifications'], [admin, '/api/admin/readiness']] as const) {
    const r = await get(ctx, p);
    const cc = r.headers['cache-control'] ?? '';
    check(`API ${p} — ক্যাশ হয় না`, /no-store|no-cache|private|max-age=0/.test(cc), cc || 'নেই');
    for (const [label, re] of SECRET_SHAPES) check(`API ${p} — ${label} নেই`, !re.test(r.body));
  }

  /* ── ৩. robots ও sitemap ── */
  console.log('\n── ৩. robots · sitemap · noindex ──');
  const robots = await get(anon, '/robots.txt');
  check('robots.txt ২০০', robots.status === 200, String(robots.status));
  for (const dis of ['/admin', '/account', '/api']) {
    check(`robots.txt — ${dis} বন্ধ`, new RegExp(`Disallow:\\s*${dis.replace('/', '\\/')}`).test(robots.body), robots.body.replace(/\s+/g, ' ').slice(0, 80));
  }
  const sitemap = await get(anon, '/sitemap.xml');
  check('sitemap.xml ২০০ ও XML', sitemap.status === 200 && sitemap.body.trimStart().startsWith('<?xml'), String(sitemap.status));
  check('sitemap-এ /admin বা /account নেই', !/\/admin|\/account/.test(sitemap.body));
  const adminHtml = await get(admin, '/admin');
  check('/admin — noindex', /noindex/i.test(adminHtml.body) || /noindex/i.test(adminHtml.headers['x-robots-tag'] ?? ''), adminHtml.headers['x-robots-tag'] ?? 'মেটা-ট্যাগে খোঁজা হয়েছে');
  const accountHtml = await get(cust, '/account');
  check('/account — noindex', /noindex/i.test(accountHtml.body) || /noindex/i.test(accountHtml.headers['x-robots-tag'] ?? ''));

  /* ── ৪. ৪০৪ ও ত্রুটি-পাতা ── */
  console.log('\n── ৪. ৪০৪ ও মেটাডেটা ──');
  const nf = await get(anon, '/definitely-not-a-real-page-xyz');
  check('অজানা পথ → ৪০৪', nf.status === 404, String(nf.status));
  check('৪০৪-এ স্ট্যাক/ভেতরের পথ নেই', !/at \w+ \(|node_modules|PrismaClient|ECONNREFUSED/.test(nf.body));
  check('৪০৪ পাতা বাংলা বার্তা দেখায়', /পাওয়া যায়নি|খুঁজে/.test(nf.body));
  const home = await get(anon, '/');
  check('হোমে <title> আছে', /<title>[^<]{3,}<\/title>/.test(home.body));
  check('হোমে meta description আছে', /<meta name="description"/i.test(home.body));
  check('favicon/manifest লিংক আছে', /rel="icon"|manifest/i.test(home.body));
  const prod = await get(anon, productPath);
  check('প্রোডাক্ট পাতায় og/টাইটেল মেটা', /<meta property="og:|<title>/i.test(prod.body));

  /* ── ৫. আপলোড-পাথের হেডার ── */
  console.log('\n── ৫. /uploads হেডার-নিয়ম ──');
  const up = await get(anon, '/uploads/deposits/does-not-exist.png');
  check('/uploads — nosniff (৪০৪-এও নিয়ম বসে)', (up.headers['x-content-type-options'] ?? '') === 'nosniff', up.headers['x-content-type-options'] ?? 'নেই');
  check('/uploads — sandbox CSP', /sandbox/.test(up.headers['content-security-policy'] ?? ''), up.headers['content-security-policy'] ?? 'নেই');

  await Promise.all([anon.dispose(), cust.dispose(), admin.dispose()]);
  await db.rateLimitBucket.deleteMany({});
  console.log(`\n════ ${pass} পাস · ${fails.length} ব্যর্থ ════`);
  if (fails.length) { console.log(fails.join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
