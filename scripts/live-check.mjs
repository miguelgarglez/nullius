import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, vp] of [['live-1440', { width: 1440, height: 900 }], ['live-375', { width: 375, height: 740 }]]) {
  const p = await b.newPage({ viewport: vp });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto('https://nullius-three.vercel.app/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(5000);
  const line = await p.locator('.ledger-line').innerText().catch(() => 'MISSING');
  console.log(name, '| ledger-line:', JSON.stringify(line.replace(/\s+/g, ' ').trim()));
  await p.screenshot({ path: `/tmp/nullius-${name}.png` });
  console.log(name, '| console errors:', errs.length, errs.slice(0, 3));
  await p.close();
}
await b.close();
