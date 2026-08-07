/**
 * ═══════════════════════════════════════════════════════════
 * ★ ক্লায়েন্ট-সাইড ইমেজ প্রসেসিং — আপলোডের আগে।
 *
 *   কেন ক্লায়েন্টে: ৮MB ফোন-ছবি সরাসরি পাঠানো মানে ধীর আপলোড,
 *   বেশি Blob খরচ ও পেজে ভারী ছবি। এখানে ব্রাউজারেই —
 *     • নির্দিষ্ট aspect-এ **কভার-ক্রপ** (offset দিয়ে reposition যায়)
 *     • দীর্ঘ প্রান্ত `maxSize`-এ **রিসাইজ**
 *     • **WebP**-এ রূপান্তর + **কম্প্রেশন** (quality)
 *   ফলে সার্ভারে ছোট, অপ্টিমাইজড WebP যায়। WebP সমর্থন না থাকলে
 *   (পুরনো Safari) স্বয়ংক্রিয়ভাবে JPEG-এ পড়ে।
 *
 *   ⚠️ শুধু ব্রাউজারে চলে (canvas/Image দরকার)।
 * ═══════════════════════════════════════════════════════════
 */

export type CropOffset = { x: number; y: number }; // 0..1, 0.5 = কেন্দ্র

export type ProcessOpts = {
  /** টার্গেট aspect (w/h)। null হলে মূল aspect রাখা হয় (শুধু resize+compress)। */
  aspect?: number | null;
  /** দীর্ঘ প্রান্তের সর্বোচ্চ পিক্সেল */
  maxSize?: number;
  /** 0..1 — WebP/JPEG কোয়ালিটি */
  quality?: number;
  /** কভার-ক্রপের অবস্থান (drag reposition) */
  offset?: CropOffset;
};

export type Processed = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
};

export function loadImageEl(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ছবি পড়া যায়নি')); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const done = (b: Blob | null, type: string) => {
      if (b) resolve(new Blob([b], { type }));
      else reject(new Error('ছবি এনকোড করা যায়নি'));
    };
    // WebP চেষ্টা; আউটপুট type webp না হলে (সমর্থন নেই) JPEG-এ fallback
    canvas.toBlob(
      (b) => {
        if (b && b.type === 'image/webp') done(b, 'image/webp');
        else canvas.toBlob((j) => done(j, 'image/jpeg'), 'image/jpeg', quality);
      },
      'image/webp',
      quality,
    );
  });
}

function renameExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${ext}`;
}

export async function processImage(file: File, opts: ProcessOpts = {}): Promise<Processed> {
  const { aspect = null, maxSize = 1280, quality = 0.85, offset = { x: 0.5, y: 0.5 } } = opts;

  const img = await loadImageEl(file);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // ── উৎস ক্রপ আয়তক্ষেত্র (কভার, offset দিয়ে অবস্থান) ──
  let sw = iw, sh = ih;
  if (aspect && aspect > 0) {
    const srcAspect = iw / ih;
    if (srcAspect > aspect) { sw = Math.round(ih * aspect); sh = ih; }
    else { sw = iw; sh = Math.round(iw / aspect); }
  }
  const sx = Math.round((iw - sw) * Math.min(1, Math.max(0, offset.x)));
  const sy = Math.round((ih - sh) * Math.min(1, Math.max(0, offset.y)));

  // ── টার্গেট মাপ (দীর্ঘ প্রান্ত ≤ maxSize) ──
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas সমর্থিত নয়');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  URL.revokeObjectURL(img.src);

  const blob = await canvasToBlob(canvas, quality);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const out = new File([blob], renameExt(file.name, ext), { type: blob.type });

  return {
    file: out,
    previewUrl: URL.createObjectURL(blob),
    width: dw,
    height: dh,
    bytes: blob.size,
  };
}
