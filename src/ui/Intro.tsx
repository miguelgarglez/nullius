import { useEffect, useState } from 'react';

const SEEN_KEY = 'nullius.seen-intro';

export function Intro() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) setShow(true);
  }, []);
  if (!show) return null;
  return (
    <div className="intro-scrim" onClick={() => { localStorage.setItem(SEEN_KEY, '1'); setShow(false); }}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="About Nullius">
        <div className="intro-rule" />
        <h2>terra nullius</h2>
        <p>
          This chart is endless and no place on it has a name. Drag to sail, scroll to zoom.
          The first sailor to reach a place names it — and the name is inked forever,
          on every chart, for every sailor who follows.
        </p>
        <p className="intro-hint">tap a red pennant to leave your mark</p>
        <button
          onClick={() => {
            localStorage.setItem(SEEN_KEY, '1');
            setShow(false);
          }}
        >
          set sail
        </button>
        <div className="intro-rule" />
      </div>
    </div>
  );
}
