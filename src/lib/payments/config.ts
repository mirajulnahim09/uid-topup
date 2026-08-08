import { prisma } from '../prisma';
import { logger } from '../logger';
import { invalidateSettings } from '../settings';
import { encryptSecret, decryptSecret, isEncrypted } from '../secretbox';
import { getProvider, allProviders, isProviderEnabled } from './registry';
import type { ProviderId, ProviderMode, ProviderHealth, ProviderInfo } from './types';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রোভাইডার ক্রেডেনশিয়াল ও পরিবেশ কনফিগ (DB-স্টোরড)
 *
 *   ── কেন এই স্তর ──
 *   আগে গেটওয়ে-কী শুধু **env** থেকে আসত — মানে নতুন প্রোভাইডার চালু করতে
 *   `.env` বদলে **রি-ডিপ্লয়** করতে হতো (কোড/অবকাঠামো পরিবর্তন)। ব্যবসায়িক
 *   প্রয়োজন: অ্যাডমিন প্যানেল থেকেই কী বসাবে → চালু করবে → সেভ করবে →
 *   প্রোভাইডার সক্রিয় — কোনো কোড বদল ছাড়াই।
 *
 *   এই মডিউল সেই কনফিগ `Setting` টেবিলে রাখে (key/value), প্রতি-প্রোভাইডার:
 *     • `pp_<id>_keys`  — JSON { [field]: value }  (সিক্রেট)
 *     • `pp_<id>_mode`  — 'test' | 'live'
 *     • `provider_<id>_enabled` — '1'/'0' (বিদ্যমান, registry পড়ে)
 *
 *   ⚠️ নিরাপত্তা:
 *   • সিক্রেট মান **কখনো** ক্লায়েন্টে ফেরত যায় না — শুধু "সেট আছে কি না"
 *     (masked)। পড়া হয় কেবল সার্ভার-সাইডে।
 *   • env-এ থাকা কী DB-তে ওভাররাইড করা যায় না বলে DB-কে অগ্রাধিকার নয় —
 *     env থাকলে env-ই আসল (deploy-স্তরের সিদ্ধান্ত জেতে)।
 *
 *   ⚠️ সততা: এটি **কনফিগ ব্যবস্থাপনা** — লাইভ পেমেন্ট প্রসেসিং নয়।
 *   verify()/refund() এখনো স্টাব, তাই কী সম্পূর্ণ হলেও health = CONFIGURED_
 *   PENDING (কাঠামো প্রস্তুত, ড্রাইভার বাকি)। ফলে ভুল কনফিগে টাকা নড়ে না।
 * ═══════════════════════════════════════════════════════════
 */

export type ProviderConfig = {
  mode: ProviderMode;
  /** DB-তে সংরক্ষিত কী (সার্ভার-only) */
  keys: Record<string, string>;
  /** শেষ "Test connection" — কখনো চলেনি হলে null */
  lastTestedAt: Date | null;
  lastError: string | null;
  updatedByName: string | null;
};

/**
 * ★★★ সংরক্ষণের কী — ইচ্ছাকৃতভাবে **কোলন-namespaced**।
 *
 *   `getSettings()` কোলনযুক্ত কী বাদ দেয়, তাই এই দুটি সারি সাধারণ
 *   সেটিংস-ক্যাশে **ঢোকেই না** — অর্থাৎ যে পাতাগুলো পুরো settings
 *   ক্লায়েন্টে পাঠায়, তাদের হাতে গোপন মান কখনো পৌঁছায় না।
 *
 *   ⚠️ পুরনো রূপ `pp_<id>_keys` **প্লেইনটেক্সট** ছিল এবং settings-এ
 *   ঢুকত (কোলন নেই)। সেটিই ফাঁসের পথ ছিল। legacy সারি এখনো পড়া হয়
 *   (পিছন-সঙ্গতি), কিন্তু `settings.ts` এখন `pp_*`-ও বাদ দেয়, তাই
 *   মাইগ্রেশনের আগেও আর ফাঁস হয় না।
 */
const keysKey = (id: string) => `pp:${id}:keys`;
const modeKey = (id: string) => `pp:${id}:mode`;
const legacyKeysKey = (id: string) => `pp_${id}_keys`;
const legacyModeKey = (id: string) => `pp_${id}_mode`;

function parseKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      // শুধু non-empty string মান রাখি
      return Object.fromEntries(
        Object.entries(o).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
      ) as Record<string, string>;
    }
  } catch {
    /* corrupt JSON — খালি ধরে নিই */
  }
  return {};
}

