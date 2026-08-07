/**
 * টেলিগ্রাম সংযোগ যাচাই — `npx tsx scripts/telegram-check.ts`
 *
 * ⚠️ এই স্ক্রিপ্ট কখনো পূর্ণ টোকেন ছাপে না। শুধু bot-id অংশ (যা
 *    টেলিগ্রাম নিজেই প্রকাশ্যে দেখায়) আর দৈর্ঘ্য দেখানো হয়।
 */
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

/** টোকেনের নিরাপদ রূপ — গোপন অংশ কখনো দেখা যাবে না */
function mask(t: string): string {
  const id = t.split(':')[0] || '?';
  return `${id}:*** (len ${t.length})`;
}

/** অদৃশ্য অক্ষর ধরার জন্য — নতুন লাইন/স্পেস/কোট */
function shape(raw: string): string {
  const bits: string[] = [];
  if (raw !== raw.trim()) bits.push('surrounding whitespace/newline');
  if (/^["']|["']$/.test(raw)) bits.push('literal quote character');
  if (/[\r\n]/.test(raw)) bits.push('embedded newline');
  return bits.length ? bits.join(' + ') : 'clean';
}

async function main() {
  console.log('═══ 1. Environment ═══');
  const raw = process.env.TELEGRAM_BOT_TOKEN;
  if (!raw) {
    console.log('  ✗ TELEGRAM_BOT_TOKEN not present in process.env');
    process.exit(1);
  }
  const token = raw.trim().replace(/^["']|["']$/g, '');
  console.log(`  loaded            : yes`);
  console.log(`  raw shape         : ${shape(raw)}`);
  console.log(`  raw length        : ${raw.length}`);
  console.log(`  sanitized         : ${mask(token)}`);
  console.log(`  format valid      : ${/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token) ? 'yes' : 'NO — not <digits>:<secret>'}`);

  console.log('\n═══ 2. Telegram API — getMe ═══');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; description?: string; result?: Record<string, unknown>;
    };
    console.log(`  HTTP              : ${res.status}`);
    if (data.ok && data.result) {
      const r = data.result;
      console.log(`  ✓ TOKEN VALID`);
      console.log(`  bot id            : ${r.id}`);
      console.log(`  username          : @${r.username}`);
      console.log(`  display name      : ${r.first_name}`);
      console.log(`  can join groups   : ${r.can_join_groups}`);
      console.log(`  reads all messages: ${r.can_read_all_group_messages}`);
      console.log(`  inline mode       : ${r.supports_inline_queries}`);
    } else {
      console.log(`  ✗ TOKEN REJECTED — ${data.description || 'no description'}`);
    }
  } catch (e) {
    console.log(`  ✗ request failed  — ${e instanceof Error ? e.message : 'unknown'}`);
  } finally {
    clearTimeout(timer);
  }

  console.log('\n═══ 3. Webhook / delivery mode ═══');
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = (await res.json()) as { ok?: boolean; result?: Record<string, unknown> };
    if (data.ok && data.result) {
      const r = data.result;
      const url = String(r.url || '');
      console.log(`  webhook url       : ${url || '(none — not using webhooks)'}`);
      console.log(`  pending updates   : ${r.pending_update_count}`);
      if (r.last_error_message) console.log(`  last error        : ${r.last_error_message}`);
      console.log(`  mode              : ${url ? 'webhook' : 'none (outbound sendMessage only)'}`);
    }
  } catch (e) {
    console.log(`  ✗ ${e instanceof Error ? e.message : 'unknown'}`);
  }

  console.log('\n═══ 4. chat_id আবিষ্কার (getUpdates) ═══');
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { message?: { chat?: { id: number; type: string; title?: string; username?: string } } }[];
    };
    const chats = new Map<number, string>();
    for (const u of data.result || []) {
      const c = u.message?.chat;
      if (c) chats.set(c.id, `${c.type}${c.title ? ` "${c.title}"` : ''}${c.username ? ` @${c.username}` : ''}`);
    }
    if (chats.size === 0) {
      console.log('  (কোনো আপডেট নেই — বট এখনো কোনো মেসেজ পায়নি)');
      console.log('  ➜ করণীয়: টেলিগ্রামে বটটি খুঁজে /start দিন, অথবা একটি গ্রুপে');
      console.log('    বটকে যোগ করে যেকোনো মেসেজ দিন। তারপর এই স্ক্রিপ্ট আবার চালান।');
      console.log('  ⚠️ বট নিজে থেকে কাউকে মেসেজ শুরু করতে পারে না — এটি টেলিগ্রামের');
      console.log('    নিয়ম, কোডের সীমাবদ্ধতা নয়। তাই chat_id স্বয়ংক্রিয়ভাবে পাওয়া যায় না।');
    } else {
      console.log('  ✓ পাওয়া গেছে — যেটি চান সেটির id বসান:');
      for (const [id, desc] of chats) console.log(`    TELEGRAM_CHAT_ID="${id}"   ← ${desc}`);
    }
  } catch (e) {
    console.log(`  ✗ ${e instanceof Error ? e.message : 'unknown'}`);
  }

  console.log('\n═══ 5. Database settings (what the app actually reads) ═══');
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['telegram_bot_token', 'telegram_chat_id', 'site_url', 'site_name'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const dbToken = map.telegram_bot_token || '';
    console.log(`  telegram_bot_token: ${dbToken ? mask(dbToken) : '(not set)'}`);
    console.log(`  telegram_chat_id  : ${map.telegram_chat_id || '(NOT SET)'}`);
    console.log(`  site_url          : ${map.site_url || '(not set)'}`);
    console.log(`  site_name         : ${map.site_name || '(not set)'}`);
    if (dbToken && dbToken.trim() !== token) {
      console.log(`  ⚠️ DB token differs from .env token`);
    }

    console.log('\n═══ 6. Can we actually send? ═══');
    // ★ অ্যাপের মতোই অগ্রাধিকার: env > DB
    const envChatId = (process.env.TELEGRAM_CHAT_ID || '').trim().replace(/^["']|["']$/g, '');
    const chatId = envChatId || (map.telegram_chat_id || '').trim();
    if (!chatId) {
      console.log('  ✗ BLOCKED — no chat_id configured (neither .env nor DB).');
      console.log('    getMe proves the token, but sendMessage needs a destination');
      console.log('    chat. Nothing can be delivered until §4 above is done.');
    } else {
      console.log(`  chat_id present   : ${chatId} (উৎস: ${envChatId ? '.env' : 'DB settings'})`);
      const res = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
      const data = (await res.json()) as { ok?: boolean; description?: string; result?: Record<string, unknown> };
      if (data.ok && data.result) {
        console.log(`  ✓ chat reachable  — type=${data.result.type} title=${data.result.title || data.result.username || ''}`);
      } else {
        console.log(`  ✗ chat unreachable — ${data.description}`);
      }
    }
  } catch (e) {
    console.log(`  ✗ DB query failed — ${e instanceof Error ? e.message : 'unknown'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
