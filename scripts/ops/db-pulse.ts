/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SRE — ডাটাবেসের নাড়ি (লাইভ, প্রতি N সেকেন্ডে)
 *
 *   লোড-টেস্ট বা ভিড়ের সময় পাশের টার্মিনালে চালান। প্রতি টিকে দেখায়:
 *     · সংযোগ ব্যবহৃত / সর্বোচ্চ (%), `idle in transaction` সংখ্যা
 *     · এই মুহূর্তে ১০০ms-এর বেশি চলা কোয়েরি
 *     · row-lock অপেক্ষা (কে কাকে আটকাচ্ছে)
 *   সীমা পেরোলে লাল লাইন, আর `--json` দিলে প্রতি টিক এক লাইন JSON (লগ-ড্রেনে পাঠানো যায়)।
 *
 *   ⚠️ কেবল পড়ে। URL **স্পষ্ট করে** দিতে হয় — `.env` কখনো পড়া হয় না, আর URL
 *   কোথাও ছাপা হয় না (কেবল হোস্ট/DB-নাম):
 *     OPS_DATABASE_URL='postgresql://…' npx tsx scripts/ops/db-pulse.ts [--every 5] [--json]
 *   ⚠️ নিজেও একটি সংযোগ নেয় — pooled URL-এ নয়, সরাসরি (non-pooler) URL দিন,
 *   নাহলে `pg_stat_activity` কেবল pooler-এর দিকটা দেখায়।
 * ═══════════════════════════════════════════════════════════
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.OPS_DATABASE_URL;
if (!url) {
  console.error('✗ OPS_DATABASE_URL দিন (সরাসরি, non-pooler URL)। .env ইচ্ছাকৃতভাবে পড়া হয় না।');
  process.exit(1);
}
const u = new URL(url);
const label = `${u.hostname}/${u.pathname.replace(/^\//, '')}`;

const args = process.argv.slice(2);
const every = Number(args[args.indexOf('--every') + 1]) > 0 ? Number(args[args.indexOf('--every') + 1]) : 5;
const asJson = args.includes('--json');
const SLOW_MS = Number(process.env.SLOW_QUERY_MS) > 0 ? Number(process.env.SLOW_QUERY_MS) : 100;
const CONN_WARN_PCT = 80;

const db = new PrismaClient({ datasources: { db: { url } } });

type Conn = { used: number; max: number; idle_in_tx: number };
type Slow = { pid: number; ms: number; wait: string | null; query: string };
type Block = { blocked_pid: number; blocking_pid: number; waiting_ms: number; query: string };

async function tick() {
  const [conn] = await db.$queryRaw<Conn[]>`
    SELECT count(*)::int AS used, current_setting('max_connections')::int AS max,
           (count(*) FILTER (WHERE state = 'idle in transaction'))::int AS idle_in_tx
    FROM pg_stat_activity WHERE datname = current_database()`;

  const slow = await db.$queryRaw<Slow[]>`
    SELECT pid, (extract(epoch FROM now() - query_start) * 1000)::int AS ms,
           wait_event_type || ':' || wait_event AS wait,
           left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS query
    FROM pg_stat_activity
    WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
      AND now() - query_start > make_interval(secs => ${SLOW_MS / 1000})
    ORDER BY query_start ASC LIMIT 10`;

  const blocks = await db.$queryRaw<Block[]>`
    SELECT b.pid AS blocked_pid, k.pid AS blocking_pid,
           (extract(epoch FROM now() - b.query_start) * 1000)::int AS waiting_ms,
           left(regexp_replace(b.query, '\s+', ' ', 'g'), 100) AS query
    FROM pg_stat_activity b
    JOIN pg_stat_activity k ON k.pid = ANY (pg_blocking_pids(b.pid))
    WHERE b.datname = current_database() LIMIT 10`;

  const pct = Math.round((1000 * conn.used) / conn.max) / 10;
  if (asJson) {
    console.log(JSON.stringify({ at: new Date().toISOString(), db: label, conn: { ...conn, pct }, slow, blocks }));
    return;
  }
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const head = `${new Date().toLocaleTimeString('en-GB')}  সংযোগ ${conn.used}/${conn.max} (${pct}%) · idle-in-tx ${conn.idle_in_tx} · ধীর ${slow.length} · লক-অপেক্ষা ${blocks.length}`;
  console.log(pct >= CONN_WARN_PCT || conn.idle_in_tx > 5 ? red(head) : head);
  for (const s of slow) console.log(`   ⏱ ${String(s.ms).padStart(6)}ms pid ${s.pid} ${s.wait ?? ''}  ${s.query}`);
  for (const b of blocks) console.log(red(`   🔒 pid ${b.blocked_pid} ← pid ${b.blocking_pid} (${b.waiting_ms}ms)  ${b.query}`));
}

async function main() {
  if (!asJson) console.log(`═══ DB নাড়ি · ${label} · প্রতি ${every}s · ধীর = ${SLOW_MS}ms+ · Ctrl+C থামায় ═══`);
  for (;;) {
    try { await tick(); } catch (e) { console.error('✗', e instanceof Error ? e.message : e); }
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}

process.on('SIGINT', async () => { await db.$disconnect(); process.exit(0); });
main();
