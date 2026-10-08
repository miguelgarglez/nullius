import { useEffect, useRef, useState } from 'react';
import { WorldView } from './engine/world';
import type { Feature } from './world/features';

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<WorldView | null>(null);
  const [, setFeatures] = useState<Feature[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    const v = new WorldView(ref.current, (fs) => setFeatures(fs));
    // debug/deep-link: #x,y,scale
    const h = location.hash.slice(1).split(',');
    if (h.length === 3) v.flyTo(+h[0], +h[1], +h[2]);
    setView(v);
    return () => v.destroy();
  }, []);

  return (
    <div className="app">
      <canvas ref={ref} className="chart" />
      <header className="masthead">
        <h1>NULLIUS</h1>
        <p className="sub">a chart of unclaimed lands</p>
      </header>
      <div className="cartouche">
        <span className="cartouche-line">every name on this chart was left by a sailor</span>
      </div>
      {view && null}
    </div>
  );
}
