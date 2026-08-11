/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ পাবলিক সার্চ (Group I ১)
 *
 *   ── আসল দাবিটি "খুঁজে পায়" নয়, "যা দেখানোর নয় তা দেখায় না" ──
 *   এটি একটি **অননুমোদিত** endpoint: যা এখানে ফেরে তা পুরো
 *   ইন্টারনেট পড়তে পারে। তাই টেস্টের বেশিরভাগ অংশ নিষেধাজ্ঞা নিয়ে —
 *   নিষ্ক্রিয় প্রোডাক্ট, বন্ধ ক্যাটাগরি, `costPrice`, রিসেলার দাম।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client } from './helpers/app';

/** ★ নাম নিয়ন্ত্রণ করা দরকার, তাই factories নয় — নিজের হাতে */
async function makeProduct(opts: {
  name: string;
  categoryName?: string;
  active?: boolean;
  categoryActive?: boolean;
  price?: number;
  costPrice?: number;
  resellerPrice?: number | null;
  description?: string;
}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const category = await db.category.create({
    data: {
      name: opts.categoryName ?? `Cat ${tag}`,
      slug: `cat-${tag}`,
      isActive: opts.categoryActive ?? true,
    },
  });
  const product = await db.product.create({
    data: {
      categoryId: category.id,
      name: opts.name,
      slug: `p-${tag}`,
      description: opts.description ?? null,
      isActive: opts.active ?? true,
    },
  });
  await db.variant.create({
    data: {
      productId: product.id,
      label: 'Pack',
      price: opts.price ?? 100,
      costPrice: opts.costPrice ?? 60,
      resellerPrice: opts.resellerPrice ?? null,
      isActive: true,
    },
  });
  return { product, category };
}

async function search(q: string) {
  return client().get(`/api/search?q=${encodeURIComponent(q)}`);
}

describe('সার্চ — যা পাওয়া যায়', () => {
  it('নাম দিয়ে প্রোডাক্ট পাওয়া যায়, দাম সহ', async () => {
    const { product } = await makeProduct({ name: 'Free Fire Diamond', price: 85 });

    const res = await search('diamond');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      productId: product.id,
      name: 'Free Fire Diamond',
      fromPrice: 85,
      variantCount: 1,
    });
  });

  it('ছোট-বড় হাতের অক্ষর উপেক্ষা করে', async () => {
    await makeProduct({ name: 'PUBG UC' });
    expect((await search('pubg')).body.results).toHaveLength(1);
    expect((await search('PUBG')).body.results).toHaveLength(1);
  });

  it('ক্যাটাগরির নাম দিয়েও পাওয়া যায়', async () => {
    await makeProduct({ name: 'Weekly Pass', categoryName: 'Mobile Legends' });
    expect((await search('mobile legends')).body.results).toHaveLength(1);
  });

  it('বিবরণ দিয়েও পাওয়া যায়', async () => {
    await makeProduct({ name: 'Top Up', description: 'গেমের জন্য ডায়মন্ড' });
    expect((await search('ডায়মন্ড')).body.results).toHaveLength(1);
  });

  it('একাধিক ভ্যারিয়েন্টে সর্বনিম্ন দাম দেখায়', async () => {
    const { product } = await makeProduct({ name: 'Bundle', price: 500 });
    await db.variant.create({
      data: { productId: product.id, label: 'Small', price: 120, costPrice: 80, isActive: true },
    });

    const hit = (await search('bundle')).body.results[0];
    expect(hit.fromPrice).toBe(120);
    expect(hit.variantCount).toBe(2);
  });
});

