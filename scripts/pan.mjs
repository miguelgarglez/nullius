import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text()); });
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
// fast fling across several tile boundaries — catch mid-render state
await page.mouse.move(720, 450);
await page.mouse.down();
for (let i = 0; i < 18; i++) { await page.mouse.move(720 - i * 70, 450 + i * 18, { steps: 2 }); }
await page.mouse.up();
await page.waitForTimeout(350); // mid-refinement
await page.screenshot({ path: '/tmp/nullius-v8-fling.png' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/nullius-v8-settled.png' });
await browser.close();
