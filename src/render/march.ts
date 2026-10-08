// Marching squares → closed/open polylines in sample-grid coordinates.
// Deterministic; used for coastlines, bathymetric contours, relief lines.

export type Poly = number[]; // [x0,y0, x1,y1, ...] in grid coords

export function marchingSquares(g: Float32Array, n: number, iso: number): Poly[] {
  type P = [number, number];
  const segs: [P, P][] = [];
  const at = (i: number, j: number) => g[j * n + i];

  const lerpP = (i1: number, j1: number, i2: number, j2: number): P => {
    const a = at(i1, j1);
    const b = at(i2, j2);
    const t = a === b ? 0.5 : (iso - a) / (b - a);
    return [i1 + (i2 - i1) * t, j1 + (j2 - j1) * t];
  };

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v01 = at(i, j + 1);
      const v11 = at(i + 1, j + 1);
      let idx = 0;
      if (v00 > iso) idx |= 8;
      if (v10 > iso) idx |= 4;
      if (v11 > iso) idx |= 2;
      if (v01 > iso) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      // edges: t=top (i,j)-(i+1,j), r=right, b=bottom, l=left
      const T = lerpP(i, j, i + 1, j);
      const R = lerpP(i + 1, j, i + 1, j + 1);
      const B = lerpP(i, j + 1, i + 1, j + 1);
      const L = lerpP(i, j, i, j + 1);

      switch (idx) {
        case 1: segs.push([L, B]); break;
        case 2: segs.push([B, R]); break;
        case 3: segs.push([L, R]); break;
        case 4: segs.push([T, R]); break;
        case 5: segs.push([L, T]); segs.push([B, R]); break;
        case 6: segs.push([T, B]); break;
        case 7: segs.push([L, T]); break;
        case 8: segs.push([T, L]); break;
        case 9: segs.push([T, B]); break;
        case 10: segs.push([T, R]); segs.push([B, L]); break;
        case 11: segs.push([T, R]); break;
        case 12: segs.push([R, L]); break;
        case 13: segs.push([R, B]); break;
        case 14: segs.push([B, L]); break;
      }
    }
  }

  // join segments into polylines by endpoint proximity
  const key = (p: P) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const arr = byEnd.get(k);
      if (arr) arr.push(i);
      else byEnd.set(k, [i]);
    }
  });

  const used = new Uint8Array(segs.length);
  const polys: Poly[] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const poly: number[] = [segs[s][0][0], segs[s][0][1], segs[s][1][0], segs[s][1][1]];
    // extend forward
    for (;;) {
      const tail: P = [poly[poly.length - 2], poly[poly.length - 1]];
      const cands = byEnd.get(key(tail));
      let next = -1;
      if (cands) for (const ci of cands) if (!used[ci]) { next = ci; break; }
      if (next === -1) break;
      used[next] = 1;
      const [a, b] = segs[next];
      const other = key(a) === key(tail) ? b : a;
      poly.push(other[0], other[1]);
    }
    // extend backward
    for (;;) {
      const head: P = [poly[0], poly[1]];
      const cands = byEnd.get(key(head));
      let next = -1;
      if (cands) for (const ci of cands) if (!used[ci]) { next = ci; break; }
      if (next === -1) break;
      used[next] = 1;
      const [a, b] = segs[next];
      const other = key(a) === key(head) ? b : a;
      poly.unshift(other[0], other[1]);
    }
    polys.push(poly);
  }
  return polys;
}
