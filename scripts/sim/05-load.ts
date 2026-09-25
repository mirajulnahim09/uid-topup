/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ৫ — লোড-স্তর: ১০ → ১০,০০০
 *
 *   দুই ধরনের মডেল, **আলাদা করে রিপোর্ট** — গুলিয়ে ফেললে "১০k একসাথে"
 *   জাতীয় মিথ্যা দাবি জন্মায়:
 *
 *   ক. closed-loop (think-time নেই): N ভার্চুয়াল ইউজার, প্রত্যেকে উত্তর
 *      পেয়েই পরের অনুরোধ। এটি **N-টি একসাথে চলমান অনুরোধ** — সার্ভারের
 *      সর্বোচ্চ চাপ। স্তর: ১০/২৫/৫০/১০০/২৫০/৫০০/১০০০।
 *   খ. বাস্তব সক্রিয়-ইউজার (think-time ২–১০s): ২৫০০/৫০০০/১০০০০ জন
 *      একসাথে সাইটে। প্রকৃত in-flight অনুরোধ আলাদা মাপা হয় (Little's law:
 *      in-flight ≈ rps × latency) — সেটিই আসল সমান্তরালতা।
 *
 *   মিশ্রণ: হোম, প্রোডাক্ট, সার্চ, অর্ডার-তালিকা, বিজ্ঞপ্তি, /api/me, অর্ডার
 *   (বাকি ব্যালেন্স থেকে), আর ~৫% অ্যাডমিন (অর্ডার-কিউ, ড্যাশবোর্ড)।
 *
 *   ⚠️ ক্লায়েন্ট ও সার্ভার একই ৮-কোর ল্যাপটপে — ক্লায়েন্টও CPU খায়,
 *   তাই ফল রক্ষণশীল (প্রকৃত সার্ভার-ক্ষমতা এর চেয়ে বেশি হতে পারে)।
 *   ফল: audit/sim/load.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, call, mintCookie, samples, summarize, byName, saveJson, dbConnections, sleep, rng } from './_lib';
import { execFileSync } from 'node:child_process';

const CLOSED = (process.env.LOAD_CLOSED || '10,25,50,100,250,500,1000').split(',').map(Number);
const ACTIVE = (process.env.LOAD_ACTIVE || '2500,5000,10000').split(',').map(Number);
const CLOSED_S = Number(process.env.LOAD_CLOSED_S || 20);
const ACTIVE_S = Number(process.env.LOAD_ACTIVE_S || 60);
const R = rng(777);

function serverStats(): { memMB: number; cpuS: number } {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next\\\\dist\\\\bin\\\\next.*start|start-server' }; " +
      "$ids = $p.ProcessId; $g = Get-Process -Id $ids -ErrorAction SilentlyContinue; " +
      "'{0} {1}' -f [math]::Round((($g | Measure-Object WorkingSet64 -Sum).Sum)/1MB), [math]::Round((($g | Measure-Object CPU -Sum).Sum),1)"],
      { encoding: 'utf8', timeout: 15_000 });
    const [m, c] = out.trim().split(/\s+/).map(Number);
    return { memMB: m, cpuS: c };
  } catch { return { memMB: -1, cpuS: -1 }; }
}

