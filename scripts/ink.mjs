import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5177/#2000,1500,1.4', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// dismiss first note if present, sail to the freshly claimed cape
await page.evaluate(() => localStorage.setItem('nullius.seen-intro', '1'));
await page.goto('http://localhost:5177/#2068,1336,2.2', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/nullius-v8-inked.png' });
await browser.close();
