import { chromium } from 'playwright';
const browser = await chromium.launch();
const a = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const b = await browser.newPage({ viewport: { width: 1200, height: 800 } });
a.on('console', (m) => { if (m.type() === 'error') console.log('A ERR:', m.text()); });
await a.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await b.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await a.waitForTimeout(2000);
// dismiss intros
for (const p of [a, b]) {
  const btn = p.locator('.intro-card button');
  if (await btn.count()) await btn.click();
}
await a.waitForTimeout(2500);
console.log('cartouche A:', await a.locator('.cartouche-line').textContent());
console.log('cartouche B:', await b.locator('.cartouche-line').textContent());
await a.screenshot({ path: '/tmp/nullius-harbor.png' });
await browser.close();
