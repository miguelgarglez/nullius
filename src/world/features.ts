import { height, SEA_LEVEL } from './heightfield';

// Deterministic POI extraction. The terrain itself decides what is nameable;
// the same cell always yields the same features, so a feature_id is a
// function of the world seed — a claim only stores the name.

export type FeatureKind = 'island' | 'peak' | 'bay' | 'cape' | 'lagoon' | 'rock';

export interface Feature {
  /** stable id: w<seed36>-<cx>.<cy>.<kind>.<rank> */
  id: string;
  kind: FeatureKind;
  x: number;
  y: number;
  /** 0..1 importance — drives label size and which feature in a cell leads. */
  prominence: number;
}

/** Region cell size in world units. Features are extracted per cell. */
export const REGION = 1400;
const SAMPLES = 44; // grid samples per side inside the cell

interface Cell {
  x0: number;
  y0: number;
  step: number;
  g: Float32Array; // (S+2)x(S+2) with 1-sample halo
}

const cellCache = new Map<string, Feature[]>();
const MAX_CACHE = 256;

function sampleCell(cx: number, cy: number): Cell {
  const x0 = cx * REGION;
  const y0 = cy * REGION;
  const step = REGION / SAMPLES;
  const N = SAMPLES + 2;
  const g = new Float32Array(N * N);
  for (let j = -1; j <= SAMPLES; j++) {
    for (let i = -1; i <= SAMPLES; i++) {
      g[(j + 1) * N + i + 1] = height(x0 + i * step, y0 + j * step);
    }
  }
  return { x0, y0, step, g };
}

