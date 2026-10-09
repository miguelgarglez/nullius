import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/nullius-v8-mobile.png' });
// tap a pennant
const t = await page.evaluate(async () => {
  const { featuresInBox } = await import('/src/world/features.ts');
  const hash = location.hash.slice(1).split(',').map(Number);
  const cam = { x: hash[0], y: hash[1], scale: hash[2] };
  const fs = featuresInBox(cam.x - 187/cam.scale, cam.y - 333/cam.scale, cam.x + 187/cam.scale, cam.y + 333/cam.scale);
  const f = fs[0];
  return f ? { sx: (f.x - cam.x)*cam.scale + 187.5, sy: (f.y - cam.y)*cam.scale + 333.5, id: f.id } : null;
});
if (t) {
  await page.mouse.click(t.sx, t.sy);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/nullius-v8-mobile-card.png' });
}
await browser.close();