/**
 * ★ সংরক্ষিত কী-বান্ডিল খুলি। নতুন সারি এনক্রিপ্টেড (`v1.…`),
 *   পুরনো সারি প্লেইন JSON — দুটোই সামলাই।
 *
 *   ⚠️ ডিক্রিপ্ট ব্যর্থ হলে (কী বদলেছে/সারি বিকৃত) খালি ফেরত যায়,
 *   throw নয়: একটি নষ্ট সারির কারণে পুরো অ্যাডমিন প্যানেল বা চেকআউট
 *   ৫০০ হয়ে যাওয়া অগ্রহণযোগ্য। প্রোভাইডার তখন "কী নেই" দেখাবে,
 *   অর্থাৎ নিরাপদ দিকে ভেঙে পড়ে (fail safe)।
 */
function openKeyBundle(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  if (!isEncrypted(raw)) return parseKeys(raw); // legacy প্লেইনটেক্সট
  try {
    return parseKeys(decryptSecret(raw));
  } catch {
    logger.error('payments', 'gateway keys decrypt failed (key rotated?)');
    return {};
  }
}

/**
 * একটি প্রোভাইডারের DB কনফিগ পড়ি (সার্ভার-only; সিক্রেট মান সহ)।
 *
 * ★ উৎসের অগ্রাধিকার: `PaymentGatewayConfig` টেবিল → পুরনো `Setting`
 *   সারি (namespaced → legacy প্লেইনটেক্সট)। মাইগ্রেশন না চালালেও
 *   পুরনো কনফিগ কাজ করতেই থাকে — অর্থাৎ এই পরিবর্তন কারও চলমান
 *   সেটআপ ভাঙে না।
 */
