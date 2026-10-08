import { height, gradient } from '../world/heightfield';
import { hash2f } from '../world/prng';
import { marchingSquares, type Poly } from './march';

// Engraved-chart tile renderer. A tile = 256px canvas covering a world rect
// that shrinks with LOD. Per-pixel banding at low res gives soft water and
// relief; marching-squares contours give the crisp ink work on top.

export const TILE_PX = 256;
export const UPP0 = 1.7; // world units per px at lod 0

export function unitsPerPx(lod: number): number {
  return UPP0 * Math.pow(2, -lod);
}
export function tileWorld(lod: number): number {
  return TILE_PX * unitsPerPx(lod);
}

const PAPER = '#efe7d0';
const LAND = '#f2ebd8';
const LAND_SHADE = '#e7dcbd';
const INK = '#26333d';
const INK_SOFT = '#5d6d75';
const W_DEEP = '#d6dccb';

const W_SHALLOW = '#eae6d5';


const N = 110; // samples per tile side
const M = 2; // halo cells so contours close past the edge

/** one reusable grain texture, generated once */
let grainCanvas: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const n =
        hash2f(i, j, 777) * 0.6 +
        hash2f(i >> 2, j >> 2, 778) * 0.3 +
        hash2f(i >> 4, j >> 4, 779) * 0.1;
      const v = 190 + Math.floor(n * 60); // 190..250, paper fibre
      const o = (j * 256 + i) * 4;
      img.data[o] = v;
      img.data[o + 1] = v - 6;
      img.data[o + 2] = v - 20;
      img.data[o + 3] = 26;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

function polyToPath(ctx: CanvasRenderingContext2D, poly: Poly, sc: number, ox: number, oy: number, close: boolean) {
  ctx.moveTo(poly[0] * sc + ox, poly[1] * sc + oy);
  for (let i = 2; i < poly.length; i += 2) {
    ctx.lineTo(poly[i] * sc + ox, poly[i + 1] * sc + oy);
  }
  if (close) ctx.closePath();
}

