-- nullius: the claim ledger, in its own schema of the shared Lab project.
-- feature_key is the primary key, so the first insert wins and every
-- later attempt fails with 23505. RLS grants the world read + insert
-- and nobody update or delete: a name, once given, is forever.

create schema if not exists nullius;

create table nullius.claims (
  feature_key text primary key,
  kind text not null check (kind in ('island','peak','bay','cape','lagoon','rock')),
  name text not null check (char_length(btrim(name)) between 2 and 48),
  x double precision not null,
  y double precision not null,
  sailor text not null check (char_length(btrim(sailor)) between 1 and 32),
  created_at timestamptz not null default now()
);

alter table nullius.claims enable row level security;

create policy nullius_claims_read on nullius.claims
  for select to anon, authenticated using (true);

create policy nullius_claims_write_once on nullius.claims
  for insert to anon, authenticated with check (true);

grant usage on schema nullius to anon, authenticated;
grant select, insert on nullius.claims to anon, authenticated;

alter publication supabase_realtime add table nullius.claims;
