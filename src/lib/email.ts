import { Resend } from 'resend';
import { logger } from './logger';
import { BRAND } from './brand';
import { getBranding, absoluteUrl } from './branding';

/**
 * ★ Email fail করলে কখনো main flow ভাঙবে না।
 *   RESEND_API_KEY না থাকলে চুপচাপ skip করে।
 */
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || BRAND.emailFrom;

const resend = KEY ? new Resend(KEY) : null;

export function isEmailConfigured(): boolean {
  return Boolean(resend);
}

/**
 * ★★★ প্রেরকের ঠিকানা এখনো Resend-এর **স্যান্ডবক্স** ডোমেইনে কিনা।
 *
 *   ⚠️ কেন এটি আলাদা করে জানা দরকার: `RESEND_API_KEY` থাকলেই ইমেইল
 *   "কনফিগার করা" মনে হয়, অথচ `EMAIL_FROM` ডিফল্টে
 *   `onboarding@resend.dev` — Resend-এর স্যান্ডবক্স প্রেরক, যা দিয়ে
 *   **কেবল অ্যাকাউন্টের নিজের ঠিকানায়** মেইল যায়। ফলে প্রোডাকশনে
 *   প্রতিটি নতুন গ্রাহকের OTP ও পাসওয়ার্ড-রিসেট নীরবে ব্যর্থ হয়,
 *   অথচ হেলথ-চেক সবুজ দেখায়। ঠিক এই অবস্থাতেই সাইটটি ছিল
 *   (HANDOFF §১ — লঞ্চ-ব্লকার ১)।
 *
 *   সমাধান কোডে নয়, কনফিগে: resend.com/domains এ ডোমেইন verify,
 *   DNS-এ SPF ও DKIM, তারপর `EMAIL_FROM` ঐ ডোমেইনের ঠিকানায়।
 */
export function isSandboxSender(): boolean {
  return /@resend\.dev/i.test(FROM);
}

const base = () => process.env.NEXTAUTH_URL || 'http://localhost:3000';

/**
 * ★ ইমেইল হেডার — অ্যাডমিনের আপলোড করা লোগো থাকলে সেটি, নাহলে
 *   দুই-টোন ওয়ার্ডমার্ক।
 *
 *   ⚠️ ইমেইলে **আপেক্ষিক পথ চলে না** — ইমেইল ক্লায়েন্টের কোনো
 *   "সাইট" নেই, তাই `/uploads/x.png` কোথাও খুঁজে পাবে না। তাই
 *   `absoluteUrl()` দিয়ে পূর্ণ URL বানানো হয়; সাইট URL সেট না
 *   থাকলে ছবি বাদ দিয়ে লেখা-ওয়ার্ডমার্কে পড়ে যাই (ভাঙা ছবির
 *   আইকন দেখানোর চেয়ে সেটি ভালো)।
 */
async function brandHeader(): Promise<string> {
  try {
    const b = await getBranding();
    const raw = b.logos.email.dark || b.logos.email.light;
    const url = raw ? absoluteUrl(raw, b.siteUrl) : '';
    if (url && /^https?:\/\//i.test(url)) {
      return `<img src="${url}" alt="${b.siteName}" style="max-height:44px;max-width:220px;display:inline-block" />`;
    }
    return `<span style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-weight:800;font-size:20px;padding:10px 18px;border-radius:10px;letter-spacing:.5px">${b.siteName}</span>`;
  } catch {
    return `<span style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-weight:800;font-size:20px;padding:10px 18px;border-radius:10px;letter-spacing:.5px"><span style="color:#c6f24e">${BRAND.markPrefix}</span> <span style="opacity:.5">·</span> ${BRAND.markRest}</span>`;
  }
}

/**
 * ★ হেডারের জায়গায় একটি প্লেসহোল্ডার বসে; `send()` পাঠানোর ঠিক আগে
 *   সেটিকে প্রকৃত ব্র্যান্ড-হেডার দিয়ে বদলে দেয়।
 *
 *   কেন এভাবে: `wrap()` সিঙ্ক্রোনাস আর ৮টি জায়গা থেকে ডাকা হয়।
 *   প্রতিটিকে async বানিয়ে হেডার পাস করানো মানে ৮টি কল-সাইট বদল —
 *   একটিও ভুলে গেলে সেই ইমেইলে পুরনো ব্র্যান্ড থেকে যেত। একটিমাত্র
 *   চোকপয়েন্টে বদলালে সেই ঝুঁকি থাকে না।
 */
