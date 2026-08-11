'use client';

/**
 * ★ ইনভয়েস প্রিন্ট/PDF বোতাম (Group I ২)
 *
 *   ⚠️ কেন আলাদা ক্লায়েন্ট কম্পোনেন্ট: ইনভয়েস পাতাটি সার্ভার
 *   কম্পোনেন্ট (টাকার মান DB থেকে সরাসরি আসে), আর সেখানে `onClick`
 *   বসানো যায় না। শুধু এই বোতামটুকুই ক্লায়েন্টে যায়।
 *
 *   ⚠️ `print:hidden` — কাগজে বোতাম ছাপা অর্থহীন।
 */
export default function InvoicePrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-ghost px-4 text-sm print:hidden">
      🖨 PDF হিসেবে সংরক্ষণ / প্রিন্ট
    </button>
  );
}
