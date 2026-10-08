import { describe, it, expect } from 'vitest';
import { height } from './heightfield';
import { regionFeatures } from './features';

// The world is a pure function of the seed. These tests prove identical
// results across evaluations — the property every claim depends on.

describe('determinism', () => {
  it('height() is a pure function', () => {
    for (const [x, y] of [[0, 0], [123.45, -987.65], [1e6, 1e6], [-42.7, 3000.1]]) {
      expect(height(x, y)).toBe(height(x, y));
    }
  });

  it('the world has both land and sea nearby spawn', () => {
    let land = 0;
    let sea = 0;
    for (let j = -30; j <= 30; j++) {
      for (let i = -30; i <= 30; i++) {
        if (height(i * 100, j * 100) > 0) land++;
        else sea++;
      }
    }
    expect(sea).toBeGreaterThan(land); // mostly ocean — this is a sailing chart
    expect(land).toBeGreaterThan(0); // but land exists
  });

  it('region features are deterministic and id-stable', () => {
    const a = regionFeatures(0, 0);
    const b = regionFeatures(0, 0);
    expect(a).toEqual(b);
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it('features exist within a few thousand units of spawn', () => {
    let total = 0;
    for (let cy = -3; cy <= 3; cy++) {
      for (let cx = -3; cx <= 3; cx++) {
        total += regionFeatures(cx, cy).length;
      }
    }
    expect(total).toBeGreaterThan(10);
  });

  it('different regions give different features', () => {
    const a = regionFeatures(0, 0).map((f) => f.id);
    const b = regionFeatures(7, -4).map((f) => f.id);
    expect(a).not.toEqual(b);
  });
});