const HEADER_SLOT = '<!--BRAND_HEADER-->';

function wrap(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0f1a;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:24px">
    ${HEADER_SLOT}
  </div>
  <div style="background:#131a2a;border:1px solid #2a3448;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 16px;color:#fff;font-size:19px;font-weight:700">${title}</h1>
    <div style="color:#94a3b8;font-size:14px;line-height:1.7">${body}</div>
    ${cta ? `<div style="margin-top:24px"><a href="${cta.url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">${cta.label}</a></div>` : ''}
  </div>
  <p style="text-align:center;color:#475569;font-size:11px;margin-top:20px">স্বয়ংক্রিয় বার্তা — উত্তর দেওয়ার প্রয়োজন নেই।</p>
</div></body></html>`;
}

// ★ no-op সতর্কতা throttle — RESEND কনফিগার না থাকলে প্রতিটি ইমেইলে
//   লগ করলে বন্যা হতো। প্রতি ১০ মিনিটে একবার warn যথেষ্ট: deploy যে
//   নীরবে ইমেইল-বিহীন চলছে সেটা মনিটরিং-এ দৃশ্যমান করাই উদ্দেশ্য।
let lastNoopWarnAt = 0;
const NOOP_WARN_THROTTLE_MS = 10 * 60 * 1000;

async function send(to: string, subject: string, html: string) {
  if (!resend) {
    const now = Date.now();
    if (now - lastNoopWarnAt >= NOOP_WARN_THROTTLE_MS) {
      lastNoopWarnAt = now;
      // ★ error নয়, warn — এটা misconfiguration, crash নয়। কিন্তু আর
      //   নীরব নয়: password reset/verification নীরবে ভাঙা থাকলে ধরা পড়বে।
      logger.warn('email', 'RESEND_API_KEY সেট নেই — ইমেইল নীরবে skip হচ্ছে', {
        subject: subject.slice(0, 60),
      });
    }
    return;
  }
  try {
    // ★ ব্র্যান্ড-হেডার এখানেই বসে — প্রতিটি ইমেইল স্বয়ংক্রিয়ভাবে
    //   অ্যাডমিনের বর্তমান লোগো/নাম পায়, কল-সাইট কিছু না জেনেই।
    const finalHtml = html.includes(HEADER_SLOT)
      ? html.replace(HEADER_SLOT, await brandHeader())
      : html;
    await resend.emails.send({ from: FROM, to, subject, html: finalHtml });
  } catch (e) {
    logger.error('email', 'send failed', { err: e });
  }
}

/** ★ Integration Hub-এর email প্রোভাইডার এটি ব্যবহার করে (জেনেরিক sender)।
 *   RESEND কনফিগার না থাকলে চুপচাপ skip — main flow ভাঙে না। */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  await send(to, subject, html);
}

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — OTP কোড। **এটি সত্যি বলে।**
 *
 *   ⚠️ উপরের `send()` ব্যর্থতা গিলে ফেলে, আর সেটি বাকি সব ইমেইলের
 *   জন্য সঠিক: স্বাগত-বার্তা বা অর্ডার-নোটিশ ব্যর্থ হলে মূল কাজটি
 *   ভাঙা উচিত নয়।
 *
 *   OTP-তে ঠিক উল্টো। কোড না পৌঁছালে গ্রাহক **কখনোই** রেজিস্ট্রেশন
 *   শেষ করতে পারবেন না, অথচ পর্দায় লেখা থাকবে "কোড পাঠানো হয়েছে" —
 *   একটি সম্পূর্ণ নীরব অচলাবস্থা। তাই এখানে আলাদা পথ, যা
 *   সফল/ব্যর্থ ফেরত দেয়।
 *
 *   ⚠️ কোডটি কেবল ইমেইলের **বডিতে** যায় — লগে বা কোথাও নয়।
 * ═══════════════════════════════════════════════════════════
 */
export async function emailOtpCode(
  to: string,
  code: string,
  ttlMinutes: number,
): Promise<boolean> {
  if (!resend) {
    logger.error('email', 'OTP পাঠানো যায়নি — RESEND_API_KEY সেট নেই');
    return false;
  }
  const html = wrap(
    'আপনার যাচাই কোড',
    `<p style="margin:0 0 18px">নিচের কোডটি দিয়ে রেজিস্ট্রেশন সম্পূর্ণ করুন।</p>
     <div style="text-align:center;margin:24px 0">
       <span style="display:inline-block;background:#0b0f1a;border:1px solid #2a3448;border-radius:10px;
                    padding:14px 26px;color:#fff;font-size:30px;font-weight:800;letter-spacing:9px;
                    font-family:'Courier New',monospace">${code}</span>
     </div>
     <p style="margin:0">কোডটি <b>${ttlMinutes} মিনিট</b> বৈধ।</p>
     <p style="margin:12px 0 0;color:#64748b;font-size:12px">
       আপনি যদি অ্যাকাউন্ট খোলার চেষ্টা না করে থাকেন, এই বার্তাটি উপেক্ষা করুন —
       কোডটি ছাড়া কিছুই হবে না।
     </p>`,
  );

  try {
    const finalHtml = html.includes(HEADER_SLOT)
      ? html.replace(HEADER_SLOT, await brandHeader())
      : html;
    const r = await resend.emails.send({
      from: FROM,
      to,
      subject: `যাচাই কোড ${code} — ${BRAND.name}`,
      html: finalHtml,
    });
    // ⚠️ Resend ত্রুটি throw করে না — উত্তরের `error` ক্ষেত্রে দেয়।
    //    শুধু try/catch করলে ব্যর্থতা "সফল" বলে চলে যেত।
    if (r?.error) {
      logger.error('email', 'OTP send rejected', { err: r.error });
      return false;
    }
    return true;
  } catch (e) {
    logger.error('email', 'OTP send failed', { err: e });
    return false;
  }
}

export async function emailWelcome(to: string, name: string, refCode: string) {
  await send(to, `স্বাগতম — ${BRAND.name}`, wrap(
    `স্বাগতম, ${name}!`,
    `<p>আপনার অ্যাকাউন্ট তৈরি হয়েছে।</p>
     <p style="margin-top:14px">আপনার রেফারেল কোড:</p>
     <div style="background:#0b0f1a;border:1px dashed #4f46e5;border-radius:8px;padding:14px;text-align:center;margin-top:8px">
       <code style="color:#818cf8;font-size:18px;font-weight:700;letter-spacing:2px">${refCode}</code>
     </div>
     <p style="margin-top:14px;font-size:13px">বন্ধুকে এই কোড দিন — সে প্রথম ডিপোজিট করলে আপনি বোনাস পাবেন।</p>`,
    { label: 'টপ আপ করুন', url: base() }
  ));
}

export async function emailDepositApproved(to: string, name: string, amount: string, balance: string) {
  await send(to, `ডিপোজিট অনুমোদিত — ৳${amount}`, wrap(
    'ডিপোজিট অনুমোদিত ✅',
    `<p>${name}, আপনার <strong style="color:#34d399">৳${amount}</strong> ডিপোজিট অনুমোদন করা হয়েছে।</p>
     <p style="margin-top:10px">বর্তমান ব্যালেন্স: <strong style="color:#fff">৳${balance}</strong></p>`,
    { label: 'অর্ডার করুন', url: base() }
  ));
}

export async function emailDepositRejected(to: string, name: string, amount: string, reason: string) {
  await send(to, 'ডিপোজিট বাতিল', wrap(
    'ডিপোজিট বাতিল ❌',
    `<p>${name}, আপনার <strong>৳${amount}</strong> ডিপোজিট রিকোয়েস্ট বাতিল করা হয়েছে।</p>
     <p style="margin-top:10px">কারণ: <em style="color:#f87171">${reason}</em></p>`,
    { label: 'আবার চেষ্টা করুন', url: `${base()}/account/wallet/deposit` }
  ));
}

export async function emailOrderPlaced(
  to: string, name: string, orderNo: number, product: string, variant: string, price: string
) {
  await send(to, `অর্ডার #${orderNo} গ্রহণ করা হয়েছে`, wrap(
    `অর্ডার #${orderNo} ✅`,
    `<p>${name}, আপনার অর্ডার গ্রহণ করা হয়েছে।</p>
     <table style="width:100%;margin-top:14px;font-size:13px">
       <tr><td style="padding:6px 0;color:#64748b">প্রোডাক্ট</td><td style="text-align:right;color:#fff">${product}</td></tr>
       <tr><td style="padding:6px 0;color:#64748b">প্যাকেজ</td><td style="text-align:right;color:#fff">${variant}</td></tr>
       <tr><td style="padding:6px 0;color:#64748b">মূল্য</td><td style="text-align:right;color:#34d399;font-weight:700">৳${price}</td></tr>
     </table>`,
    { label: 'অর্ডার দেখুন', url: `${base()}/account/orders` }
  ));
}

