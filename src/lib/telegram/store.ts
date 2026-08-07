import { prisma } from '../prisma';
import { getSettings, invalidateSettings } from '../settings';
import { encryptSecret, decryptSecret, isEncrypted, isSecretBoxReady } from '../secretbox';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেলিগ্রাম কনফিগ স্টোর — বহু-বট, এনক্রিপ্টেড, DB-প্রথম
 *
 *   ── কেন নতুন করে ──
 *   আগের ব্যবস্থা `.env`-নির্ভর ছিল। EXE হিসেবে বিতরণ করা অ্যাপে
 *   ব্যবহারকারী `.env` সম্পাদনা করবে না — সব অ্যাডমিন প্যানেল থেকে
 *   হতে হবে। তাই অগ্রাধিকার **উল্টে গেছে**:
 *
 *     ১. ডাটাবেস (এনক্রিপ্টেড)  ← অ্যাডমিন প্যানেল এখানে লেখে
 *     ২. এনভায়রনমেন্ট (.env)   ← কেবল প্রথম ইনস্টল/ডেভ-এর সুবিধা
 *
 *   DB-তে কনফিগ থাকলে env উপেক্ষিত। ফলে ইনস্টলের পর `.env` ছোঁয়ার
 *   দরকার নেই — এটাই এই পুরো কাজের মূল উদ্দেশ্য।
 *
 *   ── বহু-বট ──
 *   প্রতিটি বটের একটি **role** আছে (admin / customer / marketing /
 *   support)। ব্যবসায়িক কোড role চায়, নির্দিষ্ট বট নয় — তাই বট
 *   বদলানো মানে শুধু কনফিগ বদল, কোড নয়।
 *
 *   ── সংরক্ষণ কোথায় ──
 *   `Setting` টেবিলে একটিমাত্র JSON সারি (`telegram_bots`)। আলাদা
 *   টেবিল প্রকৌশলগতভাবে বেশি পরিচ্ছন্ন হতো, কিন্তু এই প্রকল্প
 *   `prisma db push` ব্যবহার করে (versioned migration নেই), আর চালু
 *   প্রোডাকশন DB-তে স্কিমা বদলানো এই কাজের জন্য অপ্রয়োজনীয় ঝুঁকি।
 *   পুরো পড়া/লেখা এই ফাইলের ভেতরে আবদ্ধ — পরে টেবিলে সরাতে হলে
 *   শুধু এই ফাইল বদলাবে, কল-সাইট নয়।
 * ═══════════════════════════════════════════════════════════
 */

export const BOT_ROLES = ['admin', 'customer', 'marketing', 'support', 'monitoring'] as const;
export type BotRole = (typeof BOT_ROLES)[number];

export const ROLE_LABEL: Record<BotRole, string> = {
  admin: 'অ্যাডমিন অ্যালার্ট বট',
  customer: 'কাস্টমার নোটিফিকেশন বট',
  marketing: 'মার্কেটিং বট',
  support: 'সাপোর্ট বট',
  monitoring: 'মনিটরিং বট',
};

/**
 * ★ প্রতিটি role-এর **প্রস্তাবিত** ইভেন্ট — নতুন বট তৈরির সময়
 *   পূর্বনির্বাচিত থাকে। অ্যাডমিন চাইলে বদলাতে পারে; এটি শুধু
 *   সংবেদনশীল ডিফল্ট, কোনো কঠিন নিয়ম নয়।
 */
export const ROLE_DEFAULT_EVENTS: Record<BotRole, string[]> = {
  admin: ['deposit_new', 'deposit_approved', 'deposit_rejected', 'wallet_credit',
    'refund', 'order_new', 'maintenance', 'security_alert', 'server_warning', 'low_stock'],
  customer: ['order_completed', 'wallet_credit', 'coupon'],
  marketing: ['campaign', 'coupon'],
  support: ['order_new', 'refund', 'user_registered'],
  monitoring: ['server_warning', 'security_alert', 'low_stock', 'maintenance'],
};

