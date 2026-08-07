import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { prisma } from '../prisma';
import { getAllBots, BOT_ROLES, type BotRole } from './store';
import { getEventFlags, TELEGRAM_EVENTS } from './events';
import { getTemplates } from './templates';
import { getMe, getChat } from './api';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্যাকআপ ও পুনরুদ্ধার
 *
 *   ── গোপন মান কীভাবে যায় ──
 *   আগের সংস্করণে টোকেন **বাদ** দেওয়া হতো, কারণ DB-র ciphertext অন্য
 *   মেশিনে অর্থহীন (কী আলাদা) আর প্লেইনটেক্সট রপ্তানি করলে ফাইলটিই
 *   একটি ফাঁস। এখন তৃতীয় পথ: **অ্যাডমিনের দেওয়া পাসফ্রেজ** দিয়ে
 *   টোকেন আলাদাভাবে এনক্রিপ্ট করা হয় (scrypt + AES-256-GCM)।
 *
 *   ফলে —
 *   • পাসফ্রেজ ছাড়া ব্যাকআপ (`includeSecrets:false`) → টোকেন নেই, নিরাপদ
 *   • পাসফ্রেজ সহ → টোকেন আছে কিন্তু **ফাইল থেকে পড়া যায় না**;
 *     পুনরুদ্ধারে একই পাসফ্রেজ লাগে
 *
 *   ⚠️ এটি ইনস্টলেশন-কী থেকে **স্বাধীন**, তাই ব্যাকআপ সত্যিই বহনযোগ্য।
 *   scrypt ইচ্ছাকৃতভাবে ধীর (N=2^15) — পাসফ্রেজ দুর্বল হলেও brute-force
 *   ব্যয়বহুল থাকে।
 * ═══════════════════════════════════════════════════════════
 */

export const BACKUP_FORMAT = 'uidtopup.telegram.backup';
export const BACKUP_VERSION = 2;
/** এই সংস্করণগুলো পড়তে পারি (পিছনের-সামঞ্জস্য) */
const READABLE_VERSIONS = [1, 2];

const SCRYPT_N = 32768, SCRYPT_r = 8, SCRYPT_p = 1, KEY_LEN = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 64 * 1024 * 1024 });
}

/** পাসফ্রেজ দিয়ে একটি মান মোড়ানো — `pw1.<salt>.<iv>.<tag>.<data>` */
export function sealWithPassphrase(plain: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['pw1', salt.toString('base64url'), iv.toString('base64url'),
    c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function openWithPassphrase(sealed: string, passphrase: string): string {
  const p = sealed.split('.');
  if (p.length !== 5 || p[0] !== 'pw1') throw new Error('গোপন মানের ফরম্যাট চেনা যায়নি');
  const [, s, i, t, d] = p;
  const key = deriveKey(passphrase, Buffer.from(s, 'base64url'));
  const dec = createDecipheriv('aes-256-gcm', key, Buffer.from(i, 'base64url'));
  dec.setAuthTag(Buffer.from(t, 'base64url'));
  try {
    return Buffer.concat([dec.update(Buffer.from(d, 'base64url')), dec.final()]).toString('utf8');
  } catch {
    // GCM auth ব্যর্থ = ভুল পাসফ্রেজ বা বিকৃত ফাইল — আলাদা করে বলা হয় না
    throw new Error('পাসফ্রেজ ভুল, অথবা ব্যাকআপ ফাইলটি বিকৃত');
  }
}

export type BackupBot = {
  role: BotRole; label: string; description: string | null;
  chatId: string; enabled: boolean; priority: number; events: string[];
  username: string | null; hasToken: boolean;
  /** পাসফ্রেজ দিয়ে সিল করা টোকেন — না চাইলে অনুপস্থিত */
  tokenSealed?: string;
};

export type BackupFile = {
  format: string; version: number; exportedAt: string;
  app: { name: string; schema: number };
  secretsIncluded: boolean;
  enabled: boolean;
  events: Record<string, boolean>;
  bots: BackupBot[];
  templates: { key: string; label: string; body: string; enabled: boolean }[];
  jobs: {
    key: string; label: string; enabled: boolean; kind: string;
    atHour: number; atMinute: number; weekday: number | null;
    dayOfMonth: number | null; timezone: string; botId: string | null; templateKey: string | null;
  }[];
};

/** সম্পূর্ণ ব্যাকআপ তৈরি */
export async function createBackup(opts: { passphrase?: string }): Promise<BackupFile> {
  const [bots, flags, templates, jobs] = await Promise.all([
    getAllBots(),
    getEventFlags(),
    getTemplates(),
    prisma.telegramJob.findMany().catch(() => []),
  ]);

  const includeSecrets = Boolean(opts.passphrase);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: 'SS UID TOPUP', schema: BACKUP_VERSION },
    secretsIncluded: includeSecrets,
    enabled: flags.enabled,
    events: Object.fromEntries(TELEGRAM_EVENTS.map((e) => [e.key, flags.events[e.key]])),
    bots: bots.map((b) => ({
      role: b.role, label: b.label, description: b.description,
      chatId: b.chatId, enabled: b.enabled, priority: b.priority, events: b.events,
      username: b.username, hasToken: Boolean(b.token),
      ...(includeSecrets && b.token
        ? { tokenSealed: sealWithPassphrase(b.token, opts.passphrase as string) }
        : {}),
    })),
    templates: templates.map((t) => ({ key: t.key, label: t.label, body: t.body, enabled: t.enabled })),
    jobs: jobs.map((j) => ({
      key: j.key, label: j.label, enabled: j.enabled, kind: j.kind,
      atHour: j.atHour, atMinute: j.atMinute, weekday: j.weekday,
      dayOfMonth: j.dayOfMonth, timezone: j.timezone,
      botId: j.botId, templateKey: j.templateKey,
    })),
  };
}

