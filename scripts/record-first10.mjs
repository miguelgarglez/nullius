import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: '/tmp/nullius-rec', size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
await page.goto('https://nullius-three.vercel.app/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const btn = page.locator('.intro-card button');
if (await btn.count()) await btn.click();
// sail a little: drag then tap a pennant
await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(860, 380, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