export const BOTS_KEY = 'telegram_bots';
export const ACTIVE_KEY = 'telegram_active_bot';

/** DB-তে যেভাবে থাকে (টোকেন এনক্রিপ্টেড) */
type StoredBot = {
  id: string;
  role: BotRole;
  label: string;
  /** `v1.…` এনক্রিপ্টেড টোকেন */
  tokenEnc: string;
  chatId: string;
  enabled: boolean;
  botId?: number | null;
  username?: string | null;
  name?: string | null;
  photoUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // ── এন্টারপ্রাইজ ক্ষেত্র (সব ঐচ্ছিক — পুরনো সারি অক্ষত থাকে) ──
  description?: string | null;
  /** কম সংখ্যা = বেশি অগ্রাধিকার (drag-and-drop এই মান বদলায়) */
  priority?: number;
  /** এই বট কোন ইভেন্টগুলো পাবে। খালি = role-ডিফল্ট (পিছনের-সামঞ্জস্য) */
  events?: string[];
};

/** কোডে যেভাবে ব্যবহার হয় (টোকেন ডিক্রিপ্টেড — কখনো ক্লায়েন্টে নয়) */
export type ResolvedBot = {
  id: string;
  role: BotRole;
  label: string;
  token: string;
  chatId: string;
  enabled: boolean;
  botId: number | null;
  username: string | null;
  name: string | null;
  photoUrl: string | null;
  description: string | null;
  priority: number;
  events: string[];
  /** কনফিগ কোথা থেকে এলো */
  source: 'db' | 'env';
};

