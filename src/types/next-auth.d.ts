import type { DefaultSession } from 'next-auth';
import type { Role } from '@prisma/client';

// ★ ভূমিকা এখানে হাতে লেখা হয় না, বরং Prisma-র generated enum
//   থেকেই আসে — `schema.prisma` ই একমাত্র সত্যের উৎস।
//
//   কেন: আগে এটি হাতে `'USER' | 'ADMIN'` লেখা ছিল, অর্থাৎ একই
//   তথ্য দুই জায়গায়। schema-তে ভূমিকা বদলালে এই ফাইল চুপচাপ
//   পুরনো থেকে যেত এবং build ভাঙত সম্পূর্ণ অন্য জায়গায় গিয়ে।
//   এখন schema বদলালে টাইপ নিজে থেকেই মিলে যায়।

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    role: Role;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
    // ★ session epoch — "সব ডিভাইস সাইন-আউট" এর জন্য (Phase 2)
    epoch?: number;
    /**
     * ★ C5 — শেষ কবে DB থেকে ban/epoch যাচাই হয়েছে (epoch ms)।
     *   অনুপস্থিত = পুরনো টোকেন (এই ফিচারের আগের); তখন **সাথে সাথে**
     *   যাচাই হয় — লগ-আউট নয়, শুধু একবার DB দেখা।
     */
    lastChecked?: number;
  }
}
