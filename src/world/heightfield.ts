import { fbm, ridged } from './noise';

// The world: one integer. Everything else is derived.
export const WORLD_SEED = 0x4e554c; // "NULL" — fixed forever, this IS the world
export const SEA_LEVEL = 0;

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * height(x, y) in arbitrary units. h > SEA_LEVEL is land.
 * Composition: a low-frequency continentality field decides where
 * archipelagos live; ridged noise throws drowned mountain chains up
 * through it; a domain warp bends coastlines so nothing reads as blobs.
 */
export function height(x: number, y: number, seed: number = WORLD_SEED): number {
  // domain warp — bends the whole field so coasts meander
  const wx = x + 260 * fbm(x * 0.0011, y * 0.0011, seed + 11, 3);
  const wy = y + 260 * fbm(x * 0.0011 + 31.7, y * 0.0011 + 17.3, seed + 23, 3);

  // continentality: where do archipelagos live at all
  const c = fbm(wx * 0.0013, wy * 0.0013, seed, 4);

  // drowned ridgelines: chains of islands along crests
  const ridge = ridged(wx * 0.0042, wy * 0.0042, seed + 101, 4);
  const landMask = sstep(-0.12, 0.34, c); // more land where continents swell

  // coastal detail: two frequencies so shorelines nibble, not noodle
  const detail = fbm(wx * 0.019, wy * 0.019, seed + 202, 3);
  const nib = fbm(x * 0.085, y * 0.085, seed + 303, 2);

  return (c - 0.10) * 1.05 + ridge * ridge * landMask * 0.85 + detail * 0.07 + nib * 0.028;
}

/** Water depth in fathoms (positive when submerged). */
export function depthFathoms(x: number, y: number): number {
  return Math.max(0, -height(x, y)) * 55;
}

/** Land elevation in "ells" (arbitrary chart elevation). */
export function elevation(x: number, y: number): number {
  return Math.max(0, height(x, y));
}

/** Terrain gradient — for hillshade and hachure slope. */
export function gradient(x: number, y: number, eps = 1.5): { gx: number; gy: number } {
  return {
    gx: (height(x + eps, y) - height(x - eps, y)) / (2 * eps),
    gy: (height(x, y + eps) - height(x, y - eps)) / (2 * eps),
  };
}
