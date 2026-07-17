export default function MaintenanceScreen({
  siteName,
  message,
}: {
  siteName: string;
  message?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="card max-w-md p-8">
        <p className="text-6xl" aria-hidden="true">🛠️</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {siteName} — রক্ষণাবেক্ষণ চলছে
        </h1>
        <p className="mt-3 text-slate-500">
          {message?.trim() ||
            'সাইটটি সাময়িকভাবে বন্ধ আছে। আমরা শীঘ্রই ফিরে আসছি — একটু পরে আবার চেষ্টা করুন।'}
        </p>
        <p className="mt-6 text-xs text-slate-400">
          জরুরি প্রয়োজনে ফেসবুক মেসেঞ্জারে যোগাযোগ করুন।
        </p>
      </div>
    </div>
  );
}