describe('সার্চ — যা কখনো ফেরে না', () => {
  it('নিষ্ক্রিয় প্রোডাক্ট আসে না', async () => {
    await makeProduct({ name: 'Hidden Diamond', active: false });
    expect((await search('hidden')).body.results).toHaveLength(0);
  });

  /** ★ ক্যাটাগরি বন্ধ থাকলে হোমপেজেও দেখায় না — সার্চ যেন লুকানো দরজা না হয় */
  it('বন্ধ ক্যাটাগরির প্রোডাক্ট আসে না', async () => {
    await makeProduct({ name: 'Secret Pack', categoryActive: false });
    expect((await search('secret')).body.results).toHaveLength(0);
  });

  it('নিষ্ক্রিয় ভ্যারিয়েন্ট দামে গোনা হয় না', async () => {
    const { product } = await makeProduct({ name: 'Mixed', price: 300 });
    await db.variant.create({
      data: { productId: product.id, label: 'Old', price: 10, costPrice: 5, isActive: false },
    });

    const hit = (await search('mixed')).body.results[0];
    // ★ ১০ নয় — নিষ্ক্রিয় ভ্যারিয়েন্টের দাম দেখালে "৳১০ থেকে" মিথ্যা বিজ্ঞাপন হতো
    expect(hit.fromPrice).toBe(300);
    expect(hit.variantCount).toBe(1);
  });

  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('costPrice ও রিসেলার দাম উত্তরে কোথাও নেই', async () => {
    await makeProduct({
      name: 'Profit Check', price: 500, costPrice: 137, resellerPrice: 411,
    });

    const res = await search('profit');
    const raw = JSON.stringify(res.body);

    expect(res.body.results).toHaveLength(1);
    // ★ মানগুলো ইচ্ছাকৃতভাবে অস্বাভাবিক — কাকতালীয়ভাবে মিলবে না
    expect(raw).not.toContain('137');
    expect(raw).not.toContain('411');
    expect(raw).not.toContain('costPrice');
    expect(raw).not.toContain('resellerPrice');
    expect(raw).not.toContain('stock');
  });
});

describe('সার্চ — প্রশ্ন যাচাই', () => {
  it('খুব ছোট প্রশ্নে খালি ফল, ত্রুটি নয়', async () => {
    await makeProduct({ name: 'Diamond' });

    const res = await search('d');
    // ★ টাইপ করার সময় প্রতিটি অক্ষরে ৪০০ পাঠালে কনসোল ভরে যেত
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.minLength).toBe(2);
  });

  it('খালি প্রশ্নে পুরো ক্যাটালগ ফেরে না', async () => {
    await makeProduct({ name: 'Diamond' });
    expect((await client().get('/api/search')).body.results).toHaveLength(0);
  });

  it('অতিরিক্ত লম্বা প্রশ্ন প্রত্যাখ্যাত (খালি ফল)', async () => {
    await makeProduct({ name: 'Diamond' });
    expect((await search('x'.repeat(200))).body.results).toHaveLength(0);
  });

  it('SQL-সদৃশ ইনপুটে কিছু ভাঙে না', async () => {
    await makeProduct({ name: 'Diamond' });

    for (const evil of ["' OR 1=1 --", '%', '_', 'DROP TABLE "Product"']) {
      const res = await search(evil);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.results)).toBe(true);
    }
    // ★ টেবিল এখনো আছে — প্যারামিটারাইজড কোয়েরির প্রমাণ
    expect(await db.product.count()).toBe(1);
  });

  it('`%` দিয়ে সব প্রোডাক্ট বের করা যায় না', async () => {
    await makeProduct({ name: 'Alpha' });
    await makeProduct({ name: 'Beta' });

    // ★ `%` LIKE-এর wildcard; escape না হলে এটি পুরো ক্যাটালগ ফেরত দিত
    expect((await search('%%')).body.results).toHaveLength(0);
  });
});

describe('সার্চ পাতা', () => {
  it('ফলাফল সার্ভার-রেন্ডার হয় (JS ছাড়াই কাজ করে)', async () => {
    await makeProduct({ name: 'Server Rendered Pack' });

    const res = await client().raw('/search?q=rendered');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('Server Rendered Pack');
  });

  it('কিছু না পেলে পরিষ্কার বার্তা', async () => {
    const res = await client().raw('/search?q=nothingmatches');
    expect((await res.text())).toContain('কিছু পাওয়া যায়নি');
  });
});
