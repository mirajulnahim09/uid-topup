import { ApiError } from '../guard';
import { requireApiKey, type ApiKeyActor } from '../apiKey';
import { rateLimit, peekRateLimit, LIMITS, getIp } from '../rateLimit';

/** Read endpoints are cheap but still bounded per key. */
const READ_LIMIT = { limit: 120, window: 60 };

/**
 * Shared auth for the read-only reseller endpoints. Same brute-force gate
 * as the order endpoint: failed keys are counted per IP, and a valid key
 * is rate-limited on its own bucket (separate from order placement).
 */
export async function requireResellerRead(req: Request): Promise<ApiKeyActor> {
  const ip = getIp(req);
  const gate = await peekRateLimit(`rslauth:${ip}`, LIMITS.resellerAuth.limit);
  if (gate.limited) {
    throw new ApiError(`অনেকবার ভুল কী দেওয়া হয়েছে। ${gate.retryAfter} সেকেন্ড পর চেষ্টা করুন।`, 429);
  }
  let actor: ApiKeyActor;
  try {
    actor = await requireApiKey(req);
  } catch (e) {
    await rateLimit(`rslauth:${ip}`, LIMITS.resellerAuth.limit, LIMITS.resellerAuth.window);
    throw e;
  }
  const rl = await rateLimit(`rslread:${actor.keyId}`, READ_LIMIT.limit, READ_LIMIT.window);
  if (!rl.ok) throw new ApiError(`অনেক বেশি অনুরোধ। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`, 429);
  return actor;
}
