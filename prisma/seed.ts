import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}
function slugify(s: string) {
  return (
    s.toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'product'
  );
}

async function main() {
  console.log('🌱 Seeding...');

  // ═══ Settings ═══
  const settings: Record<string, string> = {
    site_name: 'UID TopUp',
    site_notice: '১০ সেকেন্ডে ডেলিভারি — ২৪/৭ সার্ভিস চালু।',
    hero_title: 'ফ্রি ফায়ার ডায়মন্ড টপ আপ',
    hero_subtitle: 'কম দামে ভালো সার্ভিস',
    min_deposit: '20',
    max_deposit: '25000',
    referral_bonus: '20',
    referral_min_deposit: '100',
    support_email: 'support@uidtopup.local',
    support_phone: '01700000000',
    support_hours: 'সকাল ৯টা – রাত ১১টা',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log('  ✓ settings');

  // ═══ Admin ═══
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@uidtopup.local';
  const adminPass = process.env.ADMIN_PASSWORD || 'Admin@2026Secure';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: 'Admin',
      email: adminEmail,
      phone: '01700000000',
      password: await bcrypt.hash(adminPass, 12),
      role: 'ADMIN',
      referralCode: makeCode(),
    },
  });
  console.log(`  ✓ admin: ${adminEmail} / ${adminPass}`);

  // ═══ Payment ═══
  if ((await prisma.paymentChannel.count()) === 0) {
    await prisma.paymentChannel.createMany({
      data: [
        {
          method: 'BKASH', accountNo: '01700000001', accountType: 'Personal',
          instruction: 'bKash অ্যাপে Send Money করুন। Cash Out করবেন না।', sortOrder: 0,
        },
        {
          method: 'NAGAD', accountNo: '01700000002', accountType: 'Personal',
          instruction: 'Nagad অ্যাপে Send Money করুন।', sortOrder: 1,
        },
      ],
    });
    console.log('  ✓ payment channels (⚠️ নাম্বার বদলান!)');
  }

  // ═══ Social ═══
  if ((await prisma.socialLink.count()) === 0) {
    await prisma.socialLink.createMany({
      data: [
        { platform: 'facebook', url: 'https://facebook.com', label: 'আমাদের পেজ', sortOrder: 0 },
        { platform: 'messenger', url: 'https://m.me', label: 'সাপোর্ট চ্যাট', sortOrder: 1 },
        { platform: 'whatsapp', url: 'https://wa.me/8801700000000', sortOrder: 2 },
      ],
    });
    console.log('  ✓ social links (⚠️ লিংক বদলান!)');
  }

  // ═══ Categories — uidtopup এর মতো ═══
  const ff = await prisma.category.upsert({
    where: { slug: 'free-fire' },
    update: { name: 'FREE FIRE' },
    create: { name: 'FREE FIRE', slug: 'free-fire', sortOrder: 0 },
  });
  const lfs = await prisma.category.upsert({
    where: { slug: 'like-follow-subscribe' },
    update: {},
    create: { name: 'LIKE - FOLLOW - SUBSCRIBE', slug: 'like-follow-subscribe', sortOrder: 1 },
  });

  if ((await prisma.product.count()) === 0) {
    // ─── Free Fire [BD SERVER] — স্ক্রিনশটের হুবহু দাম ───
    const bd = await prisma.product.create({
      data: {
        categoryId: ff.id,
        name: 'Free Fire [BD SERVER]',
        slug: slugify('Free Fire BD SERVER'),
        description: 'FREE FIRE',
        uidLabel: 'Player UID',
        uidHint: 'গেমের প্রোফাইল থেকে UID কপি করুন (শুধু সংখ্যা)',
        sortOrder: 0,
      },
    });
    const bdPkgs: [string, number, number][] = [
      // [label, price, costPrice]
      ['25 Diamond', 20, 17], ['50 Diamond', 36, 30], ['Weekly lite', 42, 35],
      ['100 Diamond', 72, 61], ['115 Diamond', 78, 66], ['240 Diamond', 158, 134],
      ['355 Diamond', 240, 204], ['480 Diamond', 316, 269], ['505 Diamond', 340, 289],
      ['610 Diamond', 400, 340], ['725 Diamond', 480, 408], ['850 Diamond', 560, 476],
      ['1015 Diamond', 680, 578], ['1090 Diamond', 715, 608], ['1240 Diamond', 800, 680],
      ['1480 Diamond', 960, 816], ['1595 Diamond', 1040, 884], ['1850 Diamond', 1200, 1020],
      ['2090 Diamond', 1360, 1156], ['2530 Diamond', 1610, 1369], ['5060 Diamond', 3220, 2737],
    ];
    await prisma.variant.createMany({
      data: bdPkgs.map(([label, price, costPrice], i) => ({
        productId: bd.id, label, price, costPrice, sortOrder: i,
        isPopular: label === '115 Diamond' || label === '610 Diamond',
      })),
    });

    // ─── বাকি FF প্রোডাক্ট ───
    const ffProducts = [
      {
        name: 'Free Fire Membership',
        uidLabel: 'Player UID',
        pkgs: [['Weekly Membership', 165, 140], ['Monthly Membership', 790, 675]] as [string, number, number][],
      },
      {
        name: 'Free Fire Level Up Pass BD',
        uidLabel: 'Player UID',
        pkgs: [['Level Up Pass', 55, 46], ['Level Up Pass Plus', 110, 93]] as [string, number, number][],
      },
      {
        name: 'Weekly Lite Membership',
        uidLabel: 'Player UID',
        pkgs: [['Weekly Lite', 42, 35]] as [string, number, number][],
      },
      {
        name: 'Free Fire Like',
        uidLabel: 'Player UID',
        pkgs: [['100 Like (Daily)', 60, 48]] as [string, number, number][],
      },
      {
        name: 'Free Fire Voucher for UniPin',
        uidLabel: 'Player UID',
        pkgs: [['UniPin Voucher 50', 90, 76], ['UniPin Voucher 100', 175, 149]] as [string, number, number][],
      },
      {
        name: 'Free Fire Indonesia',
        uidLabel: 'Player UID',
        pkgs: [['50 Diamond (ID)', 40, 34], ['140 Diamond (ID)', 105, 89], ['355 Diamond (ID)', 255, 217]] as [string, number, number][],
      },
      {
        name: 'Level Up Pass Indonesia',
        uidLabel: 'Player UID',
        pkgs: [['Level Up Pass (ID)', 60, 51]] as [string, number, number][],
      },
    ];

    for (let i = 0; i < ffProducts.length; i++) {
      const fp = ffProducts[i];
      const p = await prisma.product.create({
        data: {
          categoryId: ff.id,
          name: fp.name,
          slug: slugify(fp.name),
          description: 'FREE FIRE',
          uidLabel: fp.uidLabel,
          uidHint: 'গেমের প্রোফাইল থেকে UID কপি করুন',
          sortOrder: i + 1,
        },
      });
      await prisma.variant.createMany({
        data: fp.pkgs.map(([label, price, costPrice], j) => ({
          productId: p.id, label, price, costPrice, sortOrder: j,
        })),
      });
    }

    // ─── LIKE - FOLLOW - SUBSCRIBE ───
    const subs = [
      {
        name: 'YouTube Premium',
        uidLabel: 'জিমেইল অ্যাড্রেস',
        hint: 'যে জিমেইলে সাবস্ক্রিপশন চান সেটি দিন',
        pkgs: [['১ মাস', 120, 95], ['৩ মাস', 330, 270], ['৬ মাস', 620, 510]] as [string, number, number][],
      },
      {
        name: 'Prime Video',
        uidLabel: 'ইমেইল অ্যাড্রেস',
        hint: 'যে ইমেইলে সাবস্ক্রিপশন চান',
        pkgs: [['১ মাস', 150, 125], ['৩ মাস', 420, 350]] as [string, number, number][],
      },
      {
        name: 'Netflix',
        uidLabel: 'ইমেইল অ্যাড্রেস',
        hint: 'যে ইমেইলে সাবস্ক্রিপশন চান',
        pkgs: [['১ মাস (Mobile)', 200, 168], ['১ মাস (HD)', 350, 295]] as [string, number, number][],
      },
    ];

    for (let i = 0; i < subs.length; i++) {
      const sp = subs[i];
      const p = await prisma.product.create({
        data: {
          categoryId: lfs.id,
          name: sp.name,
          slug: slugify(sp.name),
          description: 'LIKE - FOLLOW - SUBSCRIBE',
          uidLabel: sp.uidLabel,
          uidHint: sp.hint,
          sortOrder: i,
        },
      });
      await prisma.variant.createMany({
        data: sp.pkgs.map(([label, price, costPrice], j) => ({
          productId: p.id, label, price, costPrice, sortOrder: j,
        })),
      });
    }

    console.log('  ✓ 11 products + variants (uidtopup.com এর মতো)');
  }

  // ═══ Coupon ═══
  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10', type: 'PERCENT', value: 10,
      minOrder: 100, maxDiscount: 50, perUserLimit: 1, isActive: true,
    },
  });
  console.log('  ✓ coupon: WELCOME10');

  console.log('\n✅ Seed complete!');
  console.log('┌─────────────────────────────────────────┐');
  console.log(`│ Admin: ${adminEmail.padEnd(32)}│`);
  console.log(`│ Pass:  ${adminPass.padEnd(32)}│`);
  console.log('└─────────────────────────────────────────┘');
  console.log('\n⚠️  Admin → সাইট সেটিংস এ গিয়ে');
  console.log('   পেমেন্ট নাম্বার ও সোশ্যাল লিংক বদলান!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
