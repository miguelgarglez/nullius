// Launch capture for nullius — a real first voyage on the live chart.
// Records the signature moment end to end: arrive, spot the ringed
// pennant, sail closer, name the place, watch it ink into the chart,
// read the ledger entry, sail on.
//
//   node video/record-launch.mjs [url]   → video/raw/launch-<ts>.webm
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(process.cwd() + '/');
const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://nullius-three.vercel.app';
const W = 1440;
const H = 900;
fs.mkdirSync('video/raw', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: 'video/raw', size: { width: W, height: H } },
});
const page = await ctx.newPage();
await page.goto(URL);
await page.waitForTimeout(3500); // ledger settles, guide ring lands

// the chart leans toward the first discovery — let it breathe
await page.waitForTimeout(1500);

// sail a little — a slow deliberate drag
await page.mouse.move(W * 0.5, H * 0.52);
await page.mouse.down();
await page.mouse.move(W * 0.38, H * 0.44, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(1800);

// find the guide pennant (or any reachable unclaimed one) and tap it
const t = await page.evaluate(() => {
  const v = window.__view;
  const pick = (f) => {
    const s = v.toScreen(f.x, f.y);
    return { sx: s.x, sy: s.y };
  };
  if (v.guide) return pick(v.guide);
  const el = document.querySelector('canvas');
  for (const f of v.features) {
    if (v.claims.has(f.id)) continue;
    const s = v.toScreen(f.x, f.y);
    if (s.x > 300 && s.x < el.clientWidth - 300 && s.y > 200 && s.y < el.clientHeight - 260)
      return pick(f);
  }
  return null;
});
if (!t) {
  console.error('no unclaimed pennant in reach');
  await ctx.close();
  process.exit(1);
}
await page.mouse.click(t.sx, t.sy);
await page.waitForTimeout(700);

// name it
const inputs = await page.$$('.claim-card input');
await inputs[0].click();
await page.keyboard.type('Cabo de la Primera Luz', { delay: 55 });
if (inputs[1]) {
  await inputs[1].click();
  await page.keyboard.type('the first sailor', { delay: 55 });
}
await page.waitForTimeout(600);
await page.click(".claim-card button[type='submit']");

// the ceremony: sink → letters ink → ledger entry
await page.waitForTimeout(2600);

// sail on — dismiss the entry, pull back to see the chart it joined
await page.evaluate(() => document.querySelector('.ledger-entry .sail-on')?.click());
await page.waitForTimeout(800);
await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 3; i++) {
  await page.mouse.wheel(0, 320);
  await page.waitForTimeout(220);
}
await page.waitForTimeout(2500);

await ctx.close();
await browser.close();
const files = fs.readdirSync('video/raw').filter((f) => f.endsWith('.webm')).sort();
console.log('video/raw/' + files[files.length - 1]);
