import { useEffect, useState } from 'react';

const SEEN_KEY = 'nullius.seen-intro';

// First-run guidance as marginalia, not a modal. The note stages its
// advice: sail first, then name. It retires itself once both are done.

type Step = 'sail' | 'name' | 'done';

export function FirstNote(props: { sailed: boolean; named: boolean }) {
  const [step, setStep] = useState<Step>(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ? 'done' : 'sail';
    } catch {
      return 'sail';
    }
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (step === 'sail' && props.sailed) setStep('name');
  }, [props.sailed, step]);
  useEffect(() => {
    if (step === 'name' && props.named) {
      const t = setTimeout(() => {
        try {
          localStorage.setItem(SEEN_KEY, '1');
        } catch {
          /* fine */
        }
        setStep('done');
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [props.named, step]);

  if (step === 'done' || dismissed) return null;
  return (
    <div className="first-note" role="note">
      <span className="fn-mark">※</span>
      {step === 'sail' ? (
        <span>uncharted waters — drag to sail, scroll or pinch to sound the depths</span>
      ) : (
        <span>tap a red pennant — the first sailor to name a place inks it forever</span>
      )}
      <button onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