// ─────────────────── যাচাই ───────────────────

export type ValidationIssue = { level: 'error' | 'warning'; message: string };
export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  /** আমদানির আগে অ্যাডমিন যা দেখবে */
  preview: {
    version: number; exportedAt: string; secretsIncluded: boolean;
    bots: { label: string; role: string; chatIdMasked: string; events: number; hasToken: boolean }[];
    events: { enabled: number; total: number };
    templates: number;
    jobs: number;
  } | null;
  /** বিদ্যমান কনফিগ যা প্রতিস্থাপিত হবে */
  willReplace: { bots: number; templates: number; jobs: number } | null;
};

const maskId = (id: string) =>
  !id ? '(নেই)' : id.length <= 4 ? '•'.repeat(id.length)
    : `${id.startsWith('-') ? '-' : ''}${'•'.repeat(Math.max(3, id.length - 4))}${id.slice(-4)}`;

/**
 * স্কিমা + বিষয়বস্তু যাচাই। **কিছুই লেখে না** — শুধু বলে কী হবে।
 * `deep` দিলে টেলিগ্রামে গিয়ে বট ও chat_id-ও যাচাই করে।
 */
export async function validateBackup(
  raw: unknown,
  opts: { passphrase?: string; deep?: boolean } = {},
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const bad = (m: string) => { issues.push({ level: 'error', message: m }); };
  const warn = (m: string) => { issues.push({ level: 'warning', message: m }); };

  if (!raw || typeof raw !== 'object') {
    bad('ফাইলটি JSON অবজেক্ট নয় — সম্ভবত বিকৃত');
    return { valid: false, issues, preview: null, willReplace: null };
  }
  const f = raw as Partial<BackupFile>;

  if (f.format !== BACKUP_FORMAT) {
    bad(`এটি টেলিগ্রাম ব্যাকআপ ফাইল নয় (format="${String(f.format ?? 'অনুপস্থিত')}")`);
    return { valid: false, issues, preview: null, willReplace: null };
  }
  if (typeof f.version !== 'number' || !READABLE_VERSIONS.includes(f.version)) {
    bad(`সংস্করণ ${String(f.version)} এই অ্যাপ পড়তে পারে না (সমর্থিত: ${READABLE_VERSIONS.join(', ')})`);
    return { valid: false, issues, preview: null, willReplace: null };
  }
  if (f.version < BACKUP_VERSION) {
    warn(`পুরনো সংস্করণ (${f.version}) — অনুপস্থিত ক্ষেত্রগুলো ডিফল্টে বসবে`);
  }

  if (!Array.isArray(f.bots)) bad('bots তালিকা অনুপস্থিত বা ভুল ধরনের');
  if (f.events && typeof f.events !== 'object') bad('events অবজেক্ট ভুল ধরনের');

  const bots = Array.isArray(f.bots) ? f.bots : [];
  const validEvents = new Set<string>(TELEGRAM_EVENTS.map((e) => e.key));

  for (const [i, b] of bots.entries()) {
    const where = `bots[${i}]`;
    if (!b || typeof b !== 'object') { bad(`${where} বিকৃত`); continue; }
    if (!(BOT_ROLES as readonly string[]).includes(String(b.role))) {
      bad(`${where}: অজানা role "${String(b.role)}"`);
    }
    if (typeof b.label !== 'string' || !b.label.trim()) warn(`${where}: নাম নেই`);
    if (b.chatId && !/^-?\d+$/.test(String(b.chatId)) && !String(b.chatId).startsWith('@')) {
      bad(`${where}: chat_id দেখতে অবৈধ ("${String(b.chatId).slice(0, 20)}")`);
    }
    if (Array.isArray(b.events)) {
      const unknown = b.events.filter((e) => !validEvents.has(String(e)));
      if (unknown.length) warn(`${where}: অচেনা ইভেন্ট বাদ যাবে — ${unknown.slice(0, 3).join(', ')}`);
    }
    if (b.tokenSealed && !opts.passphrase) {
      warn(`${where}: টোকেন সিল করা আছে কিন্তু পাসফ্রেজ দেওয়া হয়নি — টোকেন আমদানি হবে না`);
    }
  }

  if (f.secretsIncluded && !opts.passphrase) {
    warn('এই ব্যাকআপে গোপন মান আছে — পাসফ্রেজ ছাড়া সেগুলো পুনরুদ্ধার হবে না');
  }

  // ── পাসফ্রেজ দিলে সত্যিই খোলে কি না দেখি ──
  const opened: (string | null)[] = [];
  if (opts.passphrase) {
    for (const [i, b] of bots.entries()) {
      if (!b?.tokenSealed) { opened.push(null); continue; }
      try {
        opened.push(openWithPassphrase(b.tokenSealed, opts.passphrase));
      } catch (e) {
        opened.push(null);
        bad(`bots[${i}]: ${e instanceof Error ? e.message : 'টোকেন খোলা যায়নি'}`);
      }
    }
  }

  // ── গভীর যাচাই: টেলিগ্রামে সত্যিই কাজ করে কি না ──
  if (opts.deep && opts.passphrase) {
    for (const [i, b] of bots.entries()) {
      const tok = opened[i];
      if (!tok) continue;
      const me = await getMe(tok);
      if (!me.ok) {
        bad(`bots[${i}] "${b.label}": টোকেন টেলিগ্রামে গ্রহণযোগ্য নয় — ${me.description ?? 'অজানা'}`);
        continue;
      }
      if (b.chatId) {
        const chat = await getChat(tok, String(b.chatId));
        if (!chat.ok) warn(`bots[${i}] "${b.label}": chat_id পৌঁছানো যাচ্ছে না — ${chat.description ?? 'অজানা'}`);
      }
    }
  }

  const hasError = issues.some((i) => i.level === 'error');

  const [existingBots, existingTemplates, existingJobs] = await Promise.all([
    getAllBots().then((b) => b.filter((x) => x.source === 'db').length).catch(() => 0),
    prisma.telegramTemplate.count().catch(() => 0),
    prisma.telegramJob.count().catch(() => 0),
  ]);

  return {
    valid: !hasError,
    issues,
    preview: hasError ? null : {
      version: f.version,
      exportedAt: String(f.exportedAt ?? ''),
      secretsIncluded: Boolean(f.secretsIncluded),
      bots: bots.map((b) => ({
        label: String(b.label ?? '—'),
        role: String(b.role ?? '—'),
        chatIdMasked: maskId(String(b.chatId ?? '')),
        events: Array.isArray(b.events) ? b.events.length : 0,
        hasToken: Boolean(b.tokenSealed),
      })),
      events: {
        enabled: Object.values(f.events ?? {}).filter(Boolean).length,
        total: Object.keys(f.events ?? {}).length,
      },
      templates: Array.isArray(f.templates) ? f.templates.length : 0,
      jobs: Array.isArray(f.jobs) ? f.jobs.length : 0,
    },
    willReplace: { bots: existingBots, templates: existingTemplates, jobs: existingJobs },
  };
}

