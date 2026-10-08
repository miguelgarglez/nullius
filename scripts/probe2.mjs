import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => errors.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => errors.push('PAGE-ERR: ' + e.message + '\n' + (e.stack||'')));
const resp = await page.goto('http://localhost:5177/', { waitUntil: 'load' });
console.log('status', resp?.status());
await page.waitForTimeout(2000);
const r = await page.evaluate(() => ({
  root: document.getElementById('root')?.innerHTML.slice(0, 400),
  canvases: document.querySelectorAll('canvas').length,
  overlay: document.querySelector('vite-error-overlay')?.outerHTML?.slice(0, 500) || null,
}));
console.log(JSON.stringify(r, null, 1));
console.log(errors.join('\n'));
await browser.close();
