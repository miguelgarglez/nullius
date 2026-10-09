import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Feature } from '../world/features';
import type { Claim } from '../claims/ledger';

// The naming annotation: an inked note anchored above its pennant by a
// leader line. It measures itself and picks the side with room. On
// narrow screens it becomes a bottom tray so the point stays visible.

const KIND_NOUN: Record<string, string> = {
  island: 'island',
  peak: 'peak',
  bay: 'bay',
  cape: 'cape',
  lagoon: 'lagoon',
  rock: 'rock',
};

/** anchor (screen px of the feature) → measured placement beside the
 *  mark: preferred side first, the other side when it doesn't fit,
 *  always clamped inside the viewport */
function useAnchored(
  anchor: { sx: number; sy: number },
  opts: { prefer?: 'above' | 'below'; gap?: number } = {},
): React.MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const { prefer = 'above', gap = 34 } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 8;
    let x = anchor.sx - r.width / 2;
    if (x < m) x = m;
    if (x + r.width > window.innerWidth - m) x = window.innerWidth - m - r.width;
    const above = anchor.sy - r.height - gap;
    const below = anchor.sy + gap;
    let y = prefer === 'above' ? above : below;
    // no room on the preferred side → take the other
    if (prefer === 'above' && above < m) y = below;
    if (prefer === 'below' && below + r.height > window.innerHeight - m) y = above;
    if (y + r.height > window.innerHeight - m) y = window.innerHeight - m - r.height;
    if (y < m) y = m;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.side = y >= anchor.sy ? 'below' : 'above'; // the leader follows the true side
    el.style.visibility = 'visible';
  });
  return ref;
}

export function ClaimCard(props: {
  feature: Feature;
  claim: Claim | undefined;
  sailor: string;
  busy: boolean;
  error: string | null;
  taken: Claim | null;
  checking: boolean;
  sinking: { dx: number; dy: number } | null;
  leaving?: boolean;
  onName: (name: string, sailor: string) => void;
  onClose: () => void;
  anchor: { sx: number; sy: number };
}) {
  const { feature, claim, sailor, busy, taken, checking } = props;
  const [name, setName] = useState('');
  const [who, setWho] = useState(sailor);
  // whether this card opened with an empty log — the sailor line stays
  // mounted for the card's life so the sink never loses its geometry
  const [needsWho] = useState(() => !sailor);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useAnchored(props.anchor, { prefer: 'above', gap: 30 });
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  // reset when the card moves to a new feature — never mid-ceremony
  useEffect(() => {
    setName('');
    setWho(sailor);
    setCopied('idle');
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id]);

  const noun = KIND_NOUN[feature.kind] ?? 'place';
  const sinkStyle = props.sinking
    ? ({ '--sink-x': `${props.sinking.dx}px`, '--sink-y': `${props.sinking.dy}px` } as React.CSSProperties)
    : undefined;
  const link = `${location.origin}${location.pathname}#${Math.round(feature.x)},${Math.round(feature.y)},1.6`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  return (
    <div
      ref={cardRef}
      className={`claim-card${props.sinking ? ' sinking' : ''}${props.leaving ? ' leaving' : ''}`}
      style={sinkStyle}
      role="dialog"
      aria-label={claim ? `${claim.name}` : `Name this ${noun}`}
    >
      {claim ? (
        <div className="claim-plaque">
          {/* a lost race keeps its verdict in view, next to the winner */}
          {taken && <div className="claim-taken">your name arrived too late —</div>}
          <div className="claim-name">{claim.name}</div>
          <div className="claim-byline">charted by {claim.sailor}</div>
          {/* the reference IS the share control — copy the bearing */}
          <button className="ref-share" onClick={copyLink} title="copy a link to this spot">
            ref {Math.round(feature.x)} · {Math.round(feature.y)}{' '}
            <span className="ref-mark" aria-live="polite">{copied === 'ok' ? 'copied' : '⧉'}</span>
          </button>
          {copied === 'fail' && (
            <input
              className="le-link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              aria-label="Chart link — copy by hand"
              ref={(el) => el?.focus()}
            />
          )}
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
          <div className="claim-kicker">
            {checking ? `uncharted ${noun} · checking the ledger…` : `uncharted ${noun}`}
          </div>
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
              {needsWho && (
                <input
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  placeholder="sign the log as…"
                  maxLength={32}
                  aria-label="Your sailor name"
                  disabled={busy}
                />
              )}
              <button
                type="submit"
                disabled={busy || checking || name.trim().length < 2 || who.trim().length < 1}
              >
                {busy ? 'inking…' : 'claim it — forever'}
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

// The ledger entry: a marginal notation tied to its survey mark by a
// leader. It stays until dismissed; the bearing is always recoverable.
export function Receipt(props: {
  claim: Claim;
  leaving?: boolean;
  onClose: () => void;
  anchor: { sx: number; sy: number };
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  // the entry goes below the mark — the new name lives just above it
  const ref = useAnchored(props.anchor, { prefer: 'below', gap: 48 });
  const { claim } = props;
  const link = `${location.origin}${location.pathname}#${Math.round(claim.x)},${Math.round(claim.y)},1.6`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };
  return (
    <div ref={ref} className={`ledger-entry${props.leaving ? ' leaving' : ''}`} role="status" aria-live="polite">
      <div className="le-kicker">ENTERED IN THE CHART</div>
      <div className="le-line">
        <em>{claim.name}</em>, charted by {claim.sailor}
      </div>
      <div className="le-actions">
        {/* the reference IS the share control — copy the bearing */}
        <button className="ref-share" onClick={copyLink} title="copy a link to this spot">
          ref {Math.round(claim.x)} · {Math.round(claim.y)}{' '}
          <span className="ref-mark" aria-live="polite">{copied === 'ok' ? 'copied' : '⧉'}</span>
        </button>
        <button className="sail-on" onClick={props.onClose}>
          sail on →
        </button>
      </div>
      {copied === 'fail' && (
        <input
          className="le-link"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          aria-label="Chart link — copy by hand"
          ref={(el) => el?.focus()}
        />
      )}
    </div>
  );
}
