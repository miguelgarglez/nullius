import { useEffect, useState } from 'react';
import type { Feature } from '../world/features';
import type { Claim } from '../claims/ledger';

// The logbook: every feature on the visible chart, listed as real DOM
// controls. Keyboard and screen-reader sailors can chart a course and
// name a place without ever touching the canvas. Rows carry their
// bearing so two "uncharted rocks" are never indistinguishable.

const KIND_LABEL: Record<string, string> = {
  island: 'island',
  peak: 'peak',
  bay: 'bay',
  cape: 'cape',
  lagoon: 'lagoon',
  rock: 'rock',
};

export function Logbook(props: {
  open: boolean;
  features: Feature[];
  claims: Map<string, Claim>;
  onToggle: () => void;
  onSail: (f: Feature) => void;
}) {
  // the panel lingers long enough to slip back out — closing is an
  // exit, not a disappearance
  const [rendered, setRendered] = useState(props.open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (props.open) {
      setRendered(true);
      setLeaving(false);
      return;
    }
    if (!rendered) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRendered(false); // no exit to play — leave at once
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setRendered(false);
      setLeaving(false);
    }, 220);
    return () => clearTimeout(t);
  }, [props.open, rendered]);

  const named = props.features.filter((f) => props.claims.has(f.id));
  const uncharted = props.features.filter((f) => !props.claims.has(f.id));
  const row = (f: Feature, claimed: boolean) => (
    <li key={f.id}>
      <button onClick={() => props.onSail(f)}>
        <span className="lb-what">
          <span className={`lb-name${claimed ? '' : ' lb-uncharted'}`}>
            {claimed ? props.claims.get(f.id)!.name : `uncharted ${KIND_LABEL[f.kind]}`}
          </span>
          <span className="lb-ref">
            {Math.round(f.x)} · {Math.round(f.y)}
          </span>
        </span>
        <span className="lb-kind">{claimed ? KIND_LABEL[f.kind] : 'name it →'}</span>
      </button>
    </li>
  );
  return (
    <>
      <button
        className="logbook-toggle"
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-label="Open the logbook: places in view"
      >
        logbook — places in view
      </button>
      {rendered && (
        <nav className={`logbook${leaving ? ' leaving' : ''}`} aria-label="Places in view">
          <div className="logbook-head">places in view</div>
          <ul>
            {named.map((f) => row(f, true))}
            {uncharted.map((f) => row(f, false))}
            {!props.features.length && <li className="lb-empty">open water — no landmarks in view</li>}
          </ul>
        </nav>
      )}
    </>
  );
}
