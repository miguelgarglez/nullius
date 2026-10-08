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

  // Pinned values. A terrain or feature-id change would silently orphan
  // every name in the ledger, so these must fail loudly, not drift.
  it('the terrain is pinned to its shipped values', () => {
    expect(height(0, 0)).toBeCloseTo(-0.37880891144447004, 12);
    expect(height(1000, -500)).toBeCloseTo(-0.0005830935891423718, 12);
    expect(height(-3000, 2000)).toBeCloseTo(-0.17512087568215112, 12);
    expect(height(77777, -12345)).toBeCloseTo(-0.4393474743066323, 12);
  });

  it('feature ids and positions are pinned', () => {
    const sig = (cx: number, cy: number) =>
      regionFeatures(cx, cy)
        .map((f) => `${f.id}:${f.kind}:${f.x.toFixed(2)},${f.y.toFixed(2)}`)
        .join(' ');
    expect(sig(-1, 0)).toBe(
      'n--1.0.island.0:island:-903.41,690.59 n--1.0.bay.3:bay:-540.91,254.55 n--1.0.cape.4:cape:-286.36,31.82 n--1.0.peak.0:peak:-1400.00,95.45 n--1.0.lagoon.2:lagoon:-1320.45,1209.09',
    );
    expect(sig(3, -2)).toBe(
      'n-3.-2.island.0:island:4644.75,-1988.85 n-3.-2.bay.6:bay:4581.82,-1718.18 n-3.-2.cape.7:cape:4645.45,-1654.55 n-3.-2.bay.8:bay:4963.64,-2322.73 n-3.-2.cape.9:cape:4931.82,-2704.55 n-3.-2.peak.0:peak:4645.45,-1972.73 n-3.-2.island.1:island:4988.09,-2431.00 n-3.-2.peak.1:peak:4836.36,-2418.18 n-3.-2.rock.2:rock:5409.09,-2290.91 n-3.-2.rock.3:rock:4804.55,-2259.09',
    );
  });
});
