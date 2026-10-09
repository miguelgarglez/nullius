import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
if (!process.env.NULLIUS_WRITE_OK) { console.log('set NULLIUS_WRITE_OK=1'); process.exit(2); }
try { loadEnvFile('.env.local'); } catch { /* env vars may already be set */ }
const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SB_URL || !SB_KEY) { console.log('set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY'); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR:', m.text()); });
await page.goto('http://localhost:5177/#4200,-3200,1.4', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/nullius-v7-idle.png' });
// find an unclaimed feature
// sweep a few anchor spots until an unclaimed feature sits on screen
let target = null, anchor = null;
for (const [ax, ay] of [[4200,-3200],[2000,1500],[-4500,800],[6000,6000],[-2500,-4500],[1000,-800],[3500,2200]]) {
  await page.goto(`http://localhost:5177/#${ax},${ay},1.4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const t = await page.evaluate(async ([ax, ay, sbUrl, sbKey]) => {
    const { featuresInBox } = await import('/src/world/features.ts');
    const cam = { x: ax, y: ay, scale: 1.4 };
    const fs = featuresInBox(cam.x - 720/1.4, cam.y - 450/1.4, cam.x + 720/1.4, cam.y + 450/1.4);
    const res = await fetch(`${sbUrl}/rest/v1/claims?select=feature_key`, { headers: { apikey: sbKey, 'Accept-Profile': 'nullius' } });
    const claimed = new Set((await res.json()).map(r => r.feature_key));
    const vis = fs.filter(f => { const sx=(f.x-cam.x)*1.4+720, sy=(f.y-cam.y)*1.4+450; return sx>200&&sx<1240&&sy>200&&sy<700&&!claimed.has(f.id); });
    const f = vis.find(f => f.kind==='island') || vis[0];
    return f ? { id: f.id, kind: f.kind, sx: (f.x-cam.x)*1.4+720, sy: (f.y-cam.y)*1.4+450 } : null;
  }, [ax, ay, SB_URL, SB_KEY]);
  if (t) { target = t; anchor = [ax, ay]; break; }
}
if (!target) { console.log('no unclaimed feature found on any anchor'); process.exit(1); }
console.log('claiming', target, 'at anchor', anchor);
await page.mouse.click(target.sx, target.sy);
await page.waitForTimeout(400);
await page.fill('.claim-card input[aria-label^="Name"]', 'Ceremony Isle');
await page.fill('.claim-card input[aria-label="Your sailor name"]', 'Devin');
await page.click('.claim-card button[type="submit"]');
await page.waitForTimeout(260); // mid-sink
await page.screenshot({ path: '/tmp/nullius-v7-sink.png' });
await page.waitForTimeout(600); // inscribing
await page.screenshot({ path: '/tmp/nullius-v7-inking.png' });
await page.waitForTimeout(1200); // receipt up
await page.screenshot({ path: '/tmp/nullius-v7-receipt.png' });
await browser.close();
