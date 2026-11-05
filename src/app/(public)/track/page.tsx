import TrackForm from '@/components/TrackForm';

export const metadata = {
  title: 'অর্ডার ট্র্যাক করুন',
  description: 'অর্ডার নাম্বার ও ফোন নাম্বার দিয়ে অর্ডারের সর্বশেষ অবস্থা দেখুন।',
};

export default async function TrackPage(props: {
  searchParams: Promise<{ t?: string }>;
}) {
  const searchParams = await props.searchParams;
  return (
    <div className="mx-auto max-w-2xl page-x page-y">
      <div className="mb-8">
        <div
          className="text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '.32em', color: 'var(--gold)' }}
        >
          Order Status
        </div>
        <h1 className="dsp lux-text mt-3 text-2xl font-medium sm:text-3xl">
          অর্ডার ট্র্যাক করুন
        </h1>
        <div
          className="mt-3 h-px w-24"
          style={{ background: 'linear-gradient(90deg,rgba(var(--gold-glow),.7),transparent)' }}
        />
        <p className="prose-measure mt-4 text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>
          লগইন ছাড়াই অর্ডারের অবস্থা দেখুন। নিরাপত্তার জন্য অর্ডার নাম্বারের সাথে
          আপনার ফোন নাম্বার বা ইমেইলও লাগবে — যাতে অন্য কেউ আপনার অর্ডার দেখতে না পারে।
        </p>
      </div>

      <TrackForm initialToken={searchParams.t ?? ''} />
    </div>
  );
}
