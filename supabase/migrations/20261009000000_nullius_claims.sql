-- nullius: the claim ledger.
-- feature_key is the primary key, so the first insert wins and every
-- later attempt fails with 23505. RLS grants the world read + insert
-- and nobody update or delete: a name, once given, is forever.

create table public.nullius_claims (
  feature_key text primary key,
  kind text not null check (kind in ('island','peak','bay','cape','lagoon','rock')),
  name text not null check (char_length(btrim(name)) between 2 and 48),
  x double precision not null,
  y double precision not null,
  sailor text not null check (char_length(btrim(sailor)) between 1 and 32),
  created_at timestamptz not null default now()
);

alter table public.nullius_claims enable row level security;

create policy nullius_claims_read on public.nullius_claims
  for select to anon, authenticated using (true);

create policy nullius_claims_write_once on public.nullius_claims
  for insert to anon, authenticated with check (true);

alter publication supabase_realtime add table public.nullius_claims;
