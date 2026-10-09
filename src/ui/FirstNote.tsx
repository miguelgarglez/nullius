import { useEffect, useState } from 'react';

const HAPTICS_KEY = 'nullius.haptics';
const readHaptics = () => {
  try {
    return localStorage.getItem(HAPTICS_KEY) ?? 'on';
  } catch {
    return 'on';
  }
};
const writeHaptics = (v: string) => {
  try {
    localStorage.setItem(HAPTICS_KEY, v);
  } catch {
    /* memory only */
  }
};

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
  const [hapticsOff, setHapticsOff] = useState(() => readHaptics() === 'off');
  const [step, setStep] = useState<Step>(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ? 'done' : 'sail';
    } catch {
      return 'sail';
    }
  });
  // a returning visitor's note is already retired — never mounted
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(step === 'done');
  const coarse = useState(() => {
    try {
      return matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  })[0];
  const zoomVerb = coarse ? 'pinch' : 'scroll or pinch';

  // the "?" button calls the note back — the full card, not just one step
  useEffect(() => {
    if (props.nudge > 0) {
      setStep('help');
      setLeaving(false);
      setGone(false);
    }
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

  // retiring — the note slips back out instead of vanishing
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (step !== 'done' || gone) return;
    if (reduced()) {
      setGone(true);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => setGone(true), 240);
    return () => clearTimeout(t);
  }, [step, gone]);

  const dismiss = () => {
    if (reduced()) {
      props.onDismiss(true);
      return;
    }
    setLeaving(true);
    setTimeout(() => props.onDismiss(true), 200);
  };

  if (gone || props.dismissed) return null;
  return (
    <div className={`first-note${leaving ? ' leaving' : ''}`} role="note">
      <span className="fn-mark">※</span>
      {step === 'sail' && (
        <span>
          a <b>red pennant</b> is a place you can name — forever, for everyone · <b>drag</b> to sail ·{' '}
          <b>{zoomVerb}</b> to zoom
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
          <b>drag</b> to sail · <b>{zoomVerb}</b> to zoom · <b>tap a red pennant</b> to name a place
          forever — the <b>logbook</b> lists everything in view ·{' '}
          <button
            className="fn-haptics"
            onClick={() => {
              const off = readHaptics() === 'off';
              writeHaptics(off ? 'on' : 'off');
              setHapticsOff(!off);
            }}
          >
            touch buzz: {hapticsOff ? 'off' : 'on'}
          </button>
        </span>
      )}
      <button onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