export function renderTile(lod: number, tx: number, ty: number): HTMLCanvasElement {
  const size = TILE_PX;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d')!;

  const upp = unitsPerPx(lod);
  const x0 = tx * size * upp;
  const y0 = ty * size * upp;
  const cellW = (size * upp) / N;
  const G = N + M * 2;

  // -- sample the field ------------------------------------------------
  const g = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      g[j * G + i] = height(x0 + (i - M) * cellW, y0 + (j - M) * cellW);
    }
  }

  // grid coord → px: sample i sits at world (i-M)*cellW → px (i-M)*size/N
  const sc = size / N;
  const ox = -M * sc;
  const oy = -M * sc;

  // -- base paper ------------------------------------------------------
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);

  // -- per-sample banding → soft water wash + land relief ---------------
  const band = document.createElement('canvas');
  band.width = band.height = G;
  const bctx = band.getContext('2d')!;
  const img = bctx.createImageData(G, G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const h = g[j * G + i];
      const wx = x0 + (i - M) * cellW;
      const wy = y0 + (j - M) * cellW;
      let r: number, gg: number, b: number;
      if (h > 0) {
        // land: vellum deepening with elevation + NW hillshade
        const gr = gradient(wx, wy, cellW);
        const shade = Math.max(-0.6, Math.min(0.6, -(gr.gx * 0.7 - gr.gy * 0.4) * 4.5));
        const e = Math.min(1, h / 1.1);
        const base = h > 0.5 ? LAND_SHADE : LAND;
        const m = parseInt(base.slice(1), 16);
        r = (m >> 16) & 255;
        gg = (m >> 8) & 255;
        b = m & 255;
        const dk = 1 - e * 0.09 + shade * 0.16;
        r *= dk;
        gg *= dk;
        b *= dk;
      } else {
        // water: continuous wash deep->shallow, then faint mottle
        const d = Math.min(1, -h / 0.6);
        const t = d * d * (3 - 2 * d);
        const mS = parseInt(W_SHALLOW.slice(1), 16);
        const mD = parseInt(W_DEEP.slice(1), 16);
        r = ((mS >> 16) & 255) + (((mD >> 16) & 255) - ((mS >> 16) & 255)) * t;
        gg = ((mS >> 8) & 255) + (((mD >> 8) & 255) - ((mS >> 8) & 255)) * t;
        b = (mS & 255) + ((mD & 255) - (mS & 255)) * t;
        // faint mottle so open water isn't flat
        const mot = 1 + (hash2f(i, j, 881) - 0.5) * 0.025;
        r *= mot;
        gg *= mot;
        b *= mot;
      }
      const o = (j * G + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(band, M, M, G - 2 * M, G - 2 * M, 0, 0, size, size);

  // -- contours ---------------------------------------------------------
  const polysAt = (iso: number) => marchingSquares(g, G, iso);
  const coast = polysAt(0);
  const shelf = polysAt(-0.16);
  const deep = polysAt(-0.42);
  const reliefA = polysAt(0.30);
  const reliefB = polysAt(0.58);

  // ocean-side coast glow (HDA wide-pen banding) — narrow, stepped
  const glowWidths = [6.5, 3.4, 1.7];
  const glowAlpha = [0.5, 0.65, 0.85];
  for (let k = 0; k < glowWidths.length; k++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(247,240,220,${glowAlpha[k]})`;
    ctx.lineWidth = glowWidths[k];
    ctx.lineJoin = 'round';
    for (const p of coast) polyToPath(ctx, p, sc, ox, oy, false);
    ctx.stroke();
  }

  // bathymetric contour lines (engraved)
  ctx.strokeStyle = 'rgba(78,126,116,0.6)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const p of shelf) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(78,126,116,0.45)';
  ctx.beginPath();
  for (const p of deep) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();

  // land relief contours + hill hachures (ticks pointing downhill)
  ctx.strokeStyle = 'rgba(93,109,117,0.45)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (const p of reliefA) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(93,109,117,0.6)';
  ctx.beginPath();
  for (const p of reliefB) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();

  // -- hachures: fine ticks inland of the coast -------------------------
  ctx.strokeStyle = 'rgba(38,51,61,0.55)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  const HSTEP = 5; // every Nth poly point
  const TICK = 5.2;
  for (const p of coast) {
    for (let i = 0; i < p.length - 3; i += 2 * HSTEP) {
      const px = p[i] * sc + ox;
      const py = p[i + 1] * sc + oy;
      const nx = p[i + 2] * sc + ox;
      const ny = p[i + 3] * sc + oy;
      let dx = nx - px;
      let dy = ny - py;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // normal candidates; pick the one pointing uphill (into land)
      const wx = x0 + (px / size) * size * upp;
      const wy = y0 + (py / size) * size * upp;
      const probe = 6 * upp;
      const hPlus = height(wx - dy * probe, wy + dx * probe);
      const hMinus = height(wx + dy * probe, wy - dx * probe);
      const s = hPlus > hMinus ? 1 : -1;
      ctx.moveTo(px, py);
      ctx.lineTo(px - dy * s * TICK, py + dx * s * TICK);
    }
  }
  ctx.stroke();

  // hill hachures: ticks marching downhill off the relief contours
  ctx.strokeStyle = 'rgba(38,51,61,0.4)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (const p of [...reliefB, ...reliefA]) {
    for (let i = 0; i < p.length - 3; i += 2 * 9) {
      const px = p[i] * sc + ox;
      const py = p[i + 1] * sc + oy;
      const wx = x0 + (px / size) * size * upp;
      const wy = y0 + (py / size) * size * upp;
      const gr = gradient(wx, wy, cellW * 2);
      const gl = Math.hypot(gr.gx, gr.gy);
      if (gl < 0.0006) continue;
      const gx = gr.gx / gl;
      const gy = gr.gy / gl;
      ctx.moveTo(px, py);
      ctx.lineTo(px + gx * 4.6, py + gy * 4.6);
    }
  }
  ctx.stroke();

  // -- the coastline itself: double-struck ink ---------------------------
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.15;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const p of coast) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(38,51,61,0.35)';
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  for (const p of coast) polyToPath(ctx, p, sc, ox, oy, false);
  ctx.stroke();

  // -- soundings: the sea is made of data --------------------------------
  const spacing = 105; // world units between sounding sites
  ctx.fillStyle = INK_SOFT;
  ctx.font = `italic ${Math.max(7, 9 / Math.pow(upp / UPP0, 1))}px "EB Garamond", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sx0 = Math.floor(x0 / spacing) - 1;
  const sy0 = Math.floor(y0 / spacing) - 1;
  const sx1 = Math.floor((x0 + size * upp) / spacing) + 1;
  const sy1 = Math.floor((y0 + size * upp) / spacing) + 1;
  for (let j = sy0; j <= sy1; j++) {
    for (let i = sx0; i <= sx1; i++) {
      const u = hash2f(i, j, 911);
      if (u > 0.42) continue;
      const jx = (hash2f(i, j, 912) - 0.5) * spacing * 0.7;
      const jy = (hash2f(i, j, 913) - 0.5) * spacing * 0.7;
      const wx = i * spacing + jx;
      const wy = j * spacing + jy;
      const h = height(wx, wy);
      if (h >= -0.05) continue;
      const fathoms = Math.max(1, Math.round(-h * 55));
      ctx.fillText(String(fathoms), (wx - x0) / upp, (wy - y0) / upp);
    }
  }

  // (rhumb lines are drawn once per frame in the overlay pass — see world.ts)

  // -- sea monsters, rarely ----------------------------------------------
  const mcx0 = Math.floor(x0 / REGION_M());
  const mcy0 = Math.floor(y0 / REGION_M());
  const mcx1 = Math.floor((x0 + size * upp) / REGION_M());
  const mcy1 = Math.floor((y0 + size * upp) / REGION_M());
  for (let j = mcy0; j <= mcy1; j++) {
    for (let i = mcx0; i <= mcx1; i++) {
      const u = hash2f(i, j, 4242);
      if (u > 0.05) continue;
      const wx = (i + hash2f(i, j, 4243)) * REGION_M();
      const wy = (j + hash2f(i, j, 4244)) * REGION_M();
      if (height(wx, wy) > -0.3) continue; // monsters keep to deep water
      drawSerpent(ctx, (wx - x0) / upp, (wy - y0) / upp, 1 / upp);
    }
  }

  // -- paper grain over everything ----------------------------------------
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(grain(), 0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  return cvs;
}

function REGION_M() {
  return 2800;
}

/** tiny engraved sea serpent: two humps + a head */
function drawSerpent(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const sc = Math.min(1.4, Math.max(0.7, s * 0.5));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.strokeStyle = 'rgba(38,51,61,0.75)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.bezierCurveTo(-10, -9, -6, -9, -3, 0);
  ctx.bezierCurveTo(0, 7, 4, 7, 6, 0);
  ctx.bezierCurveTo(8, -6, 11, -6, 12, -2);
  ctx.stroke();
  ctx.beginPath(); // head dot + neck
  ctx.moveTo(12, -2);
  ctx.lineTo(14, -8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(14.5, -9, 1.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(38,51,61,0.75)';
  ctx.fill();
  ctx.restore();
}
