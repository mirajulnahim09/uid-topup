import { prisma } from './prisma';

/**
 * ★ Media রেফারেন্স স্ক্যান — "কোন ছবি কোথাও ব্যবহৃত হচ্ছে?"।
 *   Media Library-তে unused-detection ও নিরাপদ delete-এর ভিত্তি।
 *   নতুন কোনো জায়গায় ছবি ব্যবহার শুরু করলে শুধু এখানে একটি উৎস
 *   যোগ করলেই unused-হিসাব ঠিক থাকে (এক জায়গায় সত্য)।
 */
export async function referencedUrls(): Promise<Set<string>> {
  const set = new Set<string>();
  const add = (u?: string | null) => { if (u) set.add(u); };

  const [prods, gallery, banners, camps, settings] = await Promise.all([
    prisma.product.findMany({ select: { image: true, thumbnail: true, banner: true } }),
    prisma.productImage.findMany({ select: { url: true } }),
    prisma.banner.findMany({ select: { image: true } }),
    prisma.campaign.findMany({ select: { imageUrl: true } }),
    prisma.setting.findMany({ select: { value: true } }),
  ]);

  prods.forEach((p) => { add(p.image); add(p.thumbnail); add(p.banner); });
  gallery.forEach((g) => add(g.url));
  banners.forEach((b) => add(b.image));
  camps.forEach((c) => add(c.imageUrl));
  // সেটিংসে সংরক্ষিত URL-সদৃশ মান (লোগো, আইকন ইত্যাদি)
  settings.forEach((s) => { if (/^(https?:\/\/|\/uploads\/)/.test(s.value || '')) add(s.value); });

  return set;
}

/** একটি নির্দিষ্ট url কোথাও ব্যবহৃত কিনা */
export async function isUrlInUse(url: string): Promise<boolean> {
  const refs = await referencedUrls();
  return refs.has(url);
}
