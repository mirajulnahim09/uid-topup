/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ পুরনো প্লেইনটেক্সট গেটওয়ে-কী → এনক্রিপ্টেড namespaced সারি
 *
 *   চালান:  npx tsx scripts/migrate-payment-keys.ts
 *   শুধু দেখতে (কিছু বদলাবে না):
 *           npx tsx scripts/migrate-payment-keys.ts --dry-run
 *
 *   ── কেন দরকার ──
 *   `pp_<id>_keys` সারিতে গেটওয়ে ক্রেডেনশিয়াল **প্লেইনটেক্সটে**
 *   থাকত। `settings.ts` এখন `pp_*` বাদ দেয়, তাই ক্লায়েন্টে আর ফাঁস
 *   হয় না — কিন্তু DB ডাম্প/ব্যাকআপে মানগুলো এখনো পাঠযোগ্য। secretbox
 *   ঠিক এই ঝুঁকিটার জন্যই আছে, তাই সারিগুলো সরিয়ে নেওয়া উচিত।
 *
 *   ⚠️ নিরাপদ ও পুনরাবৃত্তিযোগ্য (idempotent): ইতিমধ্যে এনক্রিপ্টেড
 *   সারি স্পর্শ করে না, আর প্রতিটি প্রোভাইডারের লেখা ও পুরনো সারি
 *   মোছা একই transaction-এ — মাঝপথে থেমে গেলেও কী হারায় না।
 *
 *   ⚠️ এটি কোনো মান **ছাপে না** (CLAUDE.md §2.3)। শুধু গণনা।
 * ═══════════════════════════════════════════════════════════
 */
import { PrismaClient } from '@prisma/client';
import { encryptSecret, isEncrypted, isSecretBoxReady } from '../src/lib/secretbox';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  if (!isSecretBoxReady()) {
    console.error(
      '\n✗ এনক্রিপশন কী নেই — NEXTAUTH_SECRET (বা TELEGRAM_ENC_KEY) সেট করুন।\n' +
        '  কী ছাড়া মাইগ্রেট করলে মানগুলো প্লেইনটেক্সটেই থেকে যেত।\n',
    );
    process.exit(1);
  }

  const legacy = await prisma.setting.findMany({
    where: { key: { startsWith: 'pp_' } },
  });

  if (legacy.length === 0) {
    console.log('✓ পুরনো `pp_*` সারি নেই — মাইগ্রেট করার কিছু নেই।');
    return;
  }

  let migratedKeys = 0;
  let migratedModes = 0;

  for (const row of legacy) {
    const mKeys = /^pp_(.+)_keys$/.exec(row.key);
    const mMode = /^pp_(.+)_mode$/.exec(row.key);

    if (mKeys) {
      const id = mKeys[1];
      const target = `pp:${id}:keys`;
      // ★ ইতিমধ্যে এনক্রিপ্টেড হলে শুধু সরাই, দুবার এনক্রিপ্ট নয়
      const value = isEncrypted(row.value) ? row.value : encryptSecret(row.value);

      if (!DRY) {
        await prisma.$transaction([
          prisma.setting.upsert({
            where: { key: target },
            update: { value },
            create: { key: target, value },
          }),
          prisma.setting.delete({ where: { key: row.key } }),
        ]);
      }
      migratedKeys++;
      console.log(`  ${DRY ? '[dry] ' : ''}${row.key} → ${target} (এনক্রিপ্টেড)`);
    } else if (mMode) {
      const id = mMode[1];
      const target = `pp:${id}:mode`;
      if (!DRY) {
        await prisma.$transaction([
          prisma.setting.upsert({
            where: { key: target },
            update: { value: row.value },
            create: { key: target, value: row.value },
          }),
          prisma.setting.delete({ where: { key: row.key } }),
        ]);
      }
      migratedModes++;
      console.log(`  ${DRY ? '[dry] ' : ''}${row.key} → ${target}`);
    }
  }

  console.log(
    `\n${DRY ? '[dry-run] ' : '✓ '}${migratedKeys} কী-বান্ডিল, ${migratedModes} মোড সারি` +
      `${DRY ? ' মাইগ্রেট হতো' : ' মাইগ্রেট হয়েছে'}।`,
  );
  if (DRY) console.log('  আসলে চালাতে `--dry-run` ছাড়া আবার চালান।');
}

main()
  .catch((e) => {
    console.error('✗ মাইগ্রেশন ব্যর্থ:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
