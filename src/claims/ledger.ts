import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Feature } from '../world/features';

// The claim ledger: first writer wins (feature_key is the PK), and the
// table grants select+insert but never update or delete — a name, once
// given, is forever. Realtime broadcasts each new claim to every chart.

export interface Claim {
  feature_key: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  sailor: string;
  created_at: string;
}

export type ClaimResult =
  | { ok: true; claim: Claim }
  | { ok: false; reason: 'taken' | 'offline' | 'error'; claim?: Claim };

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let sb: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (!URL || !KEY) return null;
  if (!sb) sb = createClient(URL, KEY);
  return sb;
}

/** the claims table: product-prefixed in the public schema (PostgREST only
    exposes public on hosted Supabase; RLS still guards every access) */
const table = () => client()!.from('nullius_claims');

export const ledgerOnline = () => client() !== null;

/** Full ledger read — the chart boots with every name ever given.
 *  Returns null when the ledger is unreachable so callers can say so. */
export async function loadClaims(): Promise<Map<string, Claim> | null> {
  const map = new Map<string, Claim>();
  const c = client();
  if (!c) return null;
  const { data, error } = await table().select('*').limit(10000);
  if (error || !data) return null;
  for (const row of data as Claim[]) map.set(row.feature_key, row);
  return map;
}

/** Attempt to name a feature. 23505 = somebody beat you to it. */
export async function claimFeature(
  f: Feature,
  name: string,
  sailor: string,
): Promise<ClaimResult> {
  const c = client();
  if (!c) return { ok: false, reason: 'offline' };
  const row = {
    feature_key: f.id,
    kind: f.kind,
    name: name.trim(),
    x: f.x,
    y: f.y,
    sailor: sailor.trim(),
  };
  const { data, error } = await table().insert(row).select().single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'taken' };
    return { ok: false, reason: 'error' };
  }
  return { ok: true, claim: data as Claim };
}

/** One feature's row — used after a lost race to learn the winning name. */
export async function fetchClaim(featureKey: string): Promise<Claim | null> {
  const c = client();
  if (!c) return null;
  const { data, error } = await table().select('*').eq('feature_key', featureKey).maybeSingle();
  if (error || !data) return null;
  return data as Claim;
}

/** Live feed of new claims — every sailor's chart updates together. */
export function subscribeClaims(onClaim: (c: Claim) => void): () => void {
  const c = client();
  if (!c) return () => {};
  const ch = c
    .channel('nullius-claims')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'nullius_claims' },
      (payload) => onClaim(payload.new as Claim),
    )
    .subscribe();
  return () => {
    c.removeChannel(ch);
  };
}

export interface ShipMark {
  x: number;
  y: number;
  sailor: string;
  key: string;
}

export const SESSION_KEY = crypto.randomUUID();

/** Presence: live positions of every sailor abroad on the chart. */
export function trackPresence(
  onShips: (ships: ShipMark[]) => void,
  getPos: () => { x: number; y: number },
  getSailor: () => string,
): (() => void) {
  const c = client();
  if (!c) {
    onShips([]);
    return () => {};
  }
  const ch = c.channel('nullius-presence', { config: { presence: { key: SESSION_KEY } } });
  const publish = () => {
    const state = ch.presenceState<{ x: number; y: number; sailor: string }>();
    const ships: ShipMark[] = [];
    for (const [key, metas] of Object.entries(state)) {
      for (const m of metas) {
        if (key !== SESSION_KEY) ships.push({ x: m.x, y: m.y, sailor: m.sailor, key });
      }
    }
    onShips(ships);
  };
  ch.on('presence', { event: 'sync' }, publish);
  ch.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      const p = getPos();
      await ch.track({ x: Math.round(p.x), y: Math.round(p.y), sailor: getSailor() });
    }
  });
  const timer = setInterval(() => {
    if (ch.state === 'joined') {
      const p = getPos();
      ch.track({ x: Math.round(p.x), y: Math.round(p.y), sailor: getSailor() });
    }
  }, 5000);
  return () => {
    clearInterval(timer);
    c.removeChannel(ch);
  };
}
