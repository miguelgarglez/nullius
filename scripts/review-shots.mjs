import { chromium } from 'playwright';
const RUN = '/Users/miguelgarglez/Developer/_lab/runs/20261009-002147-l1';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: RUN, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000); // first ~8s: settle + a slow drag so video shows sail feel
await page.mouse.move(720, 450); await page.mouse.down();
for (let i = 0; i < 10; i++) await page.mouse.move(720 - i * 30, 450 + i * 10, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(2500);
await ctx.close();
await page.video()?.saveAs(`${RUN}/first-10s.webm`).catch(() => {});

// hero
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p2.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(2500);
await p2.screenshot({ path: `${RUN}/shots/hero.png` });
// plaque: the claimed cape
await p2.goto('http://localhost:5177/#2068,1336,2.2', { waitUntil: 'networkidle' });
await p2.waitForTimeout(2000);
await p2.mouse.click(720, 300);
await p2.waitForTimeout(600);
await p2.screenshot({ path: `${RUN}/shots/plaque.png` });
// zoomed out
await p2.goto('http://localhost:5177/#2000,1500,0.45', { waitUntil: 'networkidle' });
await p2.waitForTimeout(2500);
await p2.screenshot({ path: `${RUN}/shots/zoomed-out.png` });
// mobile
const m = await browser.newPage({ viewport: { width: 375, height: 667 } });
await m.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await m.waitForTimeout(2500);
await m.screenshot({ path: `${RUN}/shots/mobile.png` });
await browser.close();
console.log('done');
