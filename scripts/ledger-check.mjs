// Verifies the ledger end to end against whatever Supabase project the
// app points at: two clients, one claims a feature, the other must see
// it arrive live (postgres_changes), and both must count two sailors
// abroad (presence). Requires NULLIUS_WRITE_OK=1 — it writes a real claim.
// Usage: NULLIUS_WRITE_OK=1 node scripts/ledger-check.mjs [base-url]
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.NULLIUS_WRITE_OK) { console.log('set NULLIUS_WRITE_OK=1 — this writes a real claim'); process.exit(2); }
const BASE = process.argv[2] || 'http://localhost:5177';
const W = 1280, H = 800, CAM = { x: 0, y: 0, scale: 1.6 };

// world modules are pure TS — bundle them in memory so this script works
// against dev, preview and production builds alike
const tmp = join(mkdtempSync(join(tmpdir(), 'nullius-')), 'features.mjs');
const out = buildSync({
  entryPoints: ['src/world/features.ts'],
  bundle: true, format: 'esm', write: false,
});
writeFileSync(tmp, out.outputFiles[0].text);
const { featuresInBox } = await import(`file://${tmp}`);
const fs = featuresInBox(
  CAM.x - W / 2 / CAM.scale, CAM.y - H / 2 / CAM.scale,
  CAM.x + W / 2 / CAM.scale, CAM.y + H / 2 / CAM.scale,
);
const cands = fs.map((f) => ({
  f,
  sx: (f.x - CAM.x) * CAM.scale + W / 2,
  sy: (f.y - CAM.y) * CAM.scale + H / 2,
})).filter((c) => c.sx > 24 && c.sx < W - 24 && c.sy > 24 && c.sy < H - 24);
if (!cands.length) { console.log('FAIL: no feature in view'); process.exit(1); }