export function regionFeatures(cx: number, cy: number): Feature[] {
  const key = `${cx},${cy}`;
  const hit = cellCache.get(key);
  if (hit) return hit;

  const { x0, y0, step, g } = sampleCell(cx, cy);
  const N = SAMPLES + 2;
  const at = (i: number, j: number) => g[(j + 1) * N + i + 1];
  const feats: Feature[] = [];
  const seen = new Set<number>();

  // --- connected components of land (4-neighbour) ---------------------
  const label = new Int32Array(N * N).fill(-1);
  let nLab = 0;
  const sizes: number[] = [];
  const sumX: number[] = [];
  const sumY: number[] = [];
  const peakI: number[] = [];
  const peakH: number[] = [];

  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) {
      const idx = (j + 1) * N + i + 1;
      if (g[idx] <= SEA_LEVEL || label[idx] !== -1) continue;
      // flood
      const stack = [idx];
      label[idx] = nLab;
      let size = 0;
      let sx = 0;
      let sy = 0;
      let pi = idx;
      let ph = -1e9;
      while (stack.length) {
        const cur = stack.pop()!;
        size++;
        const cj = Math.floor(cur / N) - 1;
        const ci = (cur % N) - 1;
        sx += ci;
        sy += cj;
        if (g[cur] > ph) {
          ph = g[cur];
          pi = cur;
        }
        for (const nb of [cur - 1, cur + 1, cur - N, cur + N]) {
          const nj = Math.floor(nb / N) - 1;
          const ni = (nb % N) - 1;
          if (ni < 0 || ni >= SAMPLES || nj < 0 || nj >= SAMPLES) continue;
          if (g[nb] > SEA_LEVEL && label[nb] === -1) {
            label[nb] = nLab;
            stack.push(nb);
          }
        }
      }
      sizes.push(size);
      sumX.push(sx);
      sumY.push(sy);
      peakI.push(pi);
      peakH.push(ph);
      nLab++;
    }
  }

  const toWorld = (i: number, j: number) => ({ x: x0 + i * step, y: y0 + j * step });
  const mkId = (kind: FeatureKind, n: number) => `n-${cx}.${cy}.${kind}.${n}`;

  // --- islands, rocks, peaks ------------------------------------------
  let islandRank = 0;
  const boundaryPts = new Map<number, { i: number; j: number }[]>(); // label → ring pts
  for (let L = 0; L < nLab; L++) {
    const area = sizes[L] * step * step;
    if (area < REGION * REGION * 0.0004) continue; // specks are not features
    const isRock = area < REGION * REGION * 0.006;
    const cxi = sumX[L] / sizes[L];
    const cyi = sumY[L] / sizes[L];
    const cw = toWorld(cxi, cyi);
    const prom = Math.min(1, area / (REGION * REGION * 0.12));
    feats.push({
      id: mkId(isRock ? 'rock' : 'island', islandRank),
      kind: isRock ? 'rock' : 'island',
      x: cw.x,
      y: cw.y,
      prominence: prom,
    });

    if (!isRock) {
      const pi = peakI[L];
      const pj = Math.floor(pi / N) - 1;
      const pi2 = (pi % N) - 1;
      const pw = toWorld(pi2, pj);
      feats.push({
        id: mkId('peak', islandRank),
        kind: 'peak',
        x: pw.x,
        y: pw.y,
        prominence: Math.min(1, peakH[L] / 0.8) * 0.7,
      });
    }

    // boundary ring for bay/cape analysis
    const ring: { i: number; j: number }[] = [];
    for (let j = 0; j < SAMPLES; j++) {
      for (let i = 0; i < SAMPLES; i++) {
        const idx = (j + 1) * N + i + 1;
        if (label[idx] !== L) continue;
        if (
          at(i - 1, j) <= SEA_LEVEL ||
          at(i + 1, j) <= SEA_LEVEL ||
          at(i, j - 1) <= SEA_LEVEL ||
          at(i, j + 1) <= SEA_LEVEL
        ) {
          ring.push({ i, j });
        }
      }
    }
    boundaryPts.set(L, ring);
    islandRank++;
  }

  // --- lagoons: water pockets enclosed inside an island ---------------
  // water sample is "open" if it reaches the cell edge by 4-conn; else lagoon
  const open = new Uint8Array(N * N);
  const q: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (const j of [0, SAMPLES - 1]) {
      const idx = (j + 1) * N + i + 1;
      if (g[idx] <= SEA_LEVEL && !open[idx]) {
        open[idx] = 1;
        q.push(idx);
      }
    }
  }
  for (let j = 0; j < SAMPLES; j++) {
    for (const i of [0, SAMPLES - 1]) {
      const idx = (j + 1) * N + i + 1;
      if (g[idx] <= SEA_LEVEL && !open[idx]) {
        open[idx] = 1;
        q.push(idx);
      }
    }
  }
  while (q.length) {
    const cur = q.pop()!;
    for (const nb of [cur - 1, cur + 1, cur - N, cur + N]) {
      const nj = Math.floor(nb / N) - 1;
      const ni = (nb % N) - 1;
      if (ni < 0 || ni >= SAMPLES || nj < 0 || nj >= SAMPLES) continue;
      if (g[nb] <= SEA_LEVEL && !open[nb]) {
        open[nb] = 1;
        q.push(nb);
      }
    }
  }
  const lagoonSeen = new Uint8Array(N * N);
  for (let j = 1; j < SAMPLES - 1; j++) {
    for (let i = 1; i < SAMPLES - 1; i++) {
      const idx = (j + 1) * N + i + 1;
      if (g[idx] <= SEA_LEVEL && !open[idx] && !lagoonSeen[idx]) {
        // measure pocket
        const st = [idx];
        lagoonSeen[idx] = 1;
        let size = 0;
        let sx = 0;
        let sy = 0;
        while (st.length) {
          const cur = st.pop()!;
          size++;
          const cj = Math.floor(cur / N) - 1;
          const ci = (cur % N) - 1;
          sx += ci;
          sy += cj;
          for (const nb of [cur - 1, cur + 1, cur - N, cur + N]) {
            const nj = Math.floor(nb / N) - 1;
            const ni = (nb % N) - 1;
            if (ni < 0 || ni >= SAMPLES || nj < 0 || nj >= SAMPLES) continue;
            if (g[nb] <= SEA_LEVEL && !open[nb] && !lagoonSeen[nb]) {
              lagoonSeen[nb] = 1;
              st.push(nb);
            }
          }
        }
        const area = size * step * step;
        if (area > REGION * REGION * 0.0015 && area < REGION * REGION * 0.08) {
          const w = toWorld(sx / size, sy / size);
          const id = mkId('lagoon', feats.length);
          if (!seen.has(idx)) {
            feats.push({ id, kind: 'lagoon', x: w.x, y: w.y, prominence: 0.6 });
            seen.add(idx);
          }
        }
      }
    }
  }

  // --- bays & capes: curvature extremes on each boundary ring ---------
  // Winding order is arbitrary per ring, so curvature sign alone can't
  // tell bay from cape. Instead score by |turn| over a window, then
  // classify geometrically: a bay vertex dips *toward* the island
  // centroid relative to its chord; a cape protrudes *away*.
  for (const [L, ring] of boundaryPts) {
    if (ring.length < 24) continue;
    const ordered = orderRing(ring);
    if (ordered.length < 24) continue;
    const curv = signedCurvature(ordered, step);
    const centI = sumX[L] / sizes[L];
    const centJ = sumY[L] / sizes[L];
    let bestBay = { score: 0, i: 0 };
    let bestCape = { score: 0, i: 0 };
    for (let i = 0; i < ordered.length; i++) {
      const W = Math.max(6, Math.floor(ordered.length * 0.12));
      let acc = 0;
      for (let k = -W >> 1; k <= W >> 1; k++) {
        acc += Math.abs(curv[(i + k + ordered.length) % ordered.length]);
      }
      const p = ordered[i];
      const a = ordered[(i - W + ordered.length) % ordered.length];
      const b = ordered[(i + W) % ordered.length];
      const chordI = (a.i + b.i) / 2;
      const chordJ = (a.j + b.j) / 2;
      const dP = Math.hypot(p.i - centI, p.j - centJ);
      const dChord = Math.hypot(chordI - centI, chordJ - centJ);
      const concavity = dChord - dP; // >0 dips inward = bay; <0 protrudes = cape
      if (acc > bestBay.score && concavity > SAMPLES * 0.02) bestBay = { score: acc, i };
      if (acc > bestCape.score && concavity < -SAMPLES * 0.02) bestCape = { score: acc, i };
    }
    const mkFeature = (b: { score: number; i: number }, kind: FeatureKind) => {
      const p = ordered[b.i];
      const w = toWorld(p.i, p.j);
      const prom = Math.min(1, b.score / 2.4);
      if (prom > 0.5) {
        feats.push({ id: mkId(kind, feats.length), kind, x: w.x, y: w.y, prominence: prom * 0.75 });
      }
    };
    mkFeature(bestBay, 'bay');
    mkFeature(bestCape, 'cape');
  }

  feats.sort((a, b) => b.prominence - a.prominence);
  if (cellCache.size > MAX_CACHE) {
    const first = cellCache.keys().next().value!;
    cellCache.delete(first);
  }
  cellCache.set(key, feats);
  return feats;
}