export async function emailOrderCompleted(
  to: string, name: string, orderNo: number, product: string, variant: string
) {
  await send(to, `অর্ডার #${orderNo} সম্পন্ন 🎉`, wrap(
    `অর্ডার #${orderNo} সম্পন্ন 🎉`,
    `<p>${name}, আপনার অর্ডার সফলভাবে ডেলিভারি করা হয়েছে।</p>
     <p style="margin-top:10px"><strong style="color:#fff">${product}</strong> — ${variant}</p>
     <p style="margin-top:14px;font-size:13px">গেমে চেক করে দেখুন।</p>`,
    { label: 'আবার অর্ডার করুন', url: base() }
  ));
}

export async function emailOrderRefunded(
  to: string, name: string, orderNo: number, amount: string, reason: string
) {
  await send(to, `অর্ডার #${orderNo} বাতিল — ৳${amount} ফেরত`, wrap(
    `অর্ডার #${orderNo} বাতিল`,
    `<p>${name}, আপনার অর্ডার সম্পন্ন করা যায়নি।</p>
     <p style="margin-top:10px">কারণ: <em style="color:#f87171">${reason}</em></p>
     <p style="margin-top:10px"><strong style="color:#34d399">৳${amount}</strong> আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে।</p>`,
    { label: 'ব্যালেন্স দেখুন', url: `${base()}/account` }
  ));
}

