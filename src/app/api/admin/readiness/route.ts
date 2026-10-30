import bcrypt from 'bcryptjs';
import { requireAdmin, apiError } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { DEFAULT_SEED_ADMIN_PASSWORD } from '@/lib/seedDefaults';
import { validateEnv } from '@/lib/env';
import { getSystemHealth } from '@/lib/health';
import { providerInfos } from '@/lib/payments/config';
import { allFeatureFlags } from '@/lib/featureFlags';
import { getJobStatuses } from '@/lib/jobRuns';
import { getOtpConfig } from '@/lib/otp/settings';
import { getStorage } from '@/lib/storage';
import { lastClientIpMissingAt } from '@/lib/rateLimit';
import { revokedSessionTableReady } from '@/lib/sessionRevocation';

export const dynamic = 'force-dynamic';

/**
 * ★★★ Release Readiness / One-Click Environment Validation (Phase 4)
 *
 *   GET /api/admin/readiness  (অ্যাডমিন)
 *   এক কলে সব যাচাই — deploy-এর আগে "সব ঠিক আছে?" এর উত্তর:
 *     · env (required/optional)
 *     · সিস্টেম হেলথ (db/email/storage/telegram/monitoring)
 *     · পেমেন্ট প্রোভাইডার (configured/enabled/health)
 *
 *   ⚠️ কোনো সিক্রেট মান ফেরত দেয় না — শুধু আছে/নেই ও অবস্থা।
 *   ⚠️ সৎ readiness: পেমেন্ট প্রোভাইডার live নয় (স্টাব) তা স্পষ্ট দেখায়।
 */
