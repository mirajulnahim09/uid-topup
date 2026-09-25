// ★ ৫ লাখ অর্ডারে ব্যাকআপ: সার্ভার বাঁচে? ফাইলের ডেটা-বাইটের SHA-256 = _meta.checksum?
//   (৫০০MB+ ফাইল JSON.parse করা যায় না — তাই verifyBackup-এর সমতুল্য বাইট-স্তরে)
import { db, BASE, mintCookie } from '../_lib';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
const mem = () => { try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'v2-simbuild' } | ForEach-Object { (Get-Process -Id $_.ProcessId).WorkingSet64 } | Measure-Object -Sum).Sum"], { encoding: 'utf8' }).trim()) / 1048576 | 0; } catch { return -1; } };
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const m0 = mem(); let peak = m0;
  const probe = setInterval(() => { peak = Math.max(peak, mem()); }, 2000);
  const t = Date.now();
  const r = await fetch(`${BASE}/api/admin/backup`, { headers: { cookie: A } });
  const h = createHash('sha256'); const out = createWriteStream('.sim/backup-500k.json');
  let tail = Buffer.alloc(0); let bytes = 0;
  const reader = r.body!.getReader();
  // শেষ ~৪KB ধরে রাখি (সেখানে _meta) — বাকিটা হ্যাশে
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    const buf = Buffer.concat([tail, Buffer.from(value)]); bytes += value.length;
    const keep = Math.min(buf.length, 4096);
    h.update(buf.subarray(0, buf.length - keep)); tail = buf.subarray(buf.length - keep);
    out.write(Buffer.from(value));
  }
  out.end(); clearInterval(probe);
  const s = tail.toString('utf8'); const i = s.lastIndexOf(',"_meta":');
  h.update(Buffer.from(s.slice(0, i), 'utf8')); h.update('}');
  const meta = JSON.parse(s.slice(i + ',"_meta":'.length, -1));
  const alive = await fetch(`${BASE}/api/health`).then((x) => x.status).catch(() => 0);
  console.log(JSON.stringify({ http: r.status, seconds: Math.round((Date.now() - t) / 1000), MB: Math.round(bytes / 1048576), checksumMatches: h.digest('hex') === meta.checksum, serverMemMB: { before: m0, peak }, healthAfter: alive }));
})().finally(() => db.$disconnect());
