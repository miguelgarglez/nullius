-- nullius round 2: the ledger moves out of the public schema into the
-- product's own `nullius` schema (the shared Lab project gives each
-- product its own schema). The first ledger stays as it was — the new
-- table starts empty; nothing is copied.
--
-- Applied to a fresh project this is a no-op-safe upgrade: `if not
-- exists` on the schema and table, policy names dropped then recreated.

create schema if not exists nullius;

create table if not exists nullius.claims (
  feature_key text primary key,
  kind text not null check (kind in ('island','peak','bay','cape','lagoon','rock')),
  name text not null check (char_length(btrim(name)) between 2 and 48),
  x double precision not null,
  y double precision not null,
  sailor text not null check (char_length(btrim(sailor)) between 1 and 32),
  created_at timestamptz not null default now()
);

alter table nullius.claims enable row level security;

drop policy if exists nullius_claims_read on nullius.claims;
create policy nullius_claims_read on nullius.claims
  for select to anon, authenticated using (true);

drop policy if exists nullius_claims_write_once on nullius.claims;
create policy nullius_claims_write_once on nullius.claims
  for insert to anon, authenticated with check (true);

grant usage on schema nullius to anon, authenticated;
grant select, insert on nullius.claims to anon, authenticated;

-- publish the table for realtime inserts (no-op if already a member)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'nullius' and tablename = 'claims'
  ) then
    alter publication supabase_realtime add table nullius.claims;
  end if;
end $$;
