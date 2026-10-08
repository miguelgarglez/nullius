import { hash2f } from './prng';

// Seeded 2D value noise + fBm + ridged + domain warp.
// Pure arithmetic (floor, imul via prng) → identical results in every engine.

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1] at continuous coords. */
export function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = quintic(fx);
  const uy = quintic(fy);
  const a = hash2f(ix, iy, seed);
  const b = hash2f(ix + 1, iy, seed);
  const c = hash2f(ix, iy + 1, seed);
  const d = hash2f(ix + 1, iy + 1, seed);
  const v = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  return v * 2 - 1;
}

/** Fractal Brownian motion, ~[-1, 1]. */
export function fbm(x: number, y: number, seed: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(fx, fy, seed + i * 1013);
    norm += amp;
    fx *= lacunarity;
    fy *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1] — sharp crests, good for island chains. */
export function ridged(x: number, y: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(fx, fy, seed + 733 + i * 397));
    sum += amp * n * n;
    norm += amp;
    fx *= lacunarity;
    fy *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}