/** ক্লায়েন্টে পাঠানোর জন্য নিরাপদ রূপ — **টোকেন নেই** */
export type PublicBot = Omit<ResolvedBot, 'token' | 'chatId'> & {
  tokenMasked: string;
  chatIdMasked: string;
  hasToken: boolean;
  hasChatId: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

/** টোকেনের নিরাপদ প্রদর্শন — গোপন অংশ কখনো নয় */
export function maskToken(token: string): string {
  if (!token) return '';
  const id = token.split(':')[0] || '';
  return `${id}:${'•'.repeat(12)}`;
}

export function maskChatId(id: string): string {
  if (!id) return '';
  if (id.length <= 4) return '•'.repeat(id.length);
  const sign = id.startsWith('-') ? '-' : '';
  return `${sign}${'•'.repeat(Math.max(3, id.length - 4 - sign.length))}${id.slice(-4)}`;
}

function sanitize(v: string | undefined | null): string {
  if (!v) return '';
  return v.trim().replace(/^["']|["']$/g, '').trim();
}

// ─────────────────────────── পড়া ───────────────────────────

async function readStored(): Promise<StoredBot[]> {
  try {
    const s = await getSettings();
    const raw = s[BOTS_KEY];
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is StoredBot => Boolean(b && typeof b === 'object'));
  } catch {
    // ★ বিকৃত JSON থাকলে "কোনো বট নেই" — কখনো throw নয়, নাহলে
    //   একটি নষ্ট সারি পুরো অ্যাপের নোটিফিকেশন ভেঙে দিত।
    return [];
  }
}

/** env থেকে fallback বট (কেবল DB খালি থাকলে) */
function envBot(): ResolvedBot | null {
  const token = sanitize(process.env.TELEGRAM_BOT_TOKEN);
  if (!token) return null;
  return {
    id: 'env',
    role: 'admin',
    label: 'অ্যাডমিন বট (.env)',
    token,
    chatId: sanitize(process.env.TELEGRAM_CHAT_ID),
    enabled: true,
    botId: null,
    username: null,
    name: null,
    photoUrl: null,
    description: null,
    priority: 100,
    events: [],
    source: 'env',
  };
}

/**
 * সব বট — **অগ্রাধিকার: DB > env**।
 * DB-তে অন্তত একটি বট থাকলে env সম্পূর্ণ উপেক্ষিত (মিশ্রণ নয়,
 * নাহলে "কোনটা আসলে চলছে" বোঝা অসম্ভব হতো)।
 */
export async function getAllBots(): Promise<ResolvedBot[]> {
  const stored = await readStored();

  if (stored.length > 0) {
    const out: ResolvedBot[] = [];
    for (const b of stored) {
      let token = '';
      try {
        token = b.tokenEnc ? decryptSecret(b.tokenEnc) : '';
      } catch {
        // ★ কী বদলে গেলে ডিক্রিপ্ট ব্যর্থ — বটটি "টোকেনহীন" হিসেবে
        //   দেখাবে, অ্যাপ ক্র্যাশ করবে না। UI পুনরায় সেট করতে বলবে।
        token = '';
      }
      out.push({
        id: b.id,
        role: b.role,
        label: b.label,
        token,
        chatId: b.chatId || '',
        enabled: b.enabled !== false,
        botId: b.botId ?? null,
        username: b.username ?? null,
        name: b.name ?? null,
        photoUrl: b.photoUrl ?? null,
        description: b.description ?? null,
        priority: typeof b.priority === 'number' ? b.priority : 100,
        events: Array.isArray(b.events) ? b.events : [],
        source: 'db',
      });
    }
    // ★ অগ্রাধিকার অনুসারে — কম সংখ্যা আগে
    out.sort((a, b) => a.priority - b.priority);
    return out;
  }

  const e = envBot();
  return e ? [e] : [];
}

/**
 * ★★★ একটি ইভেন্ট কোন কোন বটে যাবে — **অগ্রাধিকার ক্রমে**।
 *
 *   নিয়ম:
 *   • বট সক্রিয় হতে হবে, টোকেন ও chat_id থাকতে হবে
 *   • `events` তালিকায় ইভেন্টটি থাকলে সেটি পাবে
 *   • `events` **খালি** থাকলে role-ডিফল্ট প্রযোজ্য — এতে পুরনো
 *     (একক-বট) কনফিগ আগের মতোই সব ইভেন্ট পায়, কিছু ভাঙে না
 *
 *   একাধিক বট মিললে **সবাই** পায় (fan-out); অগ্রাধিকার শুধু ক্রম ঠিক করে।
 */
export async function getBotsForEvent(event?: string): Promise<ResolvedBot[]> {
  const bots = (await getAllBots()).filter((b) => b.enabled && b.token && b.chatId);
  if (!event) {
    // শ্রেণিভুক্ত নয় এমন বার্তা → শুধু admin বট
    return bots.filter((b) => b.role === 'admin');
  }
  const matched = bots.filter((b) =>
    b.events.length > 0 ? b.events.includes(event) : ROLE_DEFAULT_EVENTS[b.role]?.includes(event),
  );
  // ★ কোনো বট নির্দিষ্টভাবে না চাইলে admin বটই শেষ ভরসা — নাহলে
  //   একটি ইভেন্ট নীরবে হারিয়ে যেত।
  if (matched.length === 0) return bots.filter((b) => b.role === 'admin');
  return matched;
}

/** নির্দিষ্ট role-এর সক্রিয় বট — ব্যবসায়িক কোড এটিই ব্যবহার করে */
export async function getBotForRole(role: BotRole): Promise<ResolvedBot | null> {
  const bots = await getAllBots();
  const match = bots.find((b) => b.role === role && b.enabled && b.token);
  if (match) return match;
  // ★ role-নির্দিষ্ট বট না থাকলে admin বটই fallback — নাহলে নতুন role
  //   যোগ করামাত্র সেই নোটিফিকেশনগুলো নীরবে হারিয়ে যেত।
  if (role !== 'admin') {
    const adminBot = bots.find((b) => b.role === 'admin' && b.enabled && b.token);
    if (adminBot) return adminBot;
  }
  return null;
}

/** প্রধান (অ্যাডমিন) বট — পুরনো কল-সাইটগুলোর সমতুল্য */
export async function getPrimaryBot(): Promise<ResolvedBot | null> {
  return getBotForRole('admin');
}

/** ক্লায়েন্ট-নিরাপদ রূপ (টোকেন বাদ, chat_id মাস্কড) */
export function toPublic(b: ResolvedBot): PublicBot {
  const { token, chatId, ...rest } = b;
  return {
    ...rest,
    tokenMasked: maskToken(token),
    chatIdMasked: maskChatId(chatId),
    hasToken: Boolean(token),
    hasChatId: Boolean(chatId),
  };
}

// ─────────────────────────── লেখা ───────────────────────────

async function writeStored(bots: StoredBot[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: BOTS_KEY },
    update: { value: JSON.stringify(bots) },
    create: { key: BOTS_KEY, value: JSON.stringify(bots) },
  });
  // ★ কনফিগ বদল সাথে সাথে কার্যকর হওয়া দরকার
  invalidateSettings();
}

