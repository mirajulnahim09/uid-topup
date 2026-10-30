import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { BACKUP_VERSION, BACKUP_DATA_KEYS, createBackupSigner } from '@/lib/backup';

// ★ সেশন/হেডার পড়ে — বিল্ডের সময় static render করার চেষ্টা করা যাবে না
export const dynamic = 'force-dynamic';

/**
 * ★ পুরো ডাটাবেস ব্যাকআপ — JSON ফাইল হিসেবে ডাউনলোড। শুধু অ্যাডমিন।
 *   ⚠️ H3 fixed — ইউজারের **পাসওয়ার্ড হ্যাশ ব্যাকআপে যায় না**। restore
 *   রুট ইউজার টেবিল ছোঁয়ই না (শুধু কনফিগ/ক্যাটালগ ফেরায়), তাই হ্যাশ বাদ
 *   দিলে কিছু ভাঙে না — কিন্তু একটি admin-ডাউনলোড আর সব ইউজারের bcrypt
 *   হ্যাশ ফাঁস করার (offline cracking) ঝুঁকি থাকে না।
 *
 * ★★★ **স্ট্রিম** — পুরো ডাটাবেস আর মেমরিতে একসাথে নয়।
 *
 *   ⚠️ মাপা (সিমুলেশন, ২০২৬-০৯-২৫; ১০k গ্রাহক, ৫ লাখ অর্ডার, ১১ লাখ খতিয়ান-সারি):
 *   আগে ১৭টি টেবিল পুরোটা `findMany()` করে একটি `JSON.stringify(…, null, 2)` —
 *   ফল `RangeError: Invalid string length`, তারপর হিপ ৪GB ছুঁয়ে **পুরো সার্ভার
 *   প্রসেস মরে গেল** (সব গ্রাহকের জন্য সাইট বন্ধ)। অর্থাৎ অ্যাডমিনের একটি
 *   "ব্যাকআপ" ক্লিক ব্যস্ত দোকানে পুরো সাইট নামিয়ে দিত।
 *
 *   এখন: বড় টেবিল id-ক্রমে ২০০০ করে (primary key দিয়ে), ছোট কনফিগ-টেবিল একবারে;
 *   প্রতিটি টুকরো লেখার সাথে সাথে SHA-256-এ যোগ হয়।
 *
 *   ⚠️ restore-সামঞ্জস্য **অক্ষত**: checksum আগের মতোই
 *   `JSON.stringify({users:[…], categories:[…], … productImages:[…]})`-এর উপর
 *   (`lib/backup.ts`-এর `canonicalData`) — এখানে ঠিক সেই বাইটগুলোই ক্রমান্বয়ে
 *   হ্যাশ হয়। কেবল দুটি দৃশ্যমান বদল: ফাইল আর pretty-print নয় (আকার ~অর্ধেক), আর
 *   `_meta` শুরুর বদলে **শেষে** (checksum আগে জানা যায় না) — JSON-এ কী-ক্রম
 *   পার্সে অর্থহীন, restore `data._meta` দিয়েই পড়ে।
 */
const BATCH = 2000;
type Row = Record<string, unknown>;
type Key = (typeof BACKUP_DATA_KEYS)[number];

/** id-ক্রমে একটি পাতা — `after` এর পরের সারিগুলো (বড় টেবিল, String id) */
const paged = (after: string | null) => ({
  take: BATCH,
  orderBy: { id: 'asc' as const },
  ...(after ? { where: { id: { gt: after } } } : {}),
});

