import { useEffect, useRef, useState } from 'react';
import type { Feature } from '../world/features';
import type { Claim } from '../claims/ledger';

// The naming card: a small paper slip pinned beside the pennant.
// If the sailor has never signed the log, we ask for their name first —
// the same card serves both moments.

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
  taken: Claim | null;
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

  return (
    <div className="claim-card" style={props.style} role="dialog" aria-label={`Name this ${noun}`}>
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
        </form>
      )}
      <button className="claim-close" onClick={props.onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}
