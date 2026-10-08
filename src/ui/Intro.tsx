import { useEffect, useRef, useState } from 'react';

const SEEN_KEY = 'nullius.seen-intro';

export function Intro() {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* fine */
    }
    setShow(false);
  };
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);
  useEffect(() => {
    if (!show) return;
    btnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);
  if (!show) return null;
  return (
    <div className="intro-scrim" onClick={dismiss}>
      <div
        className="intro-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About Nullius"
      >
        <div className="intro-rule" />
        <h2>terra nullius</h2>
        <p>
          This chart is endless and no place on it has a name. Drag to sail, scroll to zoom.
          The first sailor to reach a place names it — and the name is inked forever,
          on every chart, for every sailor who follows.
        </p>
        <p className="intro-hint">tap a red pennant to leave your mark</p>
        <button ref={btnRef} onClick={dismiss}>
          set sail
        </button>
        <div className="intro-rule" />
      </div>
    </div>
  );
}