// ─────────────────── পুনরুদ্ধার ───────────────────

export type RestoreResult = {
  bots: number; templates: number; jobs: number; settings: number;
  tokensRestored: number; warnings: string[];
};

/**
 * ব্যাকআপ প্রয়োগ। **শুধু যাচাই পাশ করলে** ডাকা উচিত — রুট নিজেই
 * আগে `validateBackup()` চালায়।
 *
 * ⚠️ `replace: true` না দিলে বিদ্যমান বট **মুছে যায় না**; নতুনগুলো
 *    যোগ হয়। নিশ্চিতকরণ ছাড়া কনফিগ হারানো এই সিস্টেমে সবচেয়ে বড়
 *    ক্ষতি, তাই ধ্বংসাত্মক পথটি স্পষ্টভাবে চাইতে হয়।
 */
export async function restoreBackup(
  raw: unknown,
  opts: { passphrase?: string; replace?: boolean },
): Promise<RestoreResult> {
  const f = raw as BackupFile;
  const warnings: string[] = [];
  const out: RestoreResult = { bots: 0, templates: 0, jobs: 0, settings: 0, tokensRestored: 0, warnings };

  const { upsertBot, resetAllBots } = await import('./store');
  const { eventSettingKey, MASTER_KEY } = await import('./events');
  const { invalidateSettings } = await import('../settings');
  const validEvents = new Set<string>(TELEGRAM_EVENTS.map((e) => e.key));

  if (opts.replace) await resetAllBots();

  // ── বট ──
  for (const b of f.bots ?? []) {
    if (!(BOT_ROLES as readonly string[]).includes(String(b.role))) continue;
    let token: string | undefined;
    if (b.tokenSealed && opts.passphrase) {
      try { token = openWithPassphrase(b.tokenSealed, opts.passphrase); out.tokensRestored++; }
      catch { warnings.push(`"${b.label}": টোকেন খোলা যায়নি — পরে হাতে বসাতে হবে`); }
    }
    await upsertBot({
      role: b.role as BotRole,
      label: b.label,
      description: b.description ?? null,
      chatId: b.chatId ?? '',
      enabled: b.enabled !== false && Boolean(token || b.chatId),
      priority: typeof b.priority === 'number' ? b.priority : 100,
      events: Array.isArray(b.events) ? b.events.filter((e) => validEvents.has(e)) : [],
      username: b.username ?? null,
      ...(token ? { token } : {}),
    });
    out.bots++;
  }

  // ── ইভেন্ট সুইচ (allowlist) ──
  const rows: { key: string; value: string }[] = [];
  if (typeof f.enabled === 'boolean') rows.push({ key: MASTER_KEY, value: f.enabled ? '1' : '0' });
  for (const [k, v] of Object.entries(f.events ?? {})) {
    if (!validEvents.has(k)) continue;
    rows.push({ key: eventSettingKey(k), value: v ? '1' : '0' });
  }
  if (rows.length) {
    await prisma.$transaction(rows.map((r) =>
      prisma.setting.upsert({ where: { key: r.key }, update: { value: r.value }, create: r })));
    out.settings = rows.length;
  }

  // ── টেমপ্লেট ──
  for (const t of f.templates ?? []) {
    if (!t?.key || typeof t.body !== 'string') continue;
    await prisma.telegramTemplate.upsert({
      where: { key: t.key },
      update: { body: t.body, enabled: t.enabled !== false, label: t.label ?? t.key },
      create: { key: t.key, body: t.body, enabled: t.enabled !== false, label: t.label ?? t.key },
    }).catch(() => { warnings.push(`টেমপ্লেট "${t.key}" পুনরুদ্ধার হয়নি`); });
    out.templates++;
  }

  // ── জব (সময়সূচি; রান-ইতিহাস ব্যাকআপে থাকে না, ইচ্ছাকৃত) ──
  for (const j of f.jobs ?? []) {
    if (!j?.key) continue;
    const data = {
      label: j.label ?? j.key, enabled: Boolean(j.enabled), kind: j.kind ?? 'DAILY',
      atHour: Number(j.atHour ?? 9), atMinute: Number(j.atMinute ?? 0),
      weekday: j.weekday ?? null, dayOfMonth: j.dayOfMonth ?? null,
      timezone: j.timezone || 'Asia/Dhaka',
      botId: j.botId ?? null, templateKey: j.templateKey ?? null,
    };
    await prisma.telegramJob.upsert({
      where: { key: j.key }, update: data, create: { key: j.key, ...data },
    }).catch(() => { warnings.push(`জব "${j.key}" পুনরুদ্ধার হয়নি`); });
    out.jobs++;
  }

  invalidateSettings();
  return out;
}