/** প্রতিটি কী-র জন্য: `after` দিলে পরের পাতা; ছোট টেবিল একবারেই সব দেয় */
const SOURCES: Record<Key, { big: boolean; fetch: (after: string | null) => Promise<Row[]> }> = {
  // ★ H3 — পাসওয়ার্ড বাদ: `undefined` কী JSON.stringify নিজেই ফেলে দেয়
  users: { big: true, fetch: (a) => prisma.user.findMany(paged(a)).then((r) => r.map((u) => ({ ...u, password: undefined }))) },
  categories: { big: false, fetch: () => prisma.category.findMany() },
  products: { big: false, fetch: () => prisma.product.findMany() },
  variants: { big: false, fetch: () => prisma.variant.findMany() },
  banners: { big: false, fetch: () => prisma.banner.findMany() },
  socialLinks: { big: false, fetch: () => prisma.socialLink.findMany() },
  paymentChannels: { big: false, fetch: () => prisma.paymentChannel.findMany() },
  coupons: { big: false, fetch: () => prisma.coupon.findMany() },
  couponUses: { big: true, fetch: (a) => prisma.couponUse.findMany(paged(a)) },
  deposits: { big: true, fetch: (a) => prisma.deposit.findMany(paged(a)) },
  orders: { big: true, fetch: (a) => prisma.order.findMany(paged(a)) },
  ledger: { big: true, fetch: (a) => prisma.ledgerEntry.findMany(paged(a)) },
  notifications: { big: true, fetch: (a) => prisma.notification.findMany(paged(a)) },
  settings: { big: false, fetch: () => prisma.setting.findMany() },
  adminLogs: { big: true, fetch: (a) => prisma.adminLog.findMany(paged(a)) },
  media: { big: true, fetch: (a) => prisma.media.findMany(paged(a)) },
  productImages: { big: false, fetch: () => prisma.productImage.findMany() },
};

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'BACKUP_DOWNLOAD',
      ip: getIp(req),
    }).catch(() => {});

    const enc = new TextEncoder();
    const hash = createHash('sha256');
    // ★★★ BKP-01 — একই বাইটের HMAC (সার্ভারের গোপন চাবি)। চাবি না থাকলে
    //   এখানেই ব্যর্থ হয় — স্বাক্ষরহীন ব্যাকআপ দেওয়ার চেয়ে না দেওয়াই ভালো,
    //   কারণ সেটি পরে কোনোদিন restore করা যেত না।
    const signer = createBackupSigner();
    let t = 0;                       // কোন টেবিল
    let after: string | null = null; // সেই টেবিলে শেষ id
    let rowsInTable = 0;
    let opened = false;

    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        // ★ ডেটা-অংশ: যা পাঠানো হয় হুবহু তাই হ্যাশ হয়
        const emit = (s: string) => { hash.update(s); signer.update(s); ctrl.enqueue(enc.encode(s)); };

        if (t >= BACKUP_DATA_KEYS.length) {
          // canonical অবজেক্টের শেষ `}` — হ্যাশে যায়, ফাইলে নয় (ফাইলে এরপর `_meta`)
          hash.update('}');
          signer.update('}');
          const meta = {
            app: 'uid-topup',
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            exportedBy: admin.name,
            note: 'password hashes excluded (H3)',
            // ★ SHA-256(canonical data) — restore যাচাই করে
            checksum: hash.digest('hex'),
            // ★ BKP-01 — HMAC-SHA256; restore এটি ছাড়া কিছুই গ্রহণ করে না
            signature: signer.digest('hex'),
          };
          ctrl.enqueue(enc.encode(`,"_meta":${JSON.stringify(meta)}}`));
          ctrl.close();
          return;
        }

        const key = BACKUP_DATA_KEYS[t];
        const src = SOURCES[key];
        if (!opened) {
          emit(`${t === 0 ? '{' : ','}${JSON.stringify(key)}:[`);
          opened = true;
          rowsInTable = 0;
          after = null;
        }

        const rows = await src.fetch(after);
        if (rows.length) {
          emit((rowsInTable ? ',' : '') + rows.map((r) => JSON.stringify(r)).join(','));
          rowsInTable += rows.length;
          after = String(rows[rows.length - 1].id);
        }
        if (!src.big || rows.length < BATCH) {
          emit(']');
          opened = false;
          t++;
        }
      },
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ss-uid-topup-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
