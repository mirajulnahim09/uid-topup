/**
 * ★ ম্যাসকট প্রিভিউ হারনেস — `npx tsx scripts/loading-preview.ts`
 *
 *   কেন এটি দরকার: শিল্পকর্ম ঠিক হলো কি না তা **অ্যাসারশন দিয়ে জানা
 *   যায় না** — তাকিয়ে দেখতে হয়। কিন্তু পূর্ণ লগইন-প্রবাহ দিয়ে দেখতে
 *   প্রতিবার build + start + auth-hold লাগত (~২ মিনিট)। এই হারনেস
 *   কম্পোনেন্টটিকে সরাসরি স্ট্যাটিক HTML-এ রেন্ডার করে ও `globals.css`
 *   থেকে NOVA ব্লকটুকু কেটে নেয়, তাই লুপটি ~৩ সেকেন্ড।
 *
 *   এটি টেস্ট নয় — টেস্ট `loading-test.ts`। এটি চোখের জন্য।
 */
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { createElement } from 'react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { chromium } from 'playwright-core';

/**
 * ⚠️ tsx/esbuild এখানে **classic** JSX ট্রান্সফর্ম ব্যবহার করে
 * (`React.createElement`), কিন্তু Next-এর কম্পোনেন্টগুলো React
 * ইমপোর্ট করে না — অ্যাপে automatic runtime চলে। তাই গ্লোবালে
 * React বসিয়ে দিতে হয়, নাহলে "React is not defined"।
 */
(globalThis as unknown as { React: typeof React }).React = React;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LoadingStage = require('../src/components/loading/LoadingStage').default as
  (p: { size?: number; uid?: string; messages?: string[] }) => React.ReactElement;

const OUT = 'audit/loading';
mkdirSync(OUT, { recursive: true });
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

/** globals.css থেকে NOVA ব্লকটুকু — Tailwind directive/@apply ছাড়া বিশুদ্ধ CSS */
const css = readFileSync('src/app/globals.css', 'utf8');
const nova = css.slice(css.indexOf('.nv-svg * {'));

/** থিম-টোকেন (globals.css এর মান হুবহু) */
const TOKENS = {
  dark: '--v-void:#0a0b11; --v-ink:#eef1f6; --v-volt:#c8ff3d; --v-ice:#7dd3fc;',
  light: '--v-void:#f4f6fb; --v-ink:#0f1729; --v-volt:#5a8a00; --v-ice:#0284c7;',
};

const MESSAGES = ['নিরাপদে সংযুক্ত হচ্ছে…', 'আপনার গেমিং অভিজ্ঞতা প্রস্তুত হচ্ছে…', 'ড্যাশবোর্ড লোড হচ্ছে…'];

function html(theme: 'dark' | 'light', size: number) {
  const stage = renderToStaticMarkup(
    createElement(LoadingStage, { size, uid: 'pv', messages: MESSAGES }),
  );
  return `<!doctype html><html data-t="${theme}"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{${TOKENS[theme]}}
    /* ওভারলের আসল চেহারা: থিমের void-রঙ ৮৮% + নরম vignette */
    body{min-height:100vh;display:grid;place-items:center;
      font-family:system-ui,'Noto Sans Bengali',sans-serif;
      background:var(--v-void);
    }
    body::before{content:'';position:fixed;inset:0;pointer-events:none;
      background:radial-gradient(125% 95% at 50% 44%, transparent 0%,
        rgba(0,0,0,.18) 62%, rgba(0,0,0,.34) 100%);}
    :root[data-t='light'] body::before{background:radial-gradient(125% 95% at 50% 44%,
      transparent 0%, rgba(20,28,48,.05) 62%, rgba(20,28,48,.11) 100%);}
    .v-dsp{font-weight:800}
    .flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}
    .gap-3{gap:.75rem}.text-center{text-align:center}.mt-0\\.5{margin-top:.125rem}
    .block{display:block}.rounded-full{border-radius:9999px}
    .h-\\[3px\\]{height:3px}.w-\\[132px\\]{width:132px}
    ${nova}
  </style></head><body>${stage}</body></html>`;
}

async function main() {
  if (!exe) { console.log('FATAL: no browser'); process.exit(1); }
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });

  for (const theme of ['dark', 'light'] as const) {
    const f = `${OUT}/_preview-${theme}.html`;
    writeFileSync(f, html(theme, 460), 'utf8');
    await page.goto(`file:///${process.cwd().replace(/\\/g, '/')}/${f}`);

    // ★ চক্রের চারটি গুরুত্বপূর্ণ মুহূর্ত — বিশ্রাম, প্রস্তুতি, আঘাত, ফেরা
    for (const [pct, name] of [[0.05, "rest"], [0.24, "wind-up"], [0.30, "strike"], [0.38, "flight"], [0.455, "ignite"], [0.58, "charged"]] as const) {
      await page.evaluate((p) => {
        document.getAnimations().forEach((a) => {
          a.pause();
          a.currentTime = Number(a.effect?.getTiming().duration ?? 5200) * p;
        });
      }, pct);
      await page.screenshot({ path: `${OUT}/_pv-${theme}-${name}.png` });
    }
  }

  await browser.close();
  console.log(`preview shots → ${OUT}/_pv-*.png`);
}

main();
