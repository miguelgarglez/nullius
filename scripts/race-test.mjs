// NOTE: submits REAL claims to the configured ledger.
// Guarded: requires NULLIUS_WRITE_OK=1.
import { chromium } from 'playwright';
if (!process.env.NULLIUS_WRITE_OK) { console.log('set NULLIUS_WRITE_OK=1 — this writes real claims'); process.exit(2); }
const browser = await chromium.launch();
const a = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const b = await browser.newPage({ viewport: { width: 1200, height: 800 } });
for (const p of [a, b]) {
  await p.goto('http://localhost:5177/#-700,700,1.4', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const btn = p.locator('.intro-card button');
  if (await btn.count()) await btn.click();
}
// find an UNCLAIMED feature (avoid the already-claimed cape)
const target = await a.evaluate(async () => {
  const { featuresInBox } = await import('/src/world/features.ts');
  const cam = { x: -700, y: 700, scale: 1.4 };
  const w = 1200, h = 800;
  const fs = featuresInBox(cam.x - w/2/cam.scale, cam.y - h/2/cam.scale, cam.x + w/2/cam.scale, cam.y + h/2/cam.scale);
  const f = fs.find(f => f.kind === 'island') || fs[0];
  return { id: f.id, sx: (f.x - cam.x) * cam.scale + w/2, sy: (f.y - cam.y) * cam.scale + h/2 };
});
console.log('racing feature:', target.id);
for (const [p, who] of [[a, 'Marina'], [b, 'Silas']]) {
  await p.mouse.click(target.sx, target.sy);
  await p.waitForTimeout(400);
}
await a.fill('.claim-card input[aria-label^="Name"]', 'Twin Rooks');
await a.fill('.claim-card input[aria-label="Your sailor name"]', 'Marina');
await b.fill('.claim-card input[aria-label^="Name"]', 'Los Cuernos');
await b.fill('.claim-card input[aria-label="Your sailor name"]', 'Silas');
await Promise.all([
  a.click('.claim-card button[type="submit"]'),
  b.click('.claim-card button[type="submit"]'),
]);
await a.waitForTimeout(2000);
await b.waitForTimeout(2000);
console.log('A taken?', await a.locator('.claim-taken').count(), '| A card text:', (await a.locator('.claim-card').textContent())?.slice(0, 120));
console.log('B taken?', await b.locator('.claim-taken').count(), '| B card text:', (await b.locator('.claim-card').textContent())?.slice(0, 120));
await a.screenshot({ path: '/tmp/nullius-race-a.png' });
await b.screenshot({ path: '/tmp/nullius-race-b.png' });
await browser.close();
