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
  private lastT = 0;
  private mq: MediaQueryList | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private dragMoved = 0;
  private trail: { t: number; x: number; y: number }[] = [];
  private lastMouse: { x: number; y: number } | null = null;
  private features: Feature[] = [];
  private hovered: Feature | null = null;
  private pressed: Feature | null = null;
  private claims = new Map<string, ClaimLike>();
  private claimBirth = new Map<string, number>();
  private ships: ShipLike[] = [];
  private shipsDrawn = new Map<string, { x: number; y: number }>();
  private glide: { x0: number; y0: number; s0: number; x1: number; y1: number; s1: number; t0: number; dur: number } | null = null;
  private onFeatures: (fs: Feature[]) => void;
  private onTap: ((f: Feature | null) => void) | null = null;
  private onFrame: (() => void) | null = null;
  private reduced = false;
  private canHover = true;
  private ro: ResizeObserver | null = null;
  private listeners: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, onFeatures: (fs: Feature[]) => void) {
    this.canvas = canvas;
    if (import.meta.env.DEV) (window as unknown as { __view: WorldView }).__view = this;
    this.ctx = canvas.getContext('2d')!;
    this.onFeatures = onFeatures;
    this.mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.mq.matches;
    const onMq = (e: MediaQueryListEvent) => {
      this.reduced = e.matches;
      // a preference change stills the sea immediately — no half-voyages
      if (this.reduced) {
        this.glide = null;
        this.vel.x = this.vel.y = 0;
      }
    };
    this.mq.addEventListener('change', onMq);
    this.listeners.push(() => this.mq?.removeEventListener('change', onMq));
    const hq = matchMedia('(hover: hover)');
    this.canHover = hq.matches;
    const onHq = (e: MediaQueryListEvent) => (this.canHover = e.matches);
    hq.addEventListener('change', onHq);
    this.listeners.push(() => hq.removeEventListener('change', onHq));
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
  /** tap resolves to a feature (or null) — same eligibility as hover */
  setOnTap(fn: (f: Feature | null) => void) {
    this.onTap = fn;
  }
  /** called after each rendered frame — lets React overlays ride the camera */
  setOnFrame(fn: () => void) {
    this.onFrame = fn;
  }

  /** the pennants that are actually drawn and hittable right now */
  private eligible(f: Feature): boolean {
    return !!this.claims.get(f.id) || f.prominence >= 0.45 || this.cam.scale >= 0.7;
  }

  hitTest(wx: number, wy: number): Feature | null {
    let best: Feature | null = null;
    let bd = Infinity;
    for (const f of this.features) {
      if (!this.eligible(f)) continue;
      const d = Math.hypot(f.x - wx, f.y - wy);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best && bd < 28 / this.cam.scale ? best : null;
  }

  /** render the coarse terrain under the viewport synchronously so the
   *  first visible frame already has complete coverage */
  prewarm() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const lod = Math.max(MIN_LOD, Math.min(MAX_LOD, Math.round(Math.log2(UPP0 * this.cam.scale))));
    const coarse = Math.max(MIN_LOD, lod - 3);
    const cw = tileWorld(coarse);
    const vx0 = this.cam.x - w / 2 / this.cam.scale;
    const vy0 = this.cam.y - h / 2 / this.cam.scale;
    for (let ty = Math.floor(vy0 / cw); ty <= Math.floor((this.cam.y + h / 2 / this.cam.scale) / cw); ty++) {
      for (let tx = Math.floor(vx0 / cw); tx <= Math.floor((this.cam.x + w / 2 / this.cam.scale) / cw); tx++) {
        const key = `${coarse}:${tx}:${ty}`;
        if (!this.tiles.has(key)) this.tiles.set(key, renderTile(coarse, tx, ty));
      }
    }
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

  /** glide to a spot — a deliberate voyage, not a teleport */
  flyTo(wx: number, wy: number, scale?: number, instant = false) {
    const s1 = scale !== undefined ? clampScale(scale) : this.cam.scale;
    if (instant || this.reduced) {
      this.cam.x = wx;
      this.cam.y = wy;
      this.cam.scale = s1;
      this.glide = null;
      return;
    }
    this.glide = {
      x0: this.cam.x,
      y0: this.cam.y,
      s0: this.cam.scale,
      x1: wx,
      y1: wy,
      s1,
      t0: performance.now(),
      dur: 750,
    };
    this.vel.x = this.vel.y = 0;
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
      this.trail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
      this.glide = null; // the hand interrupts any voyage
      if (!this.canHover) {
        // touch has no hover: press-light the pennant under the finger
        const rect = el.getBoundingClientRect();
        const w = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.pressed = this.hitTest(w.x, w.y);
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    this.listen(el, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        // remember the last pointer spot — hover truth is recomputed each
        // frame against the live camera (voyages can move the world under
        // a still cursor)
        const rect = el.getBoundingClientRect();
        this.lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (this.trail.length > 8) this.trail.shift();
      if (this.pressed && this.dragMoved > 8) this.pressed = null;

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
      }
    });

    const up = (e: PointerEvent) => {
      const had = this.pointers.delete(e.pointerId);
      this.lastPinch = 0;
      this.pressed = null;
      if (had && this.pointers.size === 0) {
        if (this.dragMoved < 6 && this.onTap) {
          const rect = el.getBoundingClientRect();
          const w = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
          this.onTap(this.hitTest(w.x, w.y));
        } else {
          // release velocity from timestamped samples: displacement over
          // the last ~90ms of the gesture, in world units per 16.67ms
          this.vel.x = this.vel.y = 0;
          if (!this.reduced && this.trail.length > 1) {
            const last = this.trail[this.trail.length - 1];
            // earliest sample still inside the window (trail is oldest→newest);
            // sparse event streams may hold only one sample in 150ms — then
            // fall back to the previous sample so the flick still registers
            const first = this.trail.find((s) => last.t - s.t <= 150) ?? this.trail[this.trail.length - 2];
            const span = last.t - first.t;
            const dx = last.x - first.x;
            const dy = last.y - first.y;
            // a pause before release means the hand stopped — no fling.
            // event dispatch adds tens of ms, so the recency bound is loose;
            // the real pause signal is travel inside the window
            if (span > 15 && dx * dx + dy * dy > 4 && e.timeStamp - last.t < 220) {
              const k = 16.67 / span;
              this.vel.x = (-dx / this.cam.scale) * k;
              this.vel.y = (-dy / this.cam.scale) * k;
            }
          }
        }
      }
    };
    this.listen(el, 'pointerup', up);
    this.listen(el, 'pointercancel', up);
    this.listen(el, 'pointerleave', () => {
      this.lastMouse = null;
      if (this.hovered) {
        this.hovered = null;
        el.style.cursor = '';
      }
    });

    this.listen(
      el,
      'wheel',
      (e) => {
        e.preventDefault();
        this.glide = null;
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          this.zoomTo(mx, my, Math.exp(-e.deltaY * 0.0016));
        } else {
          this.cam.x -= e.deltaX / this.cam.scale;
          this.cam.y -= e.deltaY / this.cam.scale;
          if (!this.reduced) {
            this.vel.x = -e.deltaX / this.cam.scale;
            this.vel.y = -e.deltaY / this.cam.scale;
          }
        }
      },
      { passive: false },
    );

    this.listen(window, 'keydown', (e) => {
      // don't hijack typing in inputs, dialogs, or other controls
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable], [role="dialog"], .first-note, .logbook')) return;
      const step = 60 / this.cam.scale;
      if (e.key.startsWith('Arrow') || e.key === '+' || e.key === '=' || e.key === '-') {
        this.glide = null; // steering interrupts any voyage
      }
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

    const now = performance.now();
    const dt = Math.min(50, now - (this.lastT || now));
    this.lastT = now;

    // a deliberate voyage (logbook, deep link) eases toward its bearing
    if (this.glide) {
      const g = this.glide;
      const t = Math.min(1, (now - g.t0) / g.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cam.x = g.x0 + (g.x1 - g.x0) * e;
      cam.y = g.y0 + (g.y1 - g.y0) * e;
      cam.scale = g.s0 + (g.s1 - g.s0) * e;
      if (t >= 1) this.glide = null;
    } else if (this.pointers.size === 0) {
      // inertia when released — dt-normalized so refresh rate doesn't
      // change how the sea carries you; reduced motion never drifts
      if (this.reduced) {
        vel.x = vel.y = 0;
      } else {
        const dtn = dt / 16.67;
        cam.x += vel.x * dtn;
        cam.y += vel.y * dtn;
        const damp = Math.pow(0.94, dtn);
        vel.x *= damp;
        vel.y *= damp;
        if (Math.abs(vel.x) + Math.abs(vel.y) < 0.001) {
          vel.x = vel.y = 0;
        }
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
    ctx.fillStyle = '#d9dccc';
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${lod}:${tx}:${ty}`;
        const t = this.tiles.get(key);
        if (t) {
          ctx.drawImage(t, tx * tw, ty * tw, tw, tw);
          this.tiles.delete(key);
          this.tiles.set(key, t); // touch for LRU
        } else {
          // refinement: draw the coarser parent stretched until the fine
          // tile inks in — terrain stays present, never a blank rectangle
          if (!this.drawParentTile(ctx, lod, tx, ty, tw)) {
            this.drawHaze(ctx, tx * tw, ty * tw, tw, tx, ty);
          }
          if (budget > 0) {
            budget--;
            const made = renderTile(lod, tx, ty);
            this.tiles.set(key, made);
            ctx.drawImage(made, tx * tw, ty * tw, tw, tw);
          } else if (!this.inQueue.has(key)) {
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
    // hover truth: recompute against the live camera every frame
    if (this.canHover && this.pointers.size === 0 && this.lastMouse) {
      const w = this.toWorld(this.lastMouse.x, this.lastMouse.y);
      const hov = this.hitTest(w.x, w.y);
      if (hov !== this.hovered) {
        this.hovered = hov;
        this.canvas.style.cursor = hov ? 'pointer' : '';
      }
    }
    this.drawLabels(ctx);
    this.drawShips(ctx);

    ctx.restore();

    // cartographic vignette — haze at the edges of the known chart
    this.drawVignette(ctx, w, h);

    // publish features to React (cheap check to avoid churn)
    this.onFeatures(this.features);
    // overlays that ride the camera re-anchor every frame, not on a poll
    this.onFrame?.();
  };

  /** Draw the nearest cached ancestor tile covering (lod,tx,ty). When no
   *  ancestor exists at all, render the coarsest one synchronously — a
   *  blurred coastline beats a blank rectangle every time. */
  private drawParentTile(
    ctx: CanvasRenderingContext2D,
    lod: number,
    tx: number,
    ty: number,
    tw: number,
  ): boolean {
    const place = (t: HTMLCanvasElement, plod: number, ptx: number, pty: number) => {
      const pw = tileWorld(plod);
      const sx = ((tx * tw - ptx * pw) / pw) * 256;
      const sy = ((ty * tw - pty * pw) / pw) * 256;
      const ss = (tw / pw) * 256;
      ctx.drawImage(t, sx, sy, ss, ss, tx * tw, ty * tw, tw, tw);
    };
    for (let p = 1; p <= 4 && lod - p >= MIN_LOD; p++) {
      const pw = tileWorld(lod - p);
      const ptx = Math.floor((tx * tw) / pw);
      const pty = Math.floor((ty * tw) / pw);
      const t = this.tiles.get(`${lod - p}:${ptx}:${pty}`);
      if (!t) continue;
      place(t, lod - p, ptx, pty);
      return true;
    }
    // nothing cached anywhere above — ink the coarsest chart now
    const clod = MIN_LOD;
    const cw = tileWorld(clod);
    const ctx0 = Math.floor((tx * tw) / cw);
    const cty = Math.floor((ty * tw) / cw);
    const ckey = `${clod}:${ctx0}:${cty}`;
    let t = this.tiles.get(ckey);
    if (!t) {
      t = renderTile(clod, ctx0, cty);
      this.tiles.set(ckey, t);
    }
    place(t, clod, ctx0, cty);
    return true;
  }

  private drawHaze(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number) {
    ctx.fillStyle = '#d9dccc';
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
        // the survey mark: a benchmark cross at the exact point, forever
        ctx.strokeStyle = 'rgba(34,48,59,0.8)';
        ctx.lineWidth = px(0.9);
        const bm = px(4.2);
        ctx.beginPath();
        ctx.arc(0, 0, bm, 0, Math.PI * 2);
        ctx.moveTo(-bm * 1.5, 0);
        ctx.lineTo(-bm * 0.6, 0);
        ctx.moveTo(bm * 0.6, 0);
        ctx.lineTo(bm * 1.5, 0);
        ctx.moveTo(0, -bm * 1.5);
        ctx.lineTo(0, -bm * 0.6);
        ctx.moveTo(0, bm * 0.6);
        ctx.lineTo(0, bm * 1.5);
        ctx.stroke();

        // the name inks letter by letter — a surveyor's hand, not a fade.
        // settled names carry cartographic weight, not caption size
        const birth = this.claimBirth.get(f.id);
        const age = birth ? performance.now() - birth : Infinity;
        const fs = px(14) + f.prominence * px(11);
        ctx.font = `italic ${fs}px "EB Garamond", Georgia, serif`;
        ctx.fillStyle = '#22303B';
        const chars = Math.ceil(Math.min(1, age / (this.reduced ? 1 : 1100)) * claim.name.length);
        const shown = claim.name.slice(0, chars);
        const fullW = ctx.measureText(claim.name).width;
        ctx.textAlign = 'left';
        const settle = chars < claim.name.length ? px(2) : 0;
        ctx.fillText(shown, -fullW / 2, px(-12) + settle);
        if (chars === claim.name.length) {
          ctx.strokeStyle = 'rgba(34,48,59,0.5)';
          ctx.lineWidth = px(0.8);
          ctx.beginPath();
          ctx.moveTo(-fullW / 2, px(-6));
          ctx.lineTo(fullW / 2, px(-6));
          ctx.stroke();
          if (age < 120000) {
            ctx.fillStyle = 'rgba(179,58,43,0.85)';
            ctx.beginPath();
            ctx.arc(fullW / 2 + px(8), px(-14), px(2.6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        // uncharted pennant — stirs when within reach; presses harder
        // under a finger (touch has no hover)
        const hot = f === this.hovered;
        const press = f === this.pressed;
        const s = px(1);
        ctx.strokeStyle = '#B33A2B';
        ctx.lineWidth = px(1.4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -14 * s);
        ctx.stroke();
        ctx.fillStyle = press ? '#8E2B1F' : '#B33A2B';
        ctx.beginPath();
        const lift = hot || press ? px(2.5) : 0;
        ctx.moveTo(0, -14 * s - lift);
        ctx.lineTo(9 * s, -11 * s - lift);
        ctx.lineTo(0, -8 * s - lift);
        ctx.closePath();
        ctx.fill();
        if (hot || press) {
          // a sounding-ring: the place acknowledges you
          ctx.strokeStyle = press ? 'rgba(179,58,43,0.75)' : 'rgba(179,58,43,0.5)';
          ctx.lineWidth = px(press ? 1.4 : 1);
          ctx.beginPath();
          ctx.arc(0, 0, px(7), 0, Math.PI * 2);
          ctx.stroke();
        }
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

  /** other sailors abroad — small engraved ships under sail; positions
   *  ease toward the latest presence fix instead of jumping */
  private drawShips(ctx: CanvasRenderingContext2D) {
    const px = (w: number) => w / this.cam.scale;
    const seen = new Set<string>();
    for (const s of this.ships) {
      seen.add(s.sailor);
      let d = this.shipsDrawn.get(s.sailor);
      if (!d) {
        d = { x: s.x, y: s.y };
        this.shipsDrawn.set(s.sailor, d);
      } else if (!this.reduced) {
        d.x += (s.x - d.x) * 0.12;
        d.y += (s.y - d.y) * 0.12;
      } else {
        d.x = s.x;
        d.y = s.y;
      }
      ctx.save();
      ctx.translate(d.x, d.y);
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
    for (const k of this.shipsDrawn.keys()) {
      if (!seen.has(k)) this.shipsDrawn.delete(k);
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(218,222,202,0)');
    g.addColorStop(1, 'rgba(218,222,202,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