const browser = await chromium.launch();
const errors = [];
const mk = async () => {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await p.goto(`${BASE}/#${CAM.x},${CAM.y},${CAM.scale}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const btn = p.locator('.intro-card button');
  if (await btn.count()) await btn.click();
  return p;
};
const a = await mk();
const b = await mk();

// the first-run guide glides the camera once toward a pennant — wait for
// the ref line to settle before trusting any screen coordinate
// innerText (not textContent) keeps the <br/> break between the camera
// ref and the counters, so "×1.60" and "2 sailors" never merge into "1.602"
const line = async (p) => (await p.locator('.ledger-line').innerText()) ?? '';
const camOf = (t) => {
  const m = /ref (-?\d+) · (-?\d+) · ×([\d.]+)/.exec(t);
  return m ? { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) } : null;
};
const settledCam = async (p) => {
  let last = await line(p);
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(700);
    const cur = await line(p);
    if (cur === last) return camOf(cur);
    last = cur;
  }
  return camOf(last);
};
const camA = await settledCam(a);
console.log('A settled at', camA);
// pick a candidate whose pixel is really the canvas (not under the title,
// the note strip, or a control) — elementFromPoint is the truth
let target = null;
for (const { f } of cands) {
  if (!camA) break;
  const sx = (f.x - camA.x) * camA.s + W / 2;
  const sy = (f.y - camA.y) * camA.s + H / 2;
  if (sx < 24 || sx > W - 24 || sy < 24 || sy > H - 24) continue;
  const el = await a.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [sx, sy]);
  if (el === 'CANVAS') { target = { id: f.id, wx: f.x, wy: f.y, sx, sy }; break; }
}
if (!target) {
  // nothing in the settled view: widen the search, sail there, re-aim
  const near = featuresInBox(camA.x - 1200, camA.y - 800, camA.x + 1200, camA.y + 800);
  const f = near.find((x) => x.kind === 'island') || near[0];
  if (!f) { console.log('FAIL: no feature anywhere near'); process.exit(1); }
  await a.evaluate(([x, y]) => { location.hash = `#${Math.round(x)},${Math.round(y)},1.6`; }, [f.x, f.y]);
  await a.waitForTimeout(2500);
  const cam2 = camOf(await line(a)) ?? camA;
  target = { id: f.id, wx: f.x, wy: f.y, sx: (f.x - cam2.x) * cam2.s + W / 2, sy: (f.y - cam2.y) * cam2.s + H / 2 };
}
console.log('target feature:', target.id, 'at', Math.round(target.sx), Math.round(target.sy));

// presence: each client counts itself + the other
await a.waitForTimeout(4000);
const la = await line(a), lb = await line(b);
console.log('A ledger-line:', la.replace(/\s+/g, ' ').trim());
console.log('B ledger-line:', lb.replace(/\s+/g, ' ').trim());
const abroadOf = (t) => {
  const m = /(\d+) sailors? abroad/.exec(t);
  return m ? Number(m[1]) : null;
};
if (abroadOf(la) !== 2 || abroadOf(lb) !== 2) {
  console.log('FAIL: presence did not report exactly 2 sailors on both clients');
  process.exit(1);
}
const namesOf = (t) => {
  const m = /(\d+) names? given/.exec(t);
  return m ? Number(m[1]) : null;
};
const namesB0 = namesOf(lb);
if (namesB0 === null) { console.log('FAIL: could not read B name counter'); process.exit(1); }

// A claims it
await a.mouse.click(target.sx, target.sy);
await a.waitForTimeout(500);
if (!(await a.locator('.claim-card').count())) {
  await a.screenshot({ path: '/tmp/nullius-ledgercheck-nocard.png' });
  console.log('FAIL: click did not open the claim card'); process.exit(1);
}
const NAME = `Faro del Relevo ${Date.now() % 1000}`;
await a.fill('.claim-card input[aria-label^="Name"]', NAME);
await a.fill('.claim-card input[aria-label="Your sailor name"]', 'keeper');
await a.click('.claim-card button[type="submit"]');
await a.waitForTimeout(2500);
await a.screenshot({ path: '/tmp/nullius-ledgercheck-a.png' });

// B must see THIS claim arrive over realtime: the toast names it, and
// the counter must step exactly +1 from B's pre-claim count
let saw = false;
for (let i = 0; i < 10; i++) {
  const toast = (await b.locator('.toast').textContent().catch(() => '')) ?? '';
  const l = await line(b);
  if (toast.includes(NAME) && namesOf(l) === namesB0 + 1) { saw = true; break; }
  await b.waitForTimeout(700);
}
console.log(`B saw "${NAME}" live, counter ${namesB0} -> ${namesB0 + 1}:`, saw);
await b.screenshot({ path: '/tmp/nullius-ledgercheck-b.png' });

// B opens the same feature: the card must show it already claimed.
// B's camera may have glided (the guide leans the chart toward a pennant),
// so sail B straight onto the feature through the deep link.
await b.evaluate(([x, y]) => { location.hash = `#${Math.round(x)},${Math.round(y)},1.6`; }, [target.wx, target.wy]);
await b.waitForTimeout(2500);
const camB = camOf(await line(b)) ?? CAM;
await b.mouse.click((target.wx - camB.x) * camB.s + W / 2, (target.wy - camB.y) * camB.s + H / 2);
await b.waitForTimeout(600);
const cardText = (await b.locator('.claim-card').textContent().catch(() => '')) ?? '';
const plaque = await b.locator('.claim-card .claim-plaque').count();
const hasForm = await b.locator('.claim-card input').count();
console.log('B card excerpt:', cardText.replace(/\s+/g, ' ').slice(0, 140));
if (!(cardText.includes(NAME) && cardText.includes('keeper') && plaque > 0 && hasForm === 0)) {
  console.log('FAIL: B card does not show the claim as settled (name/plaque/no-form)');
  process.exit(1);
}

console.log('console errors:', errors.length);
for (const e of errors.slice(0, 5)) console.log('  ', e.slice(0, 160));
await browser.close();
if (!saw || errors.length) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