export async function emailPasswordReset(to: string, name: string, url: string) {
  await send(to, `পাসওয়ার্ড রিসেট — ${BRAND.name}`, wrap(
    'পাসওয়ার্ড রিসেট 🔑',
    `<p>${name}, আপনি পাসওয়ার্ড রিসেট করতে চেয়েছেন।</p>
     <p style="margin-top:10px">নিচের বাটনে ক্লিক করে নতুন পাসওয়ার্ড দিন। লিংকটি <strong style="color:#fff">৩০ মিনিট</strong> পর্যন্ত কাজ করবে।</p>
     <p style="margin-top:14px;font-size:13px;color:#64748b">আপনি যদি এই অনুরোধ না করে থাকেন, এই ইমেইল উপেক্ষা করুন — আপনার পাসওয়ার্ড অপরিবর্তিত থাকবে।</p>`,
    { label: 'নতুন পাসওয়ার্ড দিন', url }
  ));
}

export async function emailReferralBonus(
  to: string, name: string, friendName: string, bonus: string, balance: string
) {
  await send(to, `রেফারেল বোনাস — ৳${bonus} 🎁`, wrap(
    'রেফারেল বোনাস পেয়েছেন! 🎁',
    `<p>${name}, <strong style="color:#fff">${friendName}</strong> আপনার রেফারেল কোড ব্যবহার করে প্রথম ডিপোজিট করেছে।</p>
     <p style="margin-top:10px">আপনি পেয়েছেন <strong style="color:#34d399">৳${bonus}</strong> বোনাস।</p>
     <p style="margin-top:10px">বর্তমান ব্যালেন্স: <strong style="color:#fff">৳${balance}</strong></p>`,
    { label: 'ব্যালেন্স দেখুন', url: `${base()}/account` }
  ));
}
