import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      screens: { xs: '400px' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
      },
      /**
       * ★★★ Maison ডিজাইন টোকেন (4.8)
       *
       *   `globals.css` এর `:root` ভেরিয়েবলগুলো এখন Tailwind ক্লাস
       *   হিসেবেও পাওয়া যায় — `text-ink`, `bg-glass`, `border-hair`,
       *   `text-gold` ইত্যাদি।
       *
       *   কেন দরকার ছিল: এতদিন CSS ভেরিয়েবল ব্যবহার করতে হলে
       *   `style={{ color: 'var(--mut)' }}` লিখতে হতো, যা বেশিরভাগ
       *   ডেভেলপার (ও আগের কমিটগুলো) এড়িয়ে গিয়ে কাছাকাছি দেখতে
       *   একটা hardcoded Tailwind রঙ বেছে নিত — এভাবেই টোকেন
       *   ছড়িয়ে পড়েছিল (AUDIT_REPORT M9)।
       *
       *   ⚠️ সব মান `var(--x)` হিসেবেই রাখা — কোনো hex কপি করা হয়নি।
       *   হেক্স কপি করলে দুটো সত্যের উৎস তৈরি হতো, আর থিম বদলালে
       *   একটি নীরবে পুরনো রঙে আটকে থাকত।
       */
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        glass: 'var(--glass)',
        hair: 'var(--hair)',
        ink: 'var(--ink)',
        mut: 'var(--mut)',
        line: 'var(--line)',
        gold: 'var(--gold)',
        ice: 'var(--ice)',
        violet: 'var(--violet)',
        rose: 'var(--rose)',
        red: 'var(--red)',
      },
      borderColor: {
        hair: 'var(--hair)',
        line: 'var(--line)',
      },
    },
  },
  plugins: [],
};
export default config;
