/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রোডাকশন বিল্ডের সামনে একটি **আসল https** স্তর
 *
 *   ── কেন এটি ছাড়া প্রোডাকশন যাচাই অসম্ভব ──
 *
 *   প্রোডাকশনে সেশন কুকির নাম `__Secure-next-auth.session-token` এবং
 *   তাতে `Secure` অ্যাট্রিবিউট থাকে। ব্রাউজার `Secure` কুকি **শুধু
 *   https স্কিমে** সংরক্ষণ করে — `http://localhost:3100` এ নয়। তাই
 *   `next start` কে সরাসরি http তে চালিয়ে লগইন পরীক্ষা করলে প্রতিটি
 *   সুরক্ষিত পাতা `/login` এ ফেরত যায় এবং মনে হয় অ্যাপটি ভাঙা।
 *   এই বিভ্রান্তিটি আগে একবার একটি **আসল** বাগকেও আড়াল করেছিল
 *   (MANUAL_PRO.md §29.9)।
 *
 *   সমাধান: `next start` চলে 127.0.0.1:3100 এ (শুধু লুপব্যাক), আর
 *   এই ছোট প্রক্সিটি 3443 এ **প্রকৃত TLS** দেয়। ব্রাউজারের দিক থেকে
 *   এটি https, তাই `__Secure-` কুকি স্বাভাবিকভাবেই কাজ করে এবং
 *   প্রোডাকশন আচরণ হুবহু মাপা যায়।
 *
 *   ⚠️ সার্টিফিকেট স্ব-স্বাক্ষরিত ও `.certs/` এ (gitignored)। Playwright
 *   কে `ignoreHTTPSErrors: true` দিতে হয়। এটি কেবল **লোকাল যাচাইয়ের**
 *   সরঞ্জাম — কোনো ডিপ্লয়মেন্টে ব্যবহার্য নয়।
 *
 *   চালানো:
 *     node scripts/prod-https.mjs            # 3443 → 3100
 *     PROD_HTTPS_PORT=4443 PROD_HTTP_PORT=3200 node scripts/prod-https.mjs
 * ═══════════════════════════════════════════════════════════
 */
import https from 'node:https';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const HTTPS_PORT = Number(process.env.PROD_HTTPS_PORT || 3443);
const HTTP_PORT = Number(process.env.PROD_HTTP_PORT || 3100);

const key = path.join(process.cwd(), '.certs', 'localhost-key.pem');
const cert = path.join(process.cwd(), '.certs', 'localhost-cert.pem');
if (!existsSync(key) || !existsSync(cert)) {
  console.error('✗ .certs/ এ সার্টিফিকেট নেই — ফাইলের মাথার কমান্ডটি চালান');
  process.exit(1);
}

/**
 * ★ upstream এ keep-alive পুল।
 *
 * ⚠️ কেন: Next এর ক্লায়েন্ট-রাউটার একসাথে অনেকগুলো RSC prefetch পাঠায়।
 *   প্রতিটির জন্য নতুন TCP সংযোগ খুললে Windows-এ কিছু সংযোগ ব্যর্থ হয়,
 *   আর ব্রাউজারে দেখা যায়
 *   "Failed to fetch RSC payload … Falling back to browser navigation"।
 *   পাতা তবু খোলে (Next নিজেই fallback করে), কিন্তু কনসোল-ত্রুটি গোনা
 *   যাচাইয়ে সেটি মিথ্যা FAIL হয়ে আসত।
 */
const agent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000 });

