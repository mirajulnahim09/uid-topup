import { Resend } from 'resend';

/**
 * ★ Email fail করলে কখনো main flow ভাঙবে না।
 *   RESEND_API_KEY না থাকলে চুপচাপ skip করে।
 */
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'UID TopUp <onboarding@resend.dev>';

const resend = KEY ? new Resend(KEY) : null;

export function isEmailConfigured(): boolean {
  return Boolean(resend);
}

const base = () => process.env.NEXTAUTH_URL || 'http://localhost:3000';

function wrap(title: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0f1a;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:24px">
    <span style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-weight:800;font-size:20px;padding:10px 18px;border-radius:10px">UID TopUp</span>
  </div>
  <div style="background:#131a2a;border:1px solid #2a3448;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 16px;color:#fff;font-size:19px;font-weight:700">${title}</h1>
    <div style="color:#94a3b8;font-size:14px;line-height:1.7">${body}</div>
    ${cta ? `<div style="margin-top:24px"><a href="${cta.url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">${cta.label}</a></div>` : ''}
  </div>
  <p style="text-align:center;color:#475569;font-size:11px;margin-top:20px">স্বয়ংক্রিয় বার্তা — উত্তর দেওয়ার প্রয়োজন নেই।</p>
</div></body></html>`;
}

async function send(to: string, subject: string, html: string) {
  if (!resend) return;
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (e) {
    console.error('[email] send failed:', e);
  }
}

export async function emailWelcome(to: string, name: string, refCode: string) {
  await send(to, 'স্বাগতম — UID TopUp', wrap(
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
  await send(to, 'পাসওয়ার্ড রিসেট — UID TopUp', wrap(
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