export async function getProviderConfig(id: ProviderId | string): Promise<ProviderConfig> {
  const row = await prisma.paymentGatewayConfig.findUnique({ where: { provider: String(id) } });
  if (row) {
    return {
      mode: row.mode === 'live' ? 'live' : 'test',
      keys: openKeyBundle(row.credentials),
      lastTestedAt: row.lastTestedAt,
      lastError: row.lastError,
      updatedByName: row.updatedByName,
    };
  }

  // ── পিছন-সঙ্গতি: পুরনো `Setting`-ভিত্তিক কনফিগ ──
  // ★ সরাসরি DB — `getSettings()` ইচ্ছাকৃতভাবে এই কী-গুলো বাদ দেয়,
  //   তাই ক্যাশ থেকে পড়া সম্ভব নয় (এবং সেটাই কাম্য)।
  const rows = await prisma.setting.findMany({
    where: { key: { in: [keysKey(id), modeKey(id), legacyKeysKey(id), legacyModeKey(id)] } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const rawMode = byKey[modeKey(id)] ?? byKey[legacyModeKey(id)];
  const rawKeys = byKey[keysKey(id)] ?? byKey[legacyKeysKey(id)];

  return {
    mode: rawMode === 'live' ? 'live' : 'test',
    keys: openKeyBundle(rawKeys),
    lastTestedAt: null,
    lastError: null,
    updatedByName: null,
  };
}

/**
 * ★ "Test connection" এর ফল সংরক্ষণ।
 *
 *   ⚠️ ব্যর্থতার বার্তা ছাঁটা হয় ও **কখনো** ক্রেডেনশিয়াল ধারণ করতে
 *   পারে না — গেটওয়ের ত্রুটি-বার্তায় মাঝে মাঝে পাঠানো payload
 *   প্রতিধ্বনিত হয়, আর সেটি অ্যাডমিন UI-তে দেখানো মানে আবার সেই
 *   সিক্রেট ব্রাউজারে ফেরত পাঠানো।
 */
export async function recordTestResult(
  id: ProviderId | string,
  result: { ok: boolean; error?: string },
): Promise<void> {
  const cfg = await getProviderConfig(id);
  const secrets = Object.values(cfg.keys).filter((v) => v.length >= 4);

  let message = result.ok ? null : (result.error || 'অজানা ত্রুটি').slice(0, 300);
  if (message) {
    for (const s of secrets) message = message.split(s).join('***');
  }

  await prisma.paymentGatewayConfig.upsert({
    where: { provider: String(id) },
    update: { lastTestedAt: new Date(), lastError: message },
    create: {
      provider: String(id),
      lastTestedAt: new Date(),
      lastError: message,
      mode: cfg.mode,
      credentials: Object.keys(cfg.keys).length ? encryptSecret(JSON.stringify(cfg.keys)) : '',
    },
  });
}

/**
 * একটি নির্দিষ্ট কী-ফিল্ডের কার্যকর মান (env > DB)।
 * ভবিষ্যতে verify()/refund() বাস্তবায়নের সময় এখান থেকেই কী নেবে।
 */
export async function resolveKey(id: ProviderId | string, field: string): Promise<string | undefined> {
  const envVal = process.env[field];
  if (envVal) return envVal;
  const cfg = await getProviderConfig(id);
  return cfg.keys[field];
}

/**
 * DB বা env — যেকোনোভাবে সব প্রয়োজনীয় কী উপস্থিত কি না।
 * `provider.isConfigured()` (sync) শুধু env দেখে; এটি DB-ও দেখে।
 */
export async function configuredAsync(id: ProviderId | string): Promise<boolean> {
  const provider = getProvider(id);
  if (!provider) return false;
  if (provider.kind === 'MANUAL') return true;
  if (provider.keyFields.length === 0) return false;
  const cfg = await getProviderConfig(id);
  return provider.keyFields.every((k) => Boolean(process.env[k]) || Boolean(cfg.keys[k]));
}

/** কোন কোন কী সেট আছে (masked — মান নয়, শুধু boolean) */
export async function keysSetMap(id: ProviderId | string): Promise<Record<string, boolean>> {
  const provider = getProvider(id);
  if (!provider) return {};
  const cfg = await getProviderConfig(id);
  return Object.fromEntries(
    provider.keyFields.map((k) => [k, Boolean(process.env[k]) || Boolean(cfg.keys[k])])
  );
}

/** env থেকে আসা কী-গুলো (এগুলো DB-তে বদলানো যায় না — শুধু তথ্য) */
export function envProvidedKeys(id: ProviderId | string): string[] {
  const provider = getProvider(id);
  if (!provider) return [];
  return provider.keyFields.filter((k) => Boolean(process.env[k]));
}

/**
 * ★ স্বাস্থ্য/সংযোগ যাচাই — কাঠামোগত (নেটওয়ার্ক কল নয়, কারণ লাইভ
 *   ড্রাইভার এখনো নেই)। সব কী উপস্থিত হলে CONFIGURED_PENDING।
 */
export async function providerHealth(id: ProviderId | string): Promise<ProviderHealth> {
  const provider = getProvider(id);
  if (!provider) {
    return { status: 'NO_KEYS', ok: false, live: false, message: 'প্রোভাইডার পাওয়া যায়নি' };
  }
  if (provider.kind === 'MANUAL') {
    return {
      status: 'MANUAL_READY',
      ok: true,
      live: false,
      message: 'ম্যানুয়াল — সবসময় প্রস্তুত (মানুষ যাচাই করে অনুমোদন করেন)',
    };
  }
  const cfg = await getProviderConfig(id);
  const present = provider.keyFields.filter((k) => Boolean(process.env[k]) || Boolean(cfg.keys[k]));
  if (present.length === 0) {
    return {
      status: 'NO_KEYS',
      ok: false,
      live: false,
      message: 'কোনো API-কী দেওয়া হয়নি — চালু করার আগে কী বসান',
    };
  }
  if (present.length < provider.keyFields.length) {
    const missing = provider.keyFields.filter((k) => !present.includes(k));
    return {
      status: 'PARTIAL_KEYS',
      ok: false,
      live: false,
      message: `আংশিক কনফিগ — বাকি: ${missing.join(', ')}`,
    };
  }
  return {
    status: 'CONFIGURED_PENDING',
    ok: false,
    live: false,
    message: `কী সম্পূর্ণ (${cfg.mode === 'live' ? 'লাইভ' : 'টেস্ট'} মোড)। লাইভ ড্রাইভার বাস্তবায়ন বাকি — এখনো ম্যানুয়ালই চলবে।`,
  };
}

/**
 * ★ প্রোভাইডার কনফিগ সেভ — কী (merge), মোড, enabled একসাথে।
 *   • খালি-স্ট্রিং কী পাঠালে সেই ফিল্ড **মুছে** যায় (কী রিমুভ করার উপায়)।
 *   • অজানা ফিল্ড উপেক্ষা করা হয় (শুধু provider.keyFields গ্রহণযোগ্য)।
 *   • env-এ থাকা কী DB-তে বসানো যায় না (env জেতে) — নীরবে উপেক্ষা।
 */
export async function saveProviderConfig(
  id: ProviderId | string,
  patch: { keys?: Record<string, string>; mode?: ProviderMode; enabled?: boolean },
  actor?: { id: string; name: string },
): Promise<void> {
  const provider = getProvider(id);
  if (!provider) throw new Error('unknown provider');

  const current = await getProviderConfig(id);

  // ★ কী-বান্ডিল merge — অনুপস্থিত ফিল্ড অপরিবর্তিত থাকে, তাই
  //   অ্যাডমিন একটিমাত্র কী বদলাতে গিয়ে বাকিগুলো হারায় না।
  let credentials: string | undefined;
  if (patch.keys && provider.keyFields.length > 0) {
    const next: Record<string, string> = { ...current.keys };
    for (const field of provider.keyFields) {
      if (!(field in patch.keys)) continue;
      if (process.env[field]) continue; // env জেতে — DB-তে রাখি না
      const val = String(patch.keys[field] ?? '').trim();
      if (val === '') delete next[field];
      else next[field] = val;
    }

    // ★★★ at-rest এনক্রিপশন — বিদ্যমান secretbox (AES-256-GCM, HKDF)।
    //   RUN.md: "No new key, no new scheme"। কী আসে NEXTAUTH_SECRET
    //   থেকে, যা env.ts এমনিতেই আবশ্যক করে।
    //
    //   ⚠️ এনক্রিপশন অসম্ভব হলে **সেভ ব্যর্থ হয়** — প্লেইনটেক্সটে
    //   fallback করা মানে নীরবে ঠিক সেই দুর্বলতাই ফিরিয়ে আনা যেটা
    //   এই পরিবর্তন বন্ধ করছে। জোরে ব্যর্থ হওয়াই সঠিক।
    credentials = Object.keys(next).length ? encryptSecret(JSON.stringify(next)) : '';
  }

  const mode = patch.mode ? (patch.mode === 'live' ? 'live' : 'test') : undefined;

  await prisma.$transaction([
    prisma.paymentGatewayConfig.upsert({
      where: { provider: String(id) },
      update: {
        ...(credentials !== undefined ? { credentials } : {}),
        ...(mode ? { mode } : {}),
        ...(typeof patch.enabled === 'boolean' ? { isEnabled: patch.enabled } : {}),
        ...(actor ? { updatedById: actor.id, updatedByName: actor.name } : {}),
      },
      create: {
        provider: String(id),
        credentials: credentials ?? '',
        mode: mode ?? current.mode,
        isEnabled: patch.enabled ?? false,
        updatedById: actor?.id ?? null,
        updatedByName: actor?.name ?? null,
      },
    }),
    // ★ পুরনো `Setting`-ভিত্তিক সারি একই transaction-এ বিদায় —
    //   দুই জায়গায় একই কনফিগ থাকলে কোনটা জিতবে তা অস্পষ্ট হতো,
    //   আর প্লেইনটেক্সট সারিটি DB ডাম্পে পড়া যেত।
    prisma.setting.deleteMany({
      where: {
        key: {
          in: [keysKey(id), modeKey(id), legacyKeysKey(id), legacyModeKey(id), `provider_${id}_enabled`],
        },
      },
    }),
  ]);
  invalidateSettings();
}

/**
 * ★ UI/সার্ভার→ক্লায়েন্ট: সম্পূর্ণ serializable প্রোভাইডার-তালিকা।
 *   কী/মোড/health সহ — কিন্তু **সিক্রেট মান কখনো নয়** (শুধু keysSet boolean)।
 */
export async function providerInfos(): Promise<ProviderInfo[]> {
  const providers = allProviders();
  return Promise.all(
    providers.map(async (p) => {
      const [enabled, cfg, keysSet, health] = await Promise.all([
        isProviderEnabled(p.id),
        getProviderConfig(p.id),
        keysSetMap(p.id),
        providerHealth(p.id),
      ]);
      const configured = p.kind === 'MANUAL'
        ? true
        : p.keyFields.length > 0 && p.keyFields.every((k) => keysSet[k]);
      return {
        id: p.id,
        label: p.label,
        kind: p.kind,
        capabilities: p.capabilities,
        configured,
        enabled,
        mode: cfg.mode,
        keyFields: p.keyFields,
        keysSet,
        envKeys: envProvidedKeys(p.id),
        health,
        // ★ Date সরাসরি ক্লায়েন্টে পাঠানো যায় না — ISO string
        lastTestedAt: cfg.lastTestedAt ? cfg.lastTestedAt.toISOString() : null,
        lastError: cfg.lastError,
        updatedByName: cfg.updatedByName,
      } satisfies ProviderInfo;
    })
  );
}
