import { UPP0, tileWorld, renderTile } from '../render/chart';
import { clampScale, type Camera } from './camera';
import { featuresInBox, type Feature } from '../world/features';
import { hash2f } from '../world/prng';

// The world view: canvas render loop + input. React never re-renders for
// camera moves; the imperative engine owns the chart.

const MAX_LOD = 5;
const MIN_LOD = -2; // coarse tiles for the long zoom-out
const TILE_BUDGET_PER_FRAME = 2;
const TILE_CACHE_CAP = 900;

export interface ClaimLike {
  name: string;
  sailor: string;
}

export interface ShipLike {
  x: number;
  y: number;
  sailor: string;
}

export class WorldView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0, scale: 0.9 };
  private vel = { x: 0, y: 0 };
  private tiles = new Map<string, HTMLCanvasElement>();
  private queue: { lod: number; tx: number; ty: number }[] = [];
  private inQueue = new Set<string>();
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private dragMoved = 0;
  private features: Feature[] = [];
  private claims = new Map<string, ClaimLike>();
  private claimBirth = new Map<string, number>();
  private ships: ShipLike[] = [];
  private onFeatures: (fs: Feature[]) => void;
  private onTap: ((wx: number, wy: number) => void) | null = null;
  private reduced = false;
  private ro: ResizeObserver | null = null;
  private listeners: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, onFeatures: (fs: Feature[]) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onFeatures = onFeatures;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bind();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const rm of this.listeners) rm();
    this.listeners = [];
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  private listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  private listen(
    target: HTMLElement | Window,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions | boolean,
  ) {
    const l = fn as EventListener;
    target.addEventListener(type, l, opts);
    this.listeners.push(() => target.removeEventListener(type, l, opts));
  }

  setClaims(map: Map<string, ClaimLike>) {
    // diff so fresh names can ink themselves in
    for (const k of map.keys()) {
      if (!this.claims.has(k)) this.claimBirth.set(k, performance.now());
    }
    this.claims = map;
  }
  setShips(ships: ShipLike[]) {
    this.ships = ships;
  }
  setOnTap(fn: (wx: number, wy: number) => void) {
    this.onTap = fn;
  }

  get camera(): Camera {
    return this.cam;
  }

  /** screen px → world */
  toWorld(sx: number, sy: number) {
    return {
      x: this.cam.x + (sx - this.canvas.clientWidth / 2) / this.cam.scale,
      y: this.cam.y + (sy - this.canvas.clientHeight / 2) / this.cam.scale,
    };
  }
  toScreen(wx: number, wy: number) {
    return {
      x: (wx - this.cam.x) * this.cam.scale + this.canvas.clientWidth / 2,
      y: (wy - this.cam.y) * this.cam.scale + this.canvas.clientHeight / 2,
    };
  }

  flyTo(wx: number, wy: number, scale?: number) {
    this.cam.x = wx;
    this.cam.y = wy;
    if (scale !== undefined) this.cam.scale = clampScale(scale);
  }

  private resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private bind() {
    const el = this.canvas;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);

    this.listen(el, 'pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.vel.x = this.vel.y = 0;
      this.dragMoved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    this.listen(el, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.lastPinch > 0) {
          const rect = el.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - rect.left;
          const my = (a.y + b.y) / 2 - rect.top;
          this.zoomTo(mx, my, d / this.lastPinch);
        }
        this.lastPinch = d;
      } else {
        // drag the sea: world follows the finger
        this.cam.x -= dx / this.cam.scale;
        this.cam.y -= dy / this.cam.scale;
        this.vel.x = -dx / this.cam.scale;
        this.vel.y = -dy / this.cam.scale;
      }
    });

    const up = (e: PointerEvent) => {
      const had = this.pointers.delete(e.pointerId);
      this.lastPinch = 0;
      if (had && this.pointers.size === 0 && this.dragMoved < 6 && this.onTap) {
        const rect = el.getBoundingClientRect();
        const w = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.onTap(w.x, w.y);
      }
    };
    this.listen(el, 'pointerup', up);
    this.listen(el, 'pointercancel', up);

    this.listen(
      el,
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          this.zoomTo(mx, my, Math.exp(-e.deltaY * 0.0016));
        } else {
          this.cam.x -= e.deltaX / this.cam.scale;
          this.cam.y -= e.deltaY / this.cam.scale;
          this.vel.x = -e.deltaX / this.cam.scale;
          this.vel.y = -e.deltaY / this.cam.scale;
        }
      },
      { passive: false },
    );

    this.listen(window, 'keydown', (e) => {
      // don't hijack typing in inputs or dialogs
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, [contenteditable], .intro-scrim'))) return;
      const step = 60 / this.cam.scale;
      if (e.key === 'ArrowLeft') this.cam.x -= step;
      if (e.key === 'ArrowRight') this.cam.x += step;
      if (e.key === 'ArrowUp') this.cam.y -= step;
      if (e.key === 'ArrowDown') this.cam.y += step;
      if (e.key === '+' || e.key === '=') this.zoomTo(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 1.2);
      if (e.key === '-') this.zoomTo(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 0.83);
    });
  }

  private zoomTo(mx: number, my: number, factor: number) {
    const before = this.toWorld(mx, my);
    this.cam.scale = clampScale(this.cam.scale * factor);
    const after = this.toWorld(mx, my);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const { cam, vel } = this;

    // inertia when released
    if (this.pointers.size === 0) {
      cam.x += vel.x;
      cam.y += vel.y;
      const damp = this.reduced ? 0.82 : 0.94;
      vel.x *= damp;
      vel.y *= damp;
      if (Math.abs(vel.x) + Math.abs(vel.y) < 0.001) {
        vel.x = vel.y = 0;
      }
    }

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // world-space transform
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    const vx0 = cam.x - w / 2 / cam.scale;
    const vy0 = cam.y - h / 2 / cam.scale;
    const vx1 = cam.x + w / 2 / cam.scale;
    const vy1 = cam.y + h / 2 / cam.scale;

    // pick lod: want ~ tile world ≈ 256px * (1/scale) → upp ≈ 1/scale
    const lod = Math.max(MIN_LOD, Math.min(MAX_LOD, Math.round(Math.log2(UPP0 * cam.scale))));
    const tw = tileWorld(lod);
    const tx0 = Math.floor(vx0 / tw);
    const ty0 = Math.floor(vy0 / tw);
    const tx1 = Math.floor(vx1 / tw);
    const ty1 = Math.floor(vy1 / tw);

    let budget = TILE_BUDGET_PER_FRAME;
    // background for not-yet-drawn area
    ctx.fillStyle = '#ece3cd';
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${lod}:${tx}:${ty}`;
        const t = this.tiles.get(key);
        if (t) {
          ctx.drawImage(t, tx * tw, ty * tw, tw, tw);
          this.tiles.delete(key);
          this.tiles.set(key, t); // touch for LRU
        } else if (budget > 0) {
          budget--;
          const made = renderTile(lod, tx, ty);
          this.tiles.set(key, made);
          ctx.drawImage(made, tx * tw, ty * tw, tw, tw);
        } else {
          // haze: the chart is still being drawn — a feature, not a spinner
          this.drawHaze(ctx, tx * tw, ty * tw, tw, tx, ty);
          if (!this.inQueue.has(key)) {
            this.inQueue.add(key);
            this.queue.push({ lod, tx, ty });
          }
        }
      }
    }

    // work through the queue a little per frame
    let extra = TILE_BUDGET_PER_FRAME;
    while (extra-- > 0 && this.queue.length) {
      const job = this.queue.shift()!;
      const key = `${job.lod}:${job.tx}:${job.ty}`;
      this.inQueue.delete(key);
      if (!this.tiles.has(key)) {
        this.tiles.set(key, renderTile(job.lod, job.tx, job.ty));
      }
    }

    // evict far tiles
    if (this.tiles.size > TILE_CACHE_CAP) {
      let drop = this.tiles.size - TILE_CACHE_CAP;
      for (const k of this.tiles.keys()) {
        this.tiles.delete(k);
        if (--drop <= 0) break;
      }
    }

    // -- rhumb lines: the portolan lattice, once per frame ---------------
    this.drawRhumbs(ctx, vx0, vy0, vx1, vy1);

    // -- labels + pennants (screen-space overlay pass, world coords) -----
    this.features = featuresInBox(vx0, vy0, vx1, vy1);
    this.drawLabels(ctx);
    this.drawShips(ctx);

    ctx.restore();

    // cartographic vignette — haze at the edges of the known chart
    this.drawVignette(ctx, w, h);

    // publish features to React (cheap check to avoid churn)
    this.onFeatures(this.features);
  };

  private drawHaze(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number) {
    ctx.fillStyle = '#ece3cd';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(93,109,117,0.10)';
    for (let i = 0; i < 14; i++) {
      const u = hash2f(tx * 31 + i, ty * 17 + i, 321);
      const v = hash2f(tx * 11 + i, ty * 41 + i, 654);
      ctx.beginPath();
      ctx.arc(x + u * s, y + v * s, s * 0.02 + v * s * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D) {
    const px = (w: number) => w / this.cam.scale; // world units for px size
    for (const f of this.features) {
      const claim = this.claims.get(f.id);
      // uncharted pennants thin out when zoomed far out
      if (!claim && f.prominence < 0.45 && this.cam.scale < 0.7) continue;
      const lx = f.x;
      const ly = f.y;
      ctx.save();
      ctx.translate(lx, ly);
      if (claim) {
        // engraved name plate — fresh names ink themselves in
        const birth = this.claimBirth.get(f.id);
        const age = birth ? performance.now() - birth : Infinity;
        const t = this.reduced ? 1 : Math.min(1, age / 900);
        const ease = 1 - (1 - t) * (1 - t) * (1 - t);
        const fs = Math.max(px(11), px(9) + f.prominence * px(6));
        ctx.font = `italic ${fs}px "EB Garamond", Georgia, serif`;
        ctx.globalAlpha = ease;
        ctx.fillStyle = '#22303B';
        ctx.textAlign = 'center';
        ctx.fillText(claim.name, 0, px(-10) - (1 - ease) * px(3));
        ctx.strokeStyle = 'rgba(34,48,59,0.5)';
        ctx.lineWidth = px(0.8);
        const twd = ctx.measureText(claim.name).width * ease;
        ctx.beginPath();
        ctx.moveTo(-twd / 2, px(-4));
        ctx.lineTo(twd / 2, px(-4));
        ctx.stroke();
        ctx.globalAlpha = 1;
        // a small vermilion seal while the ink is fresh
        if (age < 120000) {
          ctx.fillStyle = 'rgba(179,58,43,0.85)';
          ctx.beginPath();
          ctx.arc(ctx.measureText(claim.name).width / 2 + px(8), px(-12), px(2.6), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // uncharted pennant
        const s = px(1);
        ctx.strokeStyle = '#B33A2B';
        ctx.lineWidth = px(1.4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -14 * s);
        ctx.stroke();
        ctx.fillStyle = '#B33A2B';
        ctx.beginPath();
        ctx.moveTo(0, -14 * s);
        ctx.lineTo(9 * s, -11 * s);
        ctx.lineTo(0, -8 * s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawRhumbs(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const ROSE = 6144;
    const REACH = ROSE * 0.8;
    const i0 = Math.floor((x0 - REACH) / ROSE);
    const i1 = Math.floor((x1 + REACH) / ROSE);
    const j0 = Math.floor((y0 - REACH) / ROSE);
    const j1 = Math.floor((y1 + REACH) / ROSE);
    const rosePx = 30 / this.cam.scale;
    ctx.strokeStyle = 'rgba(168,131,79,0.34)';
    ctx.lineWidth = 1 / this.cam.scale;
    ctx.beginPath();
    const roses: [number, number][] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = i * ROSE + hash2f(i, j, 555) * ROSE * 0.5;
        const cy = j * ROSE + hash2f(i, j, 556) * ROSE * 0.5;
        if (cx > x0 && cx < x1 && cy > y0 && cy < y1) roses.push([cx, cy]);
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(ang) * REACH, cy + Math.sin(ang) * REACH);
        }
      }
    }
    ctx.stroke();

    // compass roses where a rose center is in view
    ctx.strokeStyle = 'rgba(34,48,59,0.6)';
    ctx.lineWidth = 1.2 / this.cam.scale;
    ctx.beginPath();
    for (const [cx, cy] of roses) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const r = a % 2 === 0 ? rosePx : rosePx * 0.45;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      }
      ctx.arc(cx, cy, rosePx * 0.16, 0, Math.PI * 2);
      ctx.moveTo(cx + rosePx * 1.25, cy);
      ctx.arc(cx, cy, rosePx * 1.25, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  /** other sailors abroad — small engraved ships under sail */
  private drawShips(ctx: CanvasRenderingContext2D) {
    const px = (w: number) => w / this.cam.scale;
    for (const s of this.ships) {
      ctx.save();
      ctx.translate(s.x, s.y);
      const sc = px(1);
      ctx.strokeStyle = 'rgba(34,48,59,0.85)';
      ctx.fillStyle = 'rgba(34,48,59,0.85)';
      ctx.lineWidth = px(1.1);
      ctx.lineCap = 'round';
      // hull
      ctx.beginPath();
      ctx.moveTo(-7 * sc, 0);
      ctx.quadraticCurveTo(0, 4.5 * sc, 7 * sc, 0);
      ctx.stroke();
      // mast + square sail
      ctx.beginPath();
      ctx.moveTo(0, 0.5 * sc);
      ctx.lineTo(0, -9 * sc);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -8.5 * sc);
      ctx.quadraticCurveTo(4.5 * sc, -5 * sc, 0, -1.5 * sc);
      ctx.closePath();
      ctx.fill();
      // name in fine italic when close enough to read
      if (this.cam.scale > 0.5 && s.sailor) {
        ctx.font = `italic ${px(9.5)}px "EB Garamond", Georgia, serif`;
        ctx.fillStyle = 'rgba(93,109,117,0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(s.sailor, 0, px(12));
      }
      ctx.restore();
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(236,227,205,0)');
    g.addColorStop(1, 'rgba(236,227,205,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
