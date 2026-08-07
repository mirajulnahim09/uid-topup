/* ═══════════════════════════════════════════════════════════
 * ★ Service Worker — শুধুমাত্র PWA ইনস্টলযোগ্যতার জন্য
 *
 *   এটি একটি টাকা-হ্যান্ডলিং অ্যাপ, তাই স্টেল-ক্যাশ বিপজ্জনক
 *   (পুরনো ব্যালেন্স/অর্ডার দেখানো ভয়ঙ্কর)। তাই এখানে কোনো
 *   ডাইনামিক/API/HTML ক্যাশ করা হয় না — শুধু:
 *     • একটি fetch হ্যান্ডলার আছে (Chrome এর ইনস্টল-শর্ত পূরণ)
 *     • শুধু পেজ-নেভিগেশন network-first; অফলাইনে একটি হালকা
 *       ফলব্যাক পেজ (কোনো প্রকৃত কনটেন্ট ক্যাশ নয়)
 *   এতে অ্যাপটি "Add to Home Screen" যোগ্য হয়, অথচ কোনো
 *   বাসি তথ্য দেখানোর ঝুঁকি থাকে না।
 * ═══════════════════════════════════════════════════════════ */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // শুধু GET পেজ-নেভিগেশন সামলাই — বাকি সব ব্রাউজার নিজে করুক
  if (req.method !== 'GET' || req.mode !== 'navigate') return;

  event.respondWith(
    fetch(req).catch(
      () =>
        new Response(
          '<!doctype html><html lang="bn"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>অফলাইন — UID TopUp</title></head>' +
            '<body style="margin:0;min-height:100vh;display:grid;place-items:center;' +
            'background:#0a0b11;color:#eef1f6;font-family:system-ui,sans-serif;padding:24px">' +
            '<div style="text-align:center;max-width:340px">' +
            '<div style="width:56px;height:56px;margin:0 auto 16px;border-radius:16px;' +
            'display:grid;place-items:center;background:rgba(139,92,246,.18);color:#c4b5fd;' +
            'font-size:26px">⚡</div>' +
            '<h1 style="font-size:20px;margin:0 0 8px">ইন্টারনেট সংযোগ নেই</h1>' +
            '<p style="color:#9aa6b8;line-height:1.6;margin:0">সংযোগ ফিরে এলে পেজটি আবার লোড করুন।</p>' +
            '</div></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