export type UpsertBotInput = {
  id?: string;
  role?: BotRole;
  label?: string;
  /** প্লেইন টোকেন — এখানেই এনক্রিপ্ট হয়ে যায় */
  token?: string;
  chatId?: string;
  enabled?: boolean;
  botId?: number | null;
  username?: string | null;
  name?: string | null;
  photoUrl?: string | null;
  description?: string | null;
  priority?: number;
  events?: string[];
};

/**
 * বট তৈরি বা হালনাগাদ। টোকেন **সবসময়** এনক্রিপ্ট করে রাখা হয়।
 * `token` না দিলে আগেরটি অপরিবর্তিত থাকে (ফাঁকা মানে "মুছে ফেলো" নয় —
 * নাহলে টোকেন না লিখে একবার সেভ করলেই সংযোগ ভেঙে যেত)।
 */
export async function upsertBot(input: UpsertBotInput): Promise<ResolvedBot> {
  if (!isSecretBoxReady()) {
    throw new Error('এনক্রিপশন কী নেই — NEXTAUTH_SECRET সেট করুন।');
  }

  const stored = await readStored();
  const id = input.id || `bot_${Date.now().toString(36)}`;
  const idx = stored.findIndex((b) => b.id === id);
  const prev = idx >= 0 ? stored[idx] : undefined;

  const token = input.token !== undefined ? sanitize(input.token) : undefined;

  const next: StoredBot = {
    id,
    role: input.role ?? prev?.role ?? 'admin',
    label: input.label ?? prev?.label ?? ROLE_LABEL[input.role ?? prev?.role ?? 'admin'],
    tokenEnc:
      token !== undefined && token !== ''
        ? encryptSecret(token)
        : prev?.tokenEnc ?? '',
    chatId: input.chatId !== undefined ? sanitize(input.chatId) : prev?.chatId ?? '',
    enabled: input.enabled !== undefined ? input.enabled : prev?.enabled ?? true,
    botId: input.botId !== undefined ? input.botId : prev?.botId ?? null,
    username: input.username !== undefined ? input.username : prev?.username ?? null,
    name: input.name !== undefined ? input.name : prev?.name ?? null,
    photoUrl: input.photoUrl !== undefined ? input.photoUrl : prev?.photoUrl ?? null,
    description: input.description !== undefined ? input.description : prev?.description ?? null,
    priority: input.priority !== undefined ? input.priority : prev?.priority ?? 100,
    // ★ নতুন বটে events না দিলে role-ডিফল্ট বসে; বিদ্যমান বটে আগেরটাই থাকে
    events: input.events !== undefined
      ? input.events
      : prev?.events ?? (prev ? [] : [...(ROLE_DEFAULT_EVENTS[input.role ?? 'admin'] ?? [])]),
    createdAt: prev?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  if (idx >= 0) stored[idx] = next;
  else stored.push(next);

  await writeStored(stored);

  return {
    id: next.id,
    role: next.role,
    label: next.label,
    token: next.tokenEnc ? decryptSecret(next.tokenEnc) : '',
    chatId: next.chatId,
    enabled: next.enabled,
    botId: next.botId ?? null,
    username: next.username ?? null,
    name: next.name ?? null,
    photoUrl: next.photoUrl ?? null,
    description: next.description ?? null,
    priority: next.priority ?? 100,
    events: next.events ?? [],
    source: 'db',
  };
}

/**
 * ★ বট নকল করা — টোকেন **কপি হয় না**।
 *
 *   কেন: দুটি "বট" একই টোকেন ভাগ করলে সেগুলো আসলে একই বট, শুধু দুটি
 *   গন্তব্য — আর একটি টোকেন বাতিল করলে দুটোই মরে। নকলের উদ্দেশ্য
 *   কাঠামো (role, ইভেন্ট, অগ্রাধিকার) পুনর্ব্যবহার, পরিচয় নয়।
 */
export async function duplicateBot(id: string): Promise<ResolvedBot | null> {
  const bots = await getAllBots();
  const src = bots.find((b) => b.id === id);
  if (!src) return null;
  return upsertBot({
    role: src.role,
    label: `${src.label} (কপি)`,
    description: src.description,
    chatId: '',
    priority: src.priority + 1,
    events: [...src.events],
    enabled: false, // টোকেন ছাড়া চালু রাখার মানে নেই
  });
}

/** অগ্রাধিকার পুনর্বিন্যাস (drag-and-drop এর ফল সংরক্ষণ) */
export async function reorderBots(orderedIds: string[]): Promise<void> {
  const stored = await readStored();
  orderedIds.forEach((id, i) => {
    const b = stored.find((x) => x.id === id);
    if (b) { b.priority = (i + 1) * 10; b.updatedAt = nowIso(); }
  });
  await writeStored(stored);
}

export async function deleteBot(id: string): Promise<void> {
  const stored = await readStored();
  await writeStored(stored.filter((b) => b.id !== id));
}

/** সম্পূর্ণ রিসেট — সব বট কনফিগ মুছে যায় (env fallback ফিরে আসে) */
export async function resetAllBots(): Promise<void> {
  await writeStored([]);
}

export async function setBotEnabled(id: string, enabled: boolean): Promise<void> {
  const stored = await readStored();
  const b = stored.find((x) => x.id === id);
  if (!b) return;
  b.enabled = enabled;
  b.updatedAt = nowIso();
  await writeStored(stored);
}

/** কনফিগার করা আছে কি না — উইজার্ড স্বয়ংক্রিয়ভাবে দেখানোর সিদ্ধান্ত */
export async function isConfigured(): Promise<boolean> {
  const bot = await getPrimaryBot();
  return Boolean(bot && bot.token && bot.chatId);
}

/** DB-তে সত্যিই কনফিগ আছে কি না (env-fallback বাদ দিয়ে) */
export async function hasDbConfig(): Promise<boolean> {
  const stored = await readStored();
  return stored.length > 0;
}

/**
 * ★ env → DB মাইগ্রেশন। প্রথম ইনস্টলে `.env`-এ টোকেন থাকলে সেটিকে
 *   এনক্রিপ্ট করে DB-তে তুলে আনে, যাতে এরপর থেকে `.env` অপ্রয়োজনীয়।
 *   ইতিমধ্যে DB কনফিগ থাকলে কিছুই করে না।
 */
export async function adoptEnvConfig(): Promise<ResolvedBot | null> {
  if (await hasDbConfig()) return null;
  const e = envBot();
  if (!e || !e.token) return null;
  return upsertBot({
    role: 'admin',
    label: ROLE_LABEL.admin,
    token: e.token,
    chatId: e.chatId,
    enabled: true,
  });
}

/** ইতিমধ্যে এনক্রিপ্ট করা কি না — import যাচাইয়ে দরকার */
export { isEncrypted };
