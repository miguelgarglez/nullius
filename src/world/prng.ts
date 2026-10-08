// Deterministic integer-hash PRNG. Arithmetic only (Math.imul, bit ops,
// Math.floor) so every JS engine computes identical values.

/** Hash two integer coords + seed into a uint32. splitmix/xxh-flavoured. */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ (seed | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** hash2 mapped to [0, 1). */
export function hash2f(ix: number, iy: number, seed: number): number {
  return hash2(ix, iy, seed) / 4294967296;
}

/** Hash a single integer to [0, 1). */
export function hash1f(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ (seed | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** mulberry32 stream for non-lattice randomness. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
