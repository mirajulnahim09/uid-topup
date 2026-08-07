import { prisma } from '../prisma';
import { getSettings, invalidateSettings } from '../settings';
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
};

const keysKey = (id: string) => `pp_${id}_keys`;
const modeKey = (id: string) => `pp_${id}_mode`;

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

/** একটি প্রোভাইডারের DB কনফিগ পড়ি (সার্ভার-only; সিক্রেট মান সহ) */
export async function getProviderConfig(id: ProviderId | string): Promise<ProviderConfig> {
  const s = await getSettings();
  const mode = s[modeKey(id)] === 'live' ? 'live' : 'test';
  return { mode, keys: parseKeys(s[keysKey(id)]) };
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
  patch: { keys?: Record<string, string>; mode?: ProviderMode; enabled?: boolean }
): Promise<void> {
  const provider = getProvider(id);
  if (!provider) throw new Error('unknown provider');

  const writes: { key: string; value: string }[] = [];

  if (patch.keys && provider.keyFields.length > 0) {
    const current = (await getProviderConfig(id)).keys;
    const next: Record<string, string> = { ...current };
    for (const field of provider.keyFields) {
      if (!(field in patch.keys)) continue;
      if (process.env[field]) continue; // env জেতে — DB-তে রাখি না
      const val = String(patch.keys[field] ?? '').trim();
      if (val === '') delete next[field];
      else next[field] = val;
    }
    writes.push({ key: keysKey(id), value: JSON.stringify(next) });
  }

  if (patch.mode) {
    writes.push({ key: modeKey(id), value: patch.mode === 'live' ? 'live' : 'test' });
  }
  if (typeof patch.enabled === 'boolean') {
    writes.push({ key: `provider_${id}_enabled`, value: patch.enabled ? '1' : '0' });
  }

  if (writes.length === 0) return;

  await prisma.$transaction(
    writes.map((w) =>
      prisma.setting.upsert({
        where: { key: w.key },
        update: { value: w.value },
        create: { key: w.key, value: w.value },
      })
    )
  );
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
      } satisfies ProviderInfo;
    })
  );
}
