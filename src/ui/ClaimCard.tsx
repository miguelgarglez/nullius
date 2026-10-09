import { useEffect, useRef, useState } from 'react';
import type { Feature } from '../world/features';
import type { Claim } from '../claims/ledger';

// The naming card: an annotation anchored beside the pennant. On success
// it sinks into the chart (scale toward the feature) so the ink on the
// map — not the form — is what remains.

const KIND_NOUN: Record<string, string> = {
  island: 'island',
  peak: 'peak',
  bay: 'bay',
  cape: 'cape',
  lagoon: 'lagoon',
  rock: 'rock',
};

export function ClaimCard(props: {
  feature: Feature;
  claim: Claim | undefined;
  sailor: string;
  busy: boolean;
  error: string | null;
  taken: Claim | null;
  sinking: { dx: number; dy: number } | null;
  onName: (name: string, sailor: string) => void;
  onClose: () => void;
  style: { left: number; top: number };
}) {
  const { feature, claim, sailor, busy, taken } = props;
  const [name, setName] = useState('');
  const [who, setWho] = useState(sailor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName('');
    setWho(sailor);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [feature.id, sailor]);

  const noun = KIND_NOUN[feature.kind] ?? 'place';
  const sinkStyle = props.sinking
    ? ({
        ...props.style,
        '--sink-x': `${props.sinking.dx}px`,
        '--sink-y': `${props.sinking.dy}px`,
      } as React.CSSProperties)
    : props.style;

  return (
    <div
      className={`claim-card${props.sinking ? ' sinking' : ''}`}
      style={sinkStyle}
      role="dialog"
      aria-label={`Name this ${noun}`}
    >
      {claim ? (
        <div className="claim-plaque">
          <div className="claim-name">{claim.name}</div>
          <div className="claim-byline">
            charted by <em>{claim.sailor}</em>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2 && who.trim().length >= 1) {
              props.onName(name.trim(), who.trim());
            }
          }}
        >
          <div className="claim-kicker">uncharted {noun}</div>
          {taken ? (
            <div className="claim-taken">
              another sailor beat you to it — it is <em>{taken.name}</em> now
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`name this ${noun}`}
                maxLength={48}
                aria-label={`Name for this ${noun}`}
                disabled={busy}
              />
              {!sailor && (
                <input
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  placeholder="sign the log as…"
                  maxLength={32}
                  aria-label="Your sailor name"
                  disabled={busy}
                />
              )}
              <button type="submit" disabled={busy || name.trim().length < 2 || who.trim().length < 1}>
                {busy ? 'inking…' : 'claim it'}
              </button>
            </>
          )}
          <div className="claim-error" aria-live="assertive">
            {props.error}
          </div>
        </form>
      )}
      <button className="claim-close" onClick={props.onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

// The receipt: what a confirmed claim leaves behind — name, surveyor,
// coordinates, and a way to hand the view to someone else.
export function Receipt(props: {
  claim: Claim;
  onClose: () => void;
  style: { left: number; top: number };
}) {
  const [copied, setCopied] = useState(false);
  const { claim } = props;
  const copyLink = async () => {
    const link = `${location.origin}${location.pathname}#${Math.round(claim.x)},${Math.round(claim.y)},1.6`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="claim-card receipt" style={props.style} role="status" aria-live="polite">
      <div className="claim-kicker">inked forever</div>
      <div className="claim-plaque">
        <div className="claim-name">{claim.name}</div>
        <div className="claim-byline">
          charted by <em>{claim.sailor}</em> · {Math.round(claim.x)}° {Math.round(claim.y)}′
        </div>
      </div>
      <div className="receipt-actions">
        <button onClick={copyLink}>{copied ? 'chart link copied' : 'copy chart link'}</button>
        <button onClick={props.onClose}>sail on</button>
      </div>
    </div>
  );
}
