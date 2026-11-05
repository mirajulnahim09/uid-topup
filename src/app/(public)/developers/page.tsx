import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { MAX_BULK_ITEMS } from '@/lib/validation';

export const revalidate = 3600;
export const metadata = { title: 'Reseller API — ডেভেলপার ডকস' };

/**
 * Developer docs for the reseller API. Every endpoint documented here
 * exists in src/app/api/reseller/* — keep both in step.
 */

type Endpoint = {
  method: 'GET' | 'POST';
  path: string;
  title: string;
  desc: string;
  request: string;
  response: string;
};

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="dev-code">
      {label && <div className="dev-code-label">{label}</div>}
      <pre><code>{children}</code></pre>
    </div>
  );
}

export default async function DevelopersPage() {
  let s: Record<string, string> = {};
  try {
    s = await getSettings();
  } catch {
    /* defaults */
  }
  const base = (s.site_url || process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.com').replace(/\/$/, '');

  const endpoints: Endpoint[] = [
    {
      method: 'GET',
      path: '/api/reseller/products',
      title: 'প্রোডাক্ট ও প্যাকেজ তালিকা',
      desc: 'সব চালু প্যাকেজ, তাদের variantId আর আপনার জন্য প্রযোজ্য দাম (রিসেলার হলে রিসেলার রেট)।',
      request: `curl ${base}/api/reseller/products \\\n  -H "Authorization: Bearer YOUR_API_KEY"`,
      response: `{
  "success": true,
  "tier": "RESELLER",
  "currency": "BDT",
  "categories": [{
    "category": { "id": 1, "name": "FREE FIRE", "slug": "free-fire" },
    "products": [{
      "productId": 1,
      "name": "Free Fire [BD SERVER]",
      "inputLabel": "Player UID",
      "deliveryType": "TOPUP",
      "packages": [
        { "variantId": 1, "label": "25 Diamond", "price": "19.00",
          "listPrice": "20.00", "resellerRate": true, "inStock": true }
      ]
    }]
  }]
}`,
    },
    {
      method: 'POST',
      path: '/api/reseller/orders',
      title: 'অর্ডার দিন (একসাথে সর্বোচ্চ ' + MAX_BULK_ITEMS + 'টি)',
      desc: 'ওয়ালেট থেকে টাকা কাটে। প্রতিটি আইটেমে নিজস্ব clientRef দিন — একই clientRef আবার পাঠালে নতুন অর্ডার হয় না, আগেরটিই ফেরত আসে (ডাবল-চার্জ অসম্ভব)।',
      request: `curl -X POST ${base}/api/reseller/orders \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{
    "items": [
      { "variantId": 1, "playerUid": "123456789", "clientRef": "my-order-0001" }
    ]
  }'`,
      response: `{
  "success": true,
  "summary": { "total": 1, "created": 1, "duplicate": 0, "failed": 0, "maxItems": ${MAX_BULK_ITEMS} },
  "balance": "981.00",
  "idempotent": true,
  "results": [
    { "index": 0, "clientRef": "my-order-0001", "status": "CREATED",
      "orderId": "clx…", "orderNo": 1042, "price": 19, "reseller": true }
  ]
}`,
    },
    {
      method: 'GET',
      path: '/api/reseller/order-status',
      title: 'অর্ডারের অবস্থা',
      desc: 'clientRef, orderNo বা orderIds (কমা দিয়ে, সর্বোচ্চ ২০) দিয়ে নিজের অর্ডারের অবস্থা দেখুন। কোড-প্রোডাক্টে সম্পন্ন হলে code ফিল্ডে কোড আসে।',
      request: `curl "${base}/api/reseller/order-status?clientRef=my-order-0001" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`,
      response: `{
  "success": true,
  "orders": [{
    "orderId": "clx…", "orderNo": 1042, "clientRef": "my-order-0001",
    "status": "COMPLETED", "product": "Free Fire [BD SERVER]", "package": "25 Diamond",
    "price": "19.00", "refunded": "0.00", "code": null,
    "createdAt": "2026-10-31T10:00:00.000Z", "completedAt": "2026-10-31T10:12:00.000Z"
  }]
}`,
    },
    {
      method: 'GET',
      path: '/api/reseller/balance',
      title: 'ওয়ালেট ব্যালেন্স',
      desc: 'আপনার বর্তমান ব্যালেন্স — অর্ডারের আগে যাচাই করতে।',
      request: `curl ${base}/api/reseller/balance \\\n  -H "Authorization: Bearer YOUR_API_KEY"`,
      response: `{ "success": true, "balance": "981.00", "currency": "BDT", "tier": "RESELLER" }`,
    },
  ];

  const statuses: [string, string][] = [
    ['AWAITING_PAYMENT', 'ডাইরেক্ট-পে যাচাইয়ের অপেক্ষায়'],
    ['PENDING', 'অর্ডার গৃহীত, ডেলিভারির অপেক্ষায়'],
    ['PROCESSING', 'ডেলিভারি চলছে'],
    ['COMPLETED', 'ডেলিভারি সম্পন্ন'],
    ['FAILED', 'বাতিল — টাকা ওয়ালেটে ফেরত'],
    ['REFUNDED', 'ফেরত দেওয়া হয়েছে'],
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="tut-hero relative overflow-hidden px-6 py-9 text-white sm:px-10 sm:py-12">
        <span className="inline-flex rounded-full px-3 py-1 font-mono text-[12px] font-bold" style={{ background: 'rgba(255,255,255,.14)' }}>
          REST · JSON · v1
        </span>
        <h1 className="mt-3 text-[28px] font-extrabold leading-tight sm:text-[40px]" style={{ letterSpacing: '-.02em' }}>
          Reseller API
        </h1>
        <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed sm:text-[16px]" style={{ color: 'rgba(255,255,255,.85)' }}>
          নিজের সাইট, বট বা অ্যাপ থেকে সরাসরি অর্ডার দিন — প্রোডাক্ট তালিকা, অর্ডার, অবস্থা ও ব্যালেন্স, সব এক API-তে।
          রিসেলার অ্যাকাউন্টে রিসেলার রেট স্বয়ংক্রিয়ভাবে প্রযোজ্য।
        </p>
        <div className="mt-5 flex flex-wrap gap-2 font-mono text-[12.5px]">
          <span className="rounded-lg px-2.5 py-1" style={{ background: 'rgba(255,255,255,.12)' }}>Base URL: {base}</span>
        </div>
      </section>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { h: '১. API কী নিন', p: 'অ্যাডমিন আপনার অ্যাকাউন্টে API কী ইস্যু করবেন। কী একবারই দেখানো হয় — নিরাপদে রাখুন।' },
          { h: '২. হেডারে পাঠান', p: 'প্রতিটি অনুরোধে Authorization: Bearer <কী> অথবা X-API-Key: <কী>।' },
          { h: '৩. clientRef দিন', p: 'প্রতিটি অর্ডারে ইউনিক clientRef — টাইমআউটে আবার পাঠালেও ডাবল-চার্জ হবে না।' },
        ].map((x) => (
          <div key={x.h} className="sf-card p-5">
            <p className="text-[15px] font-extrabold" style={{ color: 'var(--v-ink)' }}>{x.h}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>{x.p}</p>
          </div>
        ))}
      </div>

      <h2 className="sf-sec-title mt-12"><span className="sf-sec-bar" aria-hidden="true" />Endpoints</h2>
      <div className="mt-5 space-y-6">
        {endpoints.map((e) => (
          <article key={e.path} id={e.path.split('/').pop()} className="sf-card scroll-mt-24 overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--v-edge)' }}>
              <span className={`dev-method dev-method--${e.method.toLowerCase()}`}>{e.method}</span>
              <code className="font-mono text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{e.path}</code>
              <span className="text-[13px]" style={{ color: 'var(--v-mut)' }}>— {e.title}</span>
            </header>
            <div className="space-y-4 p-5">
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--v-ink)' }}>{e.desc}</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <Code label="Request">{e.request}</Code>
                <Code label="Response">{e.response}</Code>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="sf-sec-title"><span className="sf-sec-bar" aria-hidden="true" />অর্ডার স্ট্যাটাস</h2>
          <ul className="sf-card mt-4 divide-y" style={{ borderColor: 'var(--v-edge)' }}>
            {statuses.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderColor: 'var(--hairline)' }}>
                <code className="font-mono text-[13px] font-bold" style={{ color: 'var(--v-ice)' }}>{k}</code>
                <span className="text-right text-[13px]" style={{ color: 'var(--v-mut)' }}>{v}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="sf-sec-title"><span className="sf-sec-bar" aria-hidden="true" />সীমা ও ত্রুটি</h2>
          <ul className="sf-card mt-4 space-y-2.5 p-5 text-[13.5px] leading-relaxed" style={{ color: 'var(--v-ink)' }}>
            <li>• অর্ডার: প্রতি কী মিনিটে ৩০টি অনুরোধ, প্রতি অনুরোধে সর্বোচ্চ {MAX_BULK_ITEMS}টি আইটেম।</li>
            <li>• পড়া (প্রোডাক্ট/স্ট্যাটাস/ব্যালেন্স): প্রতি কী মিনিটে ১২০টি।</li>
            <li>• ভুল কী বারবার দিলে IP সাময়িক আটকে যায় (৫ মিনিটে ২০ বার)।</li>
            <li>• <code className="font-mono">401</code> কী নেই/ভুল · <code className="font-mono">400</code> ভুল ইনপুট · <code className="font-mono">429</code> সীমা পার — <code className="font-mono">error</code> ফিল্ডে কারণ থাকে।</li>
            <li>• দাম সবসময় সার্ভারে লক করা রেকর্ড থেকে নেওয়া হয় — তালিকার দাম কেবল তথ্য।</li>
          </ul>
        </section>
      </div>

      <p className="mt-10 text-center text-[13.5px]" style={{ color: 'var(--v-mut)' }}>
        API কী বা রিসেলার রেটের জন্য{' '}
        <Link href="/contact" className="font-bold underline" style={{ color: 'var(--v-ice)' }}>যোগাযোগ করুন</Link>।
      </p>
    </div>
  );
}
