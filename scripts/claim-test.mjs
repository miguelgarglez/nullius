// NOTE: submits REAL claims to the configured ledger.
// Guarded: requires NULLIUS_WRITE_OK=1.
import { chromium } from 'playwright';
if (!process.env.NULLIUS_WRITE_OK) { console.log('set NULLIUS_WRITE_OK=1 — this writes real claims'); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()); });
await page.goto('http://localhost:5177/#0,0,1.6', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// dismiss intro
const btn = page.locator('.intro-card button');
if (await btn.count()) await btn.click();
await page.waitForTimeout(300);

// find an unclaimed feature on screen via the same modules the app uses
const target = await page.evaluate(async () => {
  const { featuresInBox } = await import('/src/world/features.ts');
  const cam = { x: 0, y: 0, scale: 1.6 };
  const w = 1440, h = 900;
  const x0 = cam.x - w / 2 / cam.scale, x1 = cam.x + w / 2 / cam.scale;
  const y0 = cam.y - h / 2 / cam.scale, y1 = cam.y + h / 2 / cam.scale;
  const fs = featuresInBox(x0, y0, x1, y1);
  let best = null, bd = 1e9;
  for (const f of fs) {
    const d = Math.hypot(f.x - cam.x, f.y - cam.y);
    if (d < bd) { bd = d; best = f; }
  }
  if (!best) return null;
  return {
    id: best.id, kind: best.kind,
    sx: (best.x - cam.x) * cam.scale + w / 2,
    sy: (best.y - cam.y) * cam.scale + h / 2,
  };
});
console.log('target feature:', target);
if (!target) { process.exit(1); }

await page.mouse.click(target.sx, target.sy);
await page.waitForTimeout(400);
console.log('card visible:', await page.locator('.claim-card').count());
await page.screenshot({ path: '/tmp/nullius-card.png' });
await page.fill('.claim-card input[aria-label^="Name"]', 'Isla de Prueba');
await page.fill('.claim-card input[aria-label="Your sailor name"]', 'Devin');
await page.click('.claim-card button[type="submit"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/nullius-named.png' });
await browser.close();
