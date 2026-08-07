import { requireAdmin, apiError } from '@/lib/guard';
import { validateEnv } from '@/lib/env';
import { getSystemHealth } from '@/lib/health';
import { providerInfos } from '@/lib/payments/config';
import { allFeatureFlags } from '@/lib/featureFlags';
import { getJobStatuses } from '@/lib/jobRuns';

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
    const warnings: string[] = [];
    for (const s of health.subsystems) {
      if (!s.critical && s.state === 'not_configured') warnings.push(s.detail || `${s.label} কনফিগার নেই`);
    }

    // ★ C2 — শিডিউলড জব বাসি কিনা। blocker নয় (সাইট চলে), কিন্তু
    //   নীরব ব্যর্থতাই ছিল মূল সমস্যা: GitHub Actions বন্ধ হয়ে গেলে
    //   ব্রডকাস্ট ও SLA অ্যালার্ট চুপচাপ থেমে যেত, কেউ টের পেত না।
    for (const j of jobs) {
      if (!j.stale) continue;
      warnings.push(
        j.lastRunAt
          ? `${j.label} — সর্বশেষ ${new Date(j.lastRunAt).toLocaleString('bn-BD')} (প্রতি ${j.expectedEveryMin} মিনিটে চলার কথা)`
          : `${j.label} — কখনো চলেনি (GitHub Actions সিক্রেট/ওয়ার্কফ্লো দেখুন)`,
      );
    }

    return Response.json({
      ready: blockers.length === 0,
      blockers,
      warnings,
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
