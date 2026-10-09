import { useEffect, useState } from 'react';

const SEEN_KEY = 'nullius.seen-intro';

// First-run guidance as marginalia, not a modal. The note stages its
// advice: sail first, then name. It retires itself once both are done,
// and the "?" in the margin calls it back.

type Step = 'sail' | 'name' | 'help' | 'done';

export function FirstNote(props: {
  sailed: boolean;
  named: boolean;
  dismissed: boolean;
  onDismiss: (d: boolean) => void;
  nudge: number;
}) {
  const [step, setStep] = useState<Step>(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ? 'done' : 'sail';
    } catch {
      return 'sail';
    }
  });

  // the "?" button calls the note back — the full card, not just one step
  useEffect(() => {
    if (props.nudge > 0) setStep('help');
  }, [props.nudge]);

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

  if (step === 'done' || props.dismissed) return null;
  return (
    <div className="first-note" role="note">
      <span className="fn-mark">※</span>
      {step === 'sail' && (
        <span>
          <b>drag</b> to sail · <b>scroll or pinch</b> to zoom · arrow keys steer
        </span>
      )}
      {step === 'name' && (
        <span>
          <b>tap a red pennant</b> — the first sailor to name a place inks it onto this chart, forever, for
          everyone
        </span>
      )}
      {step === 'help' && (
        <span>
          <b>drag</b> to sail · <b>scroll or pinch</b> to zoom · <b>tap a red pennant</b> to name a place
          forever — the <b>logbook</b> lists everything in view
        </span>
      )}
      <button onClick={() => props.onDismiss(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
