'use client';

import { motion } from 'framer-motion';

/**
 * ★ প্রতি পেজ নেভিগেশনে মসৃণ fade-slide transition।
 *   template.tsx প্রতিবার re-mount হয়, তাই animation চলে।
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