const server = https.createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (req, res) => {
    /**
     * ★ `x-forwarded-proto: https` পাঠানো **আবশ্যক**। Next/NextAuth
     *   এটি দেখেই বুঝবে মূল অনুরোধটি https ছিল; নাহলে redirect ও
     *   callback URL গুলো http তে ফিরে যেত।
     */
    const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host };
    const upstream = http.request(
      { host: '127.0.0.1', port: HTTP_PORT, path: req.url, method: req.method, headers, agent },
      (up) => {
        /**
         * ★★★ `Location` **পুনর্লিখন আবশ্যক**।
         *
         *   `next start` নিজের শোনা পোর্ট দিয়ে পরম URL বানায়, তাই
         *   middleware এর রিডাইরেক্ট আসে `https://localhost:3100/…`
         *   হিসেবে — https স্কিম, অথচ ৩১০০ একটি **সাদামাটা http**
         *   পোর্ট। ব্রাউজার সেটি অনুসরণ করতে গিয়ে TLS হ্যান্ডশেক
         *   করে ও `ERR_SSL_PROTOCOL_ERROR` দেয়। ২০২৬-০৮-১৪ তে
         *   `/admin` এ ঠিক এটিই ঘটেছিল, আর দেখতে লাগছিল যেন
         *   সার্টিফিকেট বা অ্যাপ ভাঙা।
         *
         *   ⚠️ এটি **প্রক্সির দায়** (nginx এর `proxy_redirect` যা করে),
         *   অ্যাপের বাগ নয়: Vercel এ প্ল্যাটফর্মই সঠিক host দেয়।
         */
        const h = { ...up.headers };
        const loc = h.location;
        if (typeof loc === 'string') {
          h.location = loc.replace(
            new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${HTTP_PORT}`),
            `https://localhost:${HTTPS_PORT}`,
          );
        }
        res.writeHead(up.statusCode || 502, h);
        up.pipe(res);
      },
    );
    /**
     * ★★★ বাতিল হওয়া অনুরোধ **নীরবে** ছেড়ে দিতে হয়।
     *
     *   ⚠️ Next এর ক্লায়েন্ট-রাউটার নেভিগেশনের সময় চলমান RSC prefetch
     *   গুলো abort করে। আগের সংস্করণে তখন `upstream.on('error')`
     *   ধ্বংস-হয়ে-যাওয়া `res` এ `writeHead()` করতে যেত, সেটি throw
     *   করত, আর **পুরো keep-alive সংযোগটি** পড়ে যেত — ঐ সংযোগে থাকা
     *   বাকি prefetch গুলোও মরত। ব্রাউজারে দেখা যেত
     *   "Failed to fetch RSC payload … TypeError: network error",
     *   অর্থাৎ যাচাইয়ে অ্যাপের নামে মিথ্যা অভিযোগ (৩/৩ রানে)।
     *
     *   এখন: ক্লায়েন্ট চলে গেলে upstream বন্ধ করি, আর উত্তর লেখার
     *   আগে সবসময় দেখে নিই সংযোগটি এখনো জীবিত কি না।
     */
    const safeFail = (e) => {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`upstream error: ${e.message}`);
    };
    upstream.on('error', safeFail);
    req.on('error', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });

    req.pipe(upstream);
  },
);

/**
 * ⚠️ Node এর ডিফল্ট `keepAliveTimeout` ৫ সেকেন্ড। Playwright এর দুটি
 *   নেভিগেশনের মাঝে বিরতি এর চেয়ে বড় হলে সার্ভার সংযোগটি বন্ধ করে,
 *   আর Chrome ঠিক সেই মুহূর্তে পুরনো সংযোগ পুনর্ব্যবহার করতে গিয়ে
 *   `ERR_SSL_PROTOCOL_ERROR` দেখায় — যা দেখতে সার্টিফিকেট-সমস্যার মতো,
 *   অথচ আসলে রেস। (২০২৬-০৮-১৪ তে `/admin` নেভিগেশনে ঠিক তাই হয়েছিল।)
 */
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.on('clientError', (err, socket) => {
  // ★ ভাঙা সংযোগে সার্ভার যেন না পড়ে
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(HTTPS_PORT, () => {
  console.log(`https প্রক্সি প্রস্তুত: https://localhost:${HTTPS_PORT} → http://127.0.0.1:${HTTP_PORT}`);
});
