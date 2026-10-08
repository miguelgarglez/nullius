import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => errors.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => errors.push('PAGE-ERR: ' + e.message + '\n' + (e.stack||'')));
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const c = document.querySelector('canvas.chart');
  return { w: c?.width, h: c?.height, cw: c?.clientWidth, ch: c?.clientHeight };
});
console.log(JSON.stringify(r), errors.slice(0,10).join('\n'));
await browser.close();
