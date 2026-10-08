import { useCallback, useEffect, useRef, useState } from 'react';
import { WorldView } from './engine/world';
import { findHarbor, type Feature } from './world/features';
import {
  claimFeature,
  ledgerOnline,
  loadClaims,
  subscribeClaims,
  trackPresence,
  type Claim,
} from './claims/ledger';
import { ClaimCard } from './ui/ClaimCard';
import { Intro } from './ui/Intro';

const SAILOR_KEY = 'nullius.sailor';

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const featuresRef = useRef<Feature[]>([]);
  const claimsRef = useRef<Map<string, Claim>>(new Map());
  const [claims, setClaims] = useState<Map<string, Claim>>(claimsRef.current);
  const [selected, setSelected] = useState<{ f: Feature; sx: number; sy: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [abroad, setAbroad] = useState(0);
  const [sailor, setSailor] = useState(() => localStorage.getItem(SAILOR_KEY) ?? '');
  const sailorRef = useRef(sailor);
  sailorRef.current = sailor;
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<Claim | null>(null);
  const [online] = useState(ledgerOnline);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushClaim = useCallback((c: Claim) => {
    const next = new Map(claimsRef.current);
    next.set(c.feature_key, c);
    claimsRef.current = next;
    setClaims(next);
    viewRef.current?.setClaims(next);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const v = new WorldView(ref.current, (fs) => {
      featuresRef.current = fs;
    });
    viewRef.current = v;

    // deep link: #x,y,scale — otherwise weigh anchor at the harbor
    const h = location.hash.slice(1).split(',');
    if (h.length === 3) v.flyTo(+h[0], +h[1], +h[2]);
    else {
      const harbor = findHarbor();
      v.flyTo(harbor.x, harbor.y, 1.4);
    }

    // tap → nearest feature within reach → open the naming card
    v.setOnTap((wx, wy) => {
      let best: Feature | null = null;
      let bd = Infinity;
      for (const f of featuresRef.current) {
        const d = Math.hypot(f.x - wx, f.y - wy);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      const reach = 26 / v.camera.scale;
      if (best && bd < reach) {
        const s = v.toScreen(best.x, best.y);
        setTaken(null);
        setSelected({ f: best, sx: s.x, sy: s.y });
      } else {
        setSelected(null);
      }
    });

    // ledger
    loadClaims().then((m) => {
      claimsRef.current = m;
      setClaims(m);
      v.setClaims(m);
    });
    const unsub = subscribeClaims((c) => {
      const isNew = !claimsRef.current.has(c.feature_key);
      pushClaim(c);
      if (isNew) {
        setToast(`${c.name} — charted by ${c.sailor}`);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
      }
    });
    const unPresence = trackPresence(
      (ships) => {
        v.setShips(ships.map((s) => ({ x: s.x, y: s.y, sailor: s.sailor })));
        setAbroad(ships.length + 1);
      },
      () => ({ x: v.camera.x, y: v.camera.y }),
      () => sailorRef.current,
    );

    // keep the deep link fresh so any view is shareable
    const linkTimer = setInterval(() => {
      const c = v.camera;
      const next = `#${Math.round(c.x)},${Math.round(c.y)},${c.scale.toFixed(2)}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 800);

    return () => {
      unsub();
      unPresence();
      clearInterval(linkTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      v.destroy();
      viewRef.current = null;
    };
  }, [pushClaim]);

  const onName = async (name: string, who: string) => {
    if (!selected) return;
    setBusy(true);
    const res = await claimFeature(selected.f, name, who);
    setBusy(false);
    if (res.ok) {
      localStorage.setItem(SAILOR_KEY, who);
      setSailor(who);
      pushClaim(res.claim);
      setSelected(null);
    } else if (res.reason === 'taken') {
      const m = await loadClaims();
      claimsRef.current = m;
      setClaims(m);
      viewRef.current?.setClaims(m);
      setTaken(m.get(selected.f.id) ?? null);
    } else {
      setToast(res.reason === 'offline' ? 'no signal — the ledger is unreachable' : 'the ink would not take — try again');
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }
  };

  const selClaim = selected ? claims.get(selected.f.id) : undefined;

  return (
    <div className="app">
      <canvas ref={ref} className="chart" />
      <header className="masthead">
        <h1>NULLIUS</h1>
        <p className="sub">a chart of unclaimed lands</p>
      </header>
      <div className="cartouche">
        <span className="cartouche-line">
          {online
            ? `${abroad} ${abroad === 1 ? 'sailor' : 'sailors'} abroad · ${claims.size} ${claims.size === 1 ? 'name' : 'names'} given`
            : 'sailing offline — names will not be inked'}
        </span>
      </div>
      {selected && (
        <ClaimCard
          feature={selected.f}
          claim={selClaim}
          sailor={sailor}
          busy={busy}
          taken={taken}
          onName={onName}
          onClose={() => setSelected(null)}
          style={{
            left: Math.min(Math.max(selected.sx - 110, 8), window.innerWidth - 240),
            top: Math.max(selected.sy - 120, 8),
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      <Intro />
    </div>
  );
}
