export const revalidate = 3600;

export const metadata = { title: 'সাধারণ প্রশ্ন' };

const FAQS = [
  {
    q: 'টপ আপ করতে কত সময় লাগে?',
    a: 'সাধারণত ৫–৩০ মিনিট। ব্যস্ত সময়ে একটু বেশি লাগতে পারে। অর্ডার সম্পন্ন হলে নোটিফিকেশন ও ইমেইল পাবেন।',
  },
  {
    q: 'কীভাবে টাকা যোগ করব?',
    a: '"টাকা যোগ" পেজে যান → পেমেন্ট মাধ্যম বেছে নিন → দেখানো নাম্বারে Send Money করুন → TrxID ও পাঠানো নাম্বার দিয়ে রিকোয়েস্ট জমা দিন। অ্যাডমিন যাচাই করার পর ব্যালেন্স যোগ হবে।',
  },
  {
    q: 'ভুল UID দিলে কী হবে?',
    a: 'ভুল UID দিলে ভুল অ্যাকাউন্টে টপ আপ হয়ে যাবে — সেটা আর ফেরানো যায় না। অর্ডার করার আগে UID ভালো করে মিলিয়ে নিন।',
  },
  {
    q: 'অর্ডার বাতিল হলে টাকা ফেরত পাব?',
    a: 'হ্যাঁ। আমাদের পক্ষ থেকে টপ আপ করা না গেলে পুরো টাকা আপনার ওয়ালেটে ফেরত যাবে। কিন্তু ভুল UID এর কারণে হলে ফেরত দেওয়া সম্ভব নয়।',
  },
  {
    q: 'রেফারেল বোনাস কীভাবে কাজ করে?',
    a: 'প্রোফাইল পেজে আপনার রেফারেল কোড আছে। বন্ধুকে সেই কোড দিন। সে রেজিস্টার করে প্রথমবার নির্দিষ্ট পরিমাণ ডিপোজিট করলে আপনি বোনাস পাবেন।',
  },
  {
    q: 'কুপন কোড কীভাবে ব্যবহার করব?',
    a: 'অর্ডার পেজে প্যাকেজ বেছে নেওয়ার পর কুপন কোড লিখে "প্রয়োগ" চাপুন। বৈধ হলে ছাড় দেখাবে।',
  },
  {
    q: 'একই TrxID দুইবার দিতে পারব?',
    a: 'না। প্রতিটি TrxID একবারই ব্যবহার করা যাবে। একই TrxID আবার দিলে রিকোয়েস্ট বাতিল হবে।',
  },
  {
    q: 'Cash Out না Send Money?',
    a: 'অবশ্যই Send Money করুন। Cash Out করলে টাকা পৌঁছাবে না এবং রিকোয়েস্ট বাতিল হবে।',
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl prose-measure px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold text-slate-900 sm:text-3xl">সাধারণ প্রশ্ন</h1>
      <p className="mb-8 text-sm text-slate-400">
        যে প্রশ্নগুলো সবচেয়ে বেশি করা হয়।
      </p>

      <div className="mb-6 flex flex-wrap gap-3">
        {/* ★ min-h-[40px] — আগে py-2 তে উচ্চতা দাঁড়াত ৩৬px (§17 চায় ≥40) */}
        <a href="/contact" className="inline-flex min-h-[40px] items-center rounded-lg bg-rose-50 px-4 text-sm font-bold text-rose-600 transition hover:bg-rose-100">
          💬 যোগাযোগ করুন
        </a>
        <a href="/terms" className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-200">
          শর্তাবলী
        </a>
        <a href="/refund" className="inline-flex min-h-[40px] items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-200">
          রিফান্ড নীতি
        </a>
      </div>

      <div className="space-y-3">
        {FAQS.map((f, i) => (
          <details key={i} className="card group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
              <span>{f.q}</span>
              <svg
                className="shrink-0 text-slate-400 transition group-open:rotate-180"
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
