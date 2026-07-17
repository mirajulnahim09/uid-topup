'use client';

import { motion } from 'framer-motion';

export default function ContactHero() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center"
    >
      <motion.div
        className="text-5xl"
        aria-hidden="true"
        animate={{ rotate: [0, -10, 10, -10, 0] }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        💬
      </motion.div>
      <h1 className="mt-3 text-3xl font-extrabold text-slate-900">যোগাযোগ</h1>
      <p className="mt-1 text-slate-500">যেকোনো সমস্যায় আমরা আছি</p>
    </motion.header>
  );
}
