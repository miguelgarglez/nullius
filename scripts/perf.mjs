import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const mod = await import('/src/render/chart.ts');
  const t0 = performance.now();
  for (let i = 0; i < 6; i++) mod.renderTile(1, i, 3);
  const t1 = performance.now();
  return { msPerTile: ((t1 - t0) / 6).toFixed(1) };
});
console.log(r);
await browser.close();