export async function GET() {
  try {
    await requireAdmin();

    const [health, providers, jobs] = await Promise.all([
      getSystemHealth(),
      providerInfos(),
      getJobStatuses(),
    ]);
    const env = validateEnv();
    const flags = await allFeatureFlags();

    // ── সার্বিক readiness স্কোর ──
    // ব্লকার = required env অনুপস্থিত/ভুল, বা critical সাবসিস্টেম down
    const blockers: string[] = [];
    for (const r of env.required) {
      if (!r.present) blockers.push(`env ${r.key} সেট নেই`);
      else if (r.problem) blockers.push(`env ${r.key}: ${r.problem}`);
    }
    for (const s of health.subsystems) {
      if (s.critical && s.state === 'down') blockers.push(`${s.label} অচল`);
    }

    // সতর্কতা = ঐচ্ছিক ফিচার বন্ধ (blocker নয়, কিন্তু জানা দরকার)
    /**
     * ★★★ সৎ readiness (স্বাধীন অডিট, ২০২৬-০৯-১৮)।
     *
     *   আগে কেবল **critical** সাবসিস্টেম (শুধু DB) `ready` ঠিক করত, তাই
     *   ইমেইল অচল থাকলেও (অর্থাৎ **কেউ রেজিস্টারই করতে পারবেন না**) বা
     *   প্রোডাকশনে লোকাল স্টোরেজ থাকলেও (আপলোড করা ফাইল ৪০৪ — মাপা)
     *   endpoint সবুজ দেখাত। যে গেট ভাঙা ফানেলেও সবুজ বলে, সেটি গেট নয়।
     */
    const emailSub = health.subsystems.find((s) => s.key === 'email');
    if (emailSub && emailSub.state !== 'up') {
      const otpCfg = await getOtpConfig();
      if (otpCfg.requireAtSignup) {
        blockers.push(
          `রেজিস্ট্রেশনের OTP ইমেইলে যায়, কিন্তু ইমেইল ${emailSub.state === 'down' ? 'ভুলভাবে কনফিগার' : 'কনফিগার করা নেই'} — নতুন গ্রাহক অ্যাকাউন্ট খুলতে পারবেন না`,
        );
      }
    }
    if (process.env.NODE_ENV === 'production' && getStorage().name === 'local') {
      blockers.push(
        'প্রোডাকশনে STORAGE_DRIVER=local — আপলোড করা ফাইল সার্ভ হয় না (৪০৪); Blob/S3/R2 দিন',
      );
    }

    // ★ AUTH-05 — লগআউট-বাতিল-তালিকার টেবিল নেই = migration প্রয়োগ হয়নি; তখন
    //   প্রতি-ডিভাইস লগআউট কার্যকর নয় (অনুরোধ চলে, কিন্তু কপি করা কুকি বাতিল হয় না)
    if (!(await revokedSessionTableReady())) {
      blockers.push('RevokedSession টেবিল নেই — migration 20260926120000_revoked_sessions প্রয়োগ করুন (লগআউট-বাতিল কাজ করছে না)');
    }

    const warnings: string[] = [];

    /**
     * ★★★ অ্যাডমিন-অ্যাকাউন্টের নিরাপত্তা (release-readiness, ২০২৬-০৯-২৬)।
     *   seed অ-লোকাল DB-তে ডিফল্ট পাসওয়ার্ড বসায় না, কিন্তু আগেই তৈরি লাইভ অ্যাডমিন
     *   রিপোতে-লেখা পাসওয়ার্ডে থেকে গেলে কেউ জানত না। এখন:
     *     · কোনো সক্রিয় অ্যাডমিন রিপোর ডিফল্ট পাসওয়ার্ডে → **ব্লকার** (সবখানে)
     *     · 2FA বন্ধ → প্রোডাকশনে **ব্লকার**, অন্যত্র সতর্কতা
     *   ⚠️ কেবল ইমেইলের মুখোশ-রূপ দেখানো হয়; পাসওয়ার্ড/হ্যাশ কখনো নয়।
     */
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isBanned: false },
      select: { email: true, password: true, twoFactorEnabled: true },
      take: 20,
    });
    const mask = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');
    for (const a of admins) {
      if (await bcrypt.compare(DEFAULT_SEED_ADMIN_PASSWORD, a.password)) {
        blockers.push(`অ্যাডমিন ${mask(a.email)} এখনো রিপোতে-লেখা ডিফল্ট পাসওয়ার্ডে — এখনই বদলান`);
      }
      if (!a.twoFactorEnabled) {
        const msg = `অ্যাডমিন ${mask(a.email)} — 2FA বন্ধ (প্রোফাইল → দুই-ধাপ যাচাই চালু করুন)`;
        if (process.env.NODE_ENV === 'production') blockers.push(msg); else warnings.push(msg);
      }
    }
    for (const s of health.subsystems) {
      if (!s.critical && s.state === 'not_configured') warnings.push(s.detail || `${s.label} কনফিগার নেই`);
    }

    // ★ C2 — শিডিউলড জব বাসি কিনা। blocker নয় (সাইট চলে), কিন্তু
    //   নীরব ব্যর্থতাই ছিল মূল সমস্যা: GitHub Actions বন্ধ হয়ে গেলে
    //   ব্রডকাস্ট ও SLA অ্যালার্ট চুপচাপ থেমে যেত, কেউ টের পেত না।
    for (const j of jobs) {
      // ★★★ OPS-03 — সময়মতো চলছে কিন্তু প্রতিবার **ব্যর্থ** হচ্ছে: আগে `stale`
      //   নয় বলে কোনো সতর্কতাই উঠত না (নীরব ব্যর্থতা)। এখন শেষ রান ব্যর্থ হলেও জানাই।
      if (j.ok === false && !j.stale) {
        warnings.push(`${j.label} — শেষ রান ব্যর্থ (${new Date(j.lastRunAt!).toLocaleString('bn-BD')}): ${(j.detail || 'কারণ অজানা').slice(0, 160)}`);
      }
      if (!j.stale) continue;
      warnings.push(
        j.lastRunAt
          ? `${j.label} — সর্বশেষ ${new Date(j.lastRunAt).toLocaleString('bn-BD')} (প্রতি ${j.expectedEveryMin} মিনিটে চলার কথা)`
          : `${j.label} — কখনো চলেনি (GitHub Actions সিক্রেট/ওয়ার্কফ্লো দেখুন)`,
      );
    }

    // ★ CFG-01 — গত এক ঘণ্টায় কোনো রুটে ক্লায়েন্ট-IP হেডার ছাড়া অনুরোধ এসেছে কি না
    //   (DB-চিহ্ন; সব রুট ও ইনস্ট্যান্স মিলিয়ে)। এলে সব IP-সীমা একটি বাকেটে।
    const lastMissingAt = await lastClientIpMissingAt();
    const clientIp = { lastMissingAt };
    if (lastMissingAt && Date.now() - new Date(lastMissingAt).getTime() < 60 * 60 * 1000) {
      warnings.push(
        'ক্লায়েন্ট-IP হেডার পাওয়া যাচ্ছে না — সব IP-সীমা একটিই বাকেট ভাগ করছে (সারা সাইটের লগইন/রেজিস্ট্রেশন আটকাতে পারে); প্রক্সি/TRUSTED_PROXY কনফিগ দেখুন',
      );
    }

    return Response.json({
      ready: blockers.length === 0,
      blockers,
      warnings,
      clientIp,
      env,
      health,
      payments: providers.map((p) => ({
        id: p.id, label: p.label, kind: p.kind,
        configured: p.configured, enabled: p.enabled,
        mode: p.mode, health: p.health,
      })),
      flags,
      jobs,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}
