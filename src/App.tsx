import { useCallback, useEffect, useRef, useState } from 'react';
import { WorldView } from './engine/world';
import { findHarbor, type Feature } from './world/features';
import {
  claimFeature,
  fetchClaim,
  ledgerOnline,
  loadClaims,
  subscribeClaims,
  trackPresence,
  type Claim,
} from './claims/ledger';
import { ClaimCard, Receipt } from './ui/ClaimCard';
import { FirstNote } from './ui/FirstNote';
import { Logbook } from './ui/Logbook';

const SAILOR_KEY = 'nullius.sailor';
const HAPTICS_KEY = 'nullius.haptics';

/** localStorage can throw (private mode, denied storage) — never fatal */
function safeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the log is kept in memory only */
  }
}
function safeRead(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function buzz(pattern: number | number[]) {
  try {
    if (safeRead(HAPTICS_KEY) !== 'off') navigator.vibrate?.(pattern);
  } catch {
    /* no haptics */
  }
}

interface Anchored {
  f: Feature;
  sx: number;
  sy: number;
}

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const claimsRef = useRef<Map<string, Claim>>(new Map());
  const [claims, setClaims] = useState<Map<string, Claim>>(claimsRef.current);
  const [selected, setSelected] = useState<Anchored | null>(null);
  const [receipt, setReceipt] = useState<{ f: Feature; claim: Claim; sx: number; sy: number } | null>(null);
  const [sinking, setSinking] = useState<{ dx: number; dy: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [abroad, setAbroad] = useState(0);
  const [sailor, setSailor] = useState(() => safeRead(SAILOR_KEY));
  const sailorRef = useRef(sailor);
  sailorRef.current = sailor;
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<Claim | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [online] = useState(ledgerOnline);
  const [logOpen, setLogOpen] = useState(false);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [sailed, setSailed] = useState(false);
  const [named, setNamed] = useState(false);
  const [noteNudge, setNoteNudge] = useState(0);
  const [noteDismissed, setNoteDismissed] = useState(false);
  const featSigRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ceremonyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const spawnRef = useRef<{ x: number; y: number } | null>(null);

  const clearCeremony = () => {
    for (const t of ceremonyTimers.current) clearTimeout(t);
    ceremonyTimers.current = [];
    setSinking(null);
  };

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
      const sig = fs.map((f) => f.id).join('|');
      if (sig !== featSigRef.current) {
        featSigRef.current = sig;
        setFeatures(fs);
      }
    });
    viewRef.current = v;

    // deep link: #x,y,scale — otherwise weigh anchor at the harbor
    const h = location.hash.slice(1).split(',').map(Number);
    if (h.length === 3 && h.every(Number.isFinite)) v.flyTo(h[0], h[1], h[2], true);
    else {
      const harbor = findHarbor();
      v.flyTo(harbor.x, harbor.y, window.innerWidth < 600 ? 1.0 : 1.4, true);
    }
    // coarse terrain under the first frame — no bare rectangles
    v.prewarm();
    spawnRef.current = { x: v.camera.x, y: v.camera.y };

    // tap resolves through the same hit-test the cursor uses
    v.setOnTap((f) => {
      clearCeremony();
      if (f) {
        const s = v.toScreen(f.x, f.y);
        setTaken(null);
        setCardError(null);
        setReceipt(null);
        setSelected({ f, sx: s.x, sy: s.y });
      } else {
        setSelected(null);
        setReceipt(null);
      }
    });

    // cards ride the camera on every rendered frame, not a poll
    v.setOnFrame(() => {
      const c = v.camera;
      if (spawnRef.current && Math.hypot(c.x - spawnRef.current.x, c.y - spawnRef.current.y) > 60 / c.scale) {
        spawnRef.current = null;
        setSailed(true);
      }
      setSelected((cur) => {
        if (!cur) return cur;
        const s = v.toScreen(cur.f.x, cur.f.y);
        if (Math.abs(s.x - cur.sx) < 0.01 && Math.abs(s.y - cur.sy) < 0.01) return cur;
        return { ...cur, sx: s.x, sy: s.y };
      });
      setReceipt((cur) => {
        if (!cur) return cur;
        const s = v.toScreen(cur.f.x, cur.f.y);
        if (Math.abs(s.x - cur.sx) < 0.01 && Math.abs(s.y - cur.sy) < 0.01) return cur;
        return { ...cur, sx: s.x, sy: s.y };
      });
    });

    // ledger: subscribe first so live inserts can never be clobbered by
    // the slower initial snapshot — the snapshot merges around them
    const unsub = subscribeClaims((c) => {
      const isNew = !claimsRef.current.has(c.feature_key);
      pushClaim(c);
      if (isNew) {
        setToast(`${c.name} — charted by ${c.sailor}`);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
      }
    });
    loadClaims().then((m) => {
      if (!m.size) return;
      const merged = new Map(claimsRef.current);
      for (const [k, c] of m) if (!merged.has(k)) merged.set(k, c);
      claimsRef.current = merged;
      setClaims(merged);
      v.setClaims(merged);
    });
    const unPresence = trackPresence(
      (ships) => {
        v.setShips(ships.map((s) => ({ x: s.x, y: s.y, sailor: s.sailor })));
        setAbroad(ships.length + 1);
      },
      () => ({ x: v.camera.x, y: v.camera.y }),
      () => sailorRef.current,
    );

    // deep links work live: pasting a chart link (or history nav) sails there
    const onHash = () => {
      const hh = location.hash.slice(1).split(',').map(Number);
      if (hh.length !== 3 || !hh.every(Number.isFinite)) return;
      const c = v.camera;
      if (Math.abs(hh[0] - c.x) > 1 || Math.abs(hh[1] - c.y) > 1 || Math.abs(hh[2] - c.scale) > 0.02) {
        v.flyTo(hh[0], hh[1], hh[2]);
      }
    };
    window.addEventListener('hashchange', onHash);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearCeremony();
        setSelected(null);
        setReceipt(null);
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onEsc);

    // keep the deep link fresh so any view is shareable
    const linkTimer = setInterval(() => {
      const c = v.camera;
      const next = `#${Math.round(c.x)},${Math.round(c.y)},${c.scale.toFixed(2)}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }, 800);

    return () => {
      unsub();
      unPresence();
      window.removeEventListener('keydown', onEsc);
      window.removeEventListener('hashchange', onHash);
      clearInterval(linkTimer);
      clearCeremony();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      v.destroy();
      viewRef.current = null;
    };
  }, [pushClaim]);

  const onName = async (name: string, who: string) => {
    const target = selected;
    if (!target) return;
    setBusy(true);
    setCardError(null);
    const res = await claimFeature(target.f, name, who);
    setBusy(false);
    if (res.ok) {
      safeStore(SAILOR_KEY, who);
      setSailor(who);
      pushClaim(res.claim);
      setNamed(true);
      buzz(12);
      // stage 1 — the slip sinks into the chart where the name now lives
      const s = viewRef.current?.toScreen(target.f.x, target.f.y);
      if (s) {
        const cardCx = Math.min(Math.max(target.sx - 110, 8), window.innerWidth - 240) + 110;
        const cardCy = Math.min(Math.max(target.sy - 120, 8), window.innerHeight - 190) + 60;
        setSinking({ dx: s.x - cardCx, dy: s.y - cardCy });
      }
      const claim = res.claim;
      const feat = target.f;
      // stage 2 — the slip is gone; the name inks letter by letter (~1.1s)
      ceremonyTimers.current.push(
        setTimeout(() => {
          setSinking(null);
          setSelected(null);
        }, 380),
      );
      // stage 3 — only once the ink settles does the ledger entry appear,
      // placed below the mark so it never covers its own reveal
      ceremonyTimers.current.push(
        setTimeout(() => {
          const sc = viewRef.current?.toScreen(feat.x, feat.y);
          setReceipt({ f: feat, claim, sx: sc?.x ?? 0, sy: sc?.y ?? 0 });
        }, 1400),
      );
    } else if (res.reason === 'taken') {
      const c = await fetchClaim(target.f.id);
      if (c) pushClaim(c);
      setSelected((cur) => {
        if (cur?.f.id !== target.f.id) return cur;
        setTaken(c ?? null);
        return cur;
      });
    } else {
      buzz([20, 40, 20]);
      setCardError(res.reason === 'offline' ? 'no signal — the ledger is unreachable' : 'the ink would not take — try again');
    }
  };

  const selClaim = selected ? claims.get(selected.f.id) : undefined;
  const cardPos = (a: { sx: number; sy: number }) => ({
    left: Math.min(Math.max(a.sx - 110, 8), window.innerWidth - 248),
    top: Math.min(Math.max(a.sy - 128, 8), window.innerHeight - 210),
  });
  // the ledger entry sits below the survey mark, clear of the new name
  const receiptPos = (a: { sx: number; sy: number }) => ({
    left: Math.min(Math.max(a.sx - 110, 8), window.innerWidth - 240),
    top: Math.min(a.sy + 42, window.innerHeight - 170),
  });

  return (
    <div className="app">
      <canvas
        ref={ref}
        className="chart"
        tabIndex={0}
        aria-label="A navigable chart of unclaimed lands. Use the logbook to list places in view."
      />
      <header className="chart-title">
        <h1>NULLIUS</h1>
        <p className="sub">
          CHART OF UNCLAIMED LANDS <span className="plate">— plate nº ∞</span>
        </p>
        <p className="ledger-line">
          {online
            ? `${abroad} ${abroad === 1 ? 'sailor' : 'sailors'} abroad · ${claims.size} ${claims.size === 1 ? 'name' : 'names'} given`
            : 'sailing offline — names will not be inked'}
        </p>
      </header>
      {selected && (
        <ClaimCard
          feature={selected.f}
          claim={sinking ? undefined : selClaim}
          sailor={sailor}
          busy={busy}
          error={cardError}
          taken={taken}
          sinking={sinking}
          onName={onName}
          onClose={() => {
            clearCeremony();
            setSelected(null);
            ref.current?.focus();
          }}
          style={cardPos(selected)}
        />
      )}
      {receipt && <Receipt claim={receipt.claim} onClose={() => setReceipt(null)} style={receiptPos(receipt)} />}
      <Logbook
        open={logOpen}
        features={features}
        claims={claims}
        onToggle={() => setLogOpen((o) => !o)}
        onSail={(f) => {
          viewRef.current?.flyTo(f.x, f.y);
          const s = viewRef.current?.toScreen(f.x, f.y);
          setTaken(null);
          setSelected({ f, sx: s?.x ?? 0, sy: s?.y ?? 0 });
          setLogOpen(false);
        }}
      />
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      <FirstNote sailed={sailed} named={named || !!selected} dismissed={noteDismissed} onDismiss={setNoteDismissed} nudge={noteNudge} />
      <button
        className="chart-note-help"
        onClick={() => {
          setNoteDismissed(false);
          setNoteNudge((n) => n + 1);
        }}
        aria-label="Show sailing notes"
      >
        ?
      </button>
    </div>
  );
}