/** Nearest-neighbour ordering of boundary samples into a loop. */
function orderRing(pts: { i: number; j: number }[]): { i: number; j: number }[] {
  const used = new Uint8Array(pts.length);
  const out = [pts[0]];
  used[0] = 1;
  for (let n = 1; n < pts.length; n++) {
    const last = out[out.length - 1];
    let best = -1;
    let bd = 1e9;
    for (let k = 0; k < pts.length; k++) {
      if (used[k]) continue;
      const d = (pts[k].i - last.i) ** 2 + (pts[k].j - last.j) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best === -1 || bd > 8) break; // ring broke — keep what we have
    used[best] = 1;
    out.push(pts[best]);
  }
  return out;
}

/** Signed turning angle per ring vertex (windowed). Positive = convex. */
function signedCurvature(ring: { i: number; j: number }[], step: number): Float32Array {
  const n = ring.length;
  const out = new Float32Array(n);
  const K = 2; // neighbours each side
  for (let i = 0; i < n; i++) {
    const a = ring[(i - K + n) % n];
    const b = ring[i];
    const c = ring[(i + K) % n];
    const v1x = (b.i - a.i) * step;
    const v1y = (b.j - a.j) * step;
    const v2x = (c.i - b.i) * step;
    const v2y = (c.j - b.j) * step;
    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    out[i] = Math.atan2(cross, dot); // signed turning angle
  }
  return out;
}

/** Where the expedition begins: the busiest archipelago cell near origin. */
export function findHarbor(): { x: number; y: number } {
  let best = { x: 0, y: 0 };
  let bestScore = -1;
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      const fs = regionFeatures(cx, cy);
      const score = fs.reduce((acc, f) => acc + (f.kind === 'island' ? 3 : f.prominence), 0);
      // prefer nearer cells on ties so the harbour isn't a long voyage
      const d = Math.hypot(cx, cy) * 0.5;
      if (score - d > bestScore) {
        bestScore = score - d;
        best = { x: (cx + 0.5) * REGION, y: (cy + 0.5) * REGION };
      }
    }
  }
  return best;
}

/** All features whose region intersects a world-space bbox. */
export function featuresInBox(x0: number, y0: number, x1: number, y1: number): Feature[] {
  const cx0 = Math.floor(x0 / REGION);
  const cy0 = Math.floor(y0 / REGION);
  const cx1 = Math.floor(x1 / REGION);
  const cy1 = Math.floor(y1 / REGION);
  const out: Feature[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (const f of regionFeatures(cx, cy)) {
        if (f.x >= x0 - 60 && f.x <= x1 + 60 && f.y >= y0 - 60 && f.y <= y1 + 60) out.push(f);
      }
    }
  }
  return out;
}
