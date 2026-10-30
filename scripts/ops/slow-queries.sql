-- ═══════════════════════════════════════════════════════════
-- ★★★ SRE — ধীর কোয়েরি ও সংযোগ-চাপ (কেবল পড়া; কিছুই লেখে না)
--   Neon SQL Editor-এ বা `scripts/ops/db-pulse.ts` দিয়ে চালান।
--   একবার (Neon-এ ডিফল্টে উপলব্ধ, কেবল চালু করতে হয়):
--     CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- ═══════════════════════════════════════════════════════════

-- ১. এই মুহূর্তে ১০০ms-এর বেশি ধরে চলা কোয়েরি (লাইভ)
SELECT pid, now() - query_start AS running_for, state, wait_event_type, wait_event,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
  AND now() - query_start > interval '100 milliseconds'
ORDER BY running_for DESC;

-- ২. সংযোগ-চাপ — max_connections এর কত % ব্যবহৃত (৮০% = সতর্কতা)
SELECT count(*) AS used,
       current_setting('max_connections')::int AS max,
       round(100.0 * count(*) / current_setting('max_connections')::int, 1) AS pct,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx
FROM pg_stat_activity WHERE datname = current_database();

-- ৩. কে কাকে আটকে রেখেছে — row-lock অপেক্ষা (FOR UPDATE ভিড়)
SELECT blocked.pid AS blocked_pid, now() - blocked.query_start AS waiting_for,
       blocking.pid AS blocking_pid,
       left(regexp_replace(blocked.query, '\s+', ' ', 'g'), 100) AS blocked_query,
       left(regexp_replace(blocking.query, '\s+', ' ', 'g'), 100) AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY (pg_blocking_pids(blocked.pid))
WHERE blocked.datname = current_database();

-- ৪. ইতিহাস — গড়ে ১০০ms-এর বেশি নেওয়া কোয়েরি-আকার (pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms, round(max_exec_time::numeric, 1) AS max_ms,
       round(total_exec_time::numeric / 1000, 1) AS total_s, rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND mean_exec_time > 100
ORDER BY total_exec_time DESC
LIMIT 20;

-- ৫. লোড-টেস্টের আগে কাউন্টার শূন্য করতে (ঐচ্ছিক):
--   SELECT pg_stat_statements_reset();
