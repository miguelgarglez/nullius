import type { Feature } from '../world/features';
import type { Claim } from '../claims/ledger';

// The logbook: every feature on the visible chart, listed as real DOM
// controls. Keyboard and screen-reader sailors can chart a course and
// name a place without ever touching the canvas.

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
  const named = props.features.filter((f) => props.claims.has(f.id));
  const uncharted = props.features.filter((f) => !props.claims.has(f.id));
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
      {props.open && (
        <nav className="logbook" aria-label="Places in view">
          <div className="logbook-head">places in view</div>
          <ul>
            {named.map((f) => (
              <li key={f.id}>
                <button onClick={() => props.onSail(f)}>
                  <span className="lb-name">{props.claims.get(f.id)!.name}</span>
                  <span className="lb-kind">{KIND_LABEL[f.kind]}</span>
                </button>
              </li>
            ))}
            {uncharted.map((f) => (
              <li key={f.id}>
                <button onClick={() => props.onSail(f)}>
                  <span className="lb-name lb-uncharted">uncharted {KIND_LABEL[f.kind]}</span>
                  <span className="lb-kind">name it →</span>
                </button>
              </li>
            ))}
            {!props.features.length && <li className="lb-empty">open water — no landmarks in view</li>}
          </ul>
        </nav>
      )}
    </>
  );
}