async function main() {
  const users = await db.user.findMany({
    where: { email: { startsWith: 'sim-', endsWith: '@sim.invalid' } },
    select: { id: true, role: true, sessionEpoch: true, balance: true },
  });
  const cookies = await Promise.all(users.map((u) => mintCookie(u)));
  const rich = users.map((u, i) => ({ c: cookies[i], bal: Number(u.balance) })).filter((x) => x.bal > 100);
  const admin = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const p = await db.product.findFirstOrThrow({ where: { isActive: true }, include: { variants: { where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' }, take: 1 } } });
  const productPath = `/product/${p.id}/${encodeURIComponent(p.slug)}`;
  const cheap = p.variants[0];
  console.log(`সেশন ${cookies.length} · ব্যালেন্সওয়ালা ${rich.length} · প্রোডাক্ট ${productPath}`);

  let inflight = 0; let peakInflight = 0;
  const hit = async (name: string, c: string | null, m: 'GET' | 'POST', path: string, body?: unknown) => {
    inflight++; peakInflight = Math.max(peakInflight, inflight);
    try { return await call(name, c, m, path, body, { timeoutMs: 30_000 }); } finally { inflight--; }
  };
  let orderSeq = 0;
  async function oneAction(vu: number) {
    if (vu % 20 === 19) {
      return R.chance(0.6) ? hit('admin GET /admin/orders', admin, 'GET', '/admin/orders') : hit('admin GET /admin', admin, 'GET', '/admin');
    }
    const c = cookies[vu % cookies.length];
    const x = R.next();
    if (x < 0.30) return hit('GET /', c, 'GET', '/');
    if (x < 0.50) return hit('GET product', c, 'GET', productPath);
    if (x < 0.55) return hit('GET /api/search', c, 'GET', '/api/search?q=diamond');
    if (x < 0.65) return hit('GET /account/orders', c, 'GET', '/account/orders');
    if (x < 0.75) return hit('GET /api/notifications', c, 'GET', '/api/notifications');
    if (x < 0.90) return hit('GET /api/me', c, 'GET', '/api/me');
    if (x < 0.93) return hit('GET /anon /', null, 'GET', '/');
    const rc = rich[vu % rich.length];
    return hit('POST /api/order', rc.c, 'POST', '/api/order', { variantId: cheap.id, playerUid: '1234567890', clientRef: `load-${Date.now()}-${orderSeq++}` });
  }

  const rows: any[] = [];
  async function measure(label: string, kind: 'closed' | 'active', n: number, seconds: number, run: (until: number) => Promise<void>) {
    await db.rateLimitBucket.deleteMany({});
    const s0 = samples.length;
    peakInflight = 0;
    const conn: number[] = []; const inflightSamples: number[] = [];
    const before = serverStats();
    const probe = setInterval(async () => { inflightSamples.push(inflight); conn.push(await dbConnections().catch(() => -1)); }, 1000);
    const mem: number[] = [];
    const memProbe = setInterval(() => mem.push(serverStats().memMB), 5000);
    const t = Date.now();
    await run(t + seconds * 1000);
    const secs = (Date.now() - t) / 1000;
    clearInterval(probe); clearInterval(memProbe);
    const after = serverStats();
    const xs = samples.slice(s0);
    const sum = summarize(xs, secs);
    const avgInflight = inflightSamples.length ? Math.round(inflightSamples.reduce((a, b) => a + b, 0) / inflightSamples.length) : 0;
    const row = {
      label, kind, users: n, seconds: Math.round(secs), ...sum,
      errRatePct: Math.round(((sum.c5xx + sum.net0) / Math.max(1, sum.n)) * 10000) / 100,
      peakInflight, avgInflight, peakDbConn: Math.max(0, ...conn),
      serverMemMB: { before: before.memMB, peak: Math.max(before.memMB, ...mem, after.memMB) },
      serverCpuSecondsUsed: Math.round((after.cpuS - before.cpuS) * 10) / 10,
      perEndpoint: byName(xs),
    };
    rows.push(row);
    console.log(`  ${label.padEnd(22)} n=${String(sum.n).padStart(6)} rps=${String(sum.rps).padStart(6)} p50=${sum.p50} p95=${sum.p95} p99=${sum.p99} max=${sum.max} 5xx=${sum.c5xx} net0=${sum.net0} 429=${sum.c429} in-flight শীর্ষ/গড় ${peakInflight}/${avgInflight} DB ${row.peakDbConn} মেম ${row.serverMemMB.peak}MB CPU ${row.serverCpuSecondsUsed}s`);
    await sleep(3000);
  }

  // warm-up
  for (const path of ['/', productPath, '/account/orders', '/api/me']) await hit('warm', cookies[0], 'GET', path);
  samples.length = 0;

  console.log('═══ ক. closed-loop ═══');
  for (const n of CLOSED) {
    await measure(`closed ${n}`, 'closed', n, CLOSED_S, async (until) => {
      await Promise.all(Array.from({ length: n }, async (_, vu) => { while (Date.now() < until) await oneAction(vu); }));
    });
  }
  console.log('═══ খ. সক্রিয় ইউজার (think-time ২–১০s) ═══');
  for (const n of ACTIVE) {
    await measure(`active ${n}`, 'active', n, ACTIVE_S, async (until) => {
      await Promise.all(Array.from({ length: n }, async (_, vu) => {
        // শুরু ছড়ানো — সবাই এক মিলিসেকেন্ডে ঢোকে না
        await sleep(R.int(0, 10_000));
        while (Date.now() < until) { await oneAction(vu); await sleep(R.int(2000, 10_000)); }
      }));
    });
  }

  // অবনতির শুরু: p95 প্রথম স্তরের ২ গুণের বেশি বা ত্রুটি > ১%
  const base = rows[0].p95;
  const degr = rows.find((r) => r.p95 > base * 2 || r.errRatePct > 1);
  saveJson('load.json', { at: new Date().toISOString(), note: 'client+server একই ৮-কোর মেশিনে; Postgres ডকারে', rows, degradationStartsAt: degr?.label ?? null, baselineP95: base });
  console.log(`\nঅবনতির শুরু: ${degr ? degr.label : 'পরীক্ষিত সীমার মধ্যে নয়'} (ভিত্তি p95 ${base}ms)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
