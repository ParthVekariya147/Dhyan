-- The parts of a Supabase project that are NOT in supabase/migrations, restated so the
-- migrations can be applied to a bare postgres:16 and exercised for real.
--
-- Why this file exists
-- --------------------
-- Every security claim this repository makes — "a યુવક cannot read another યુવક's
-- progress", "points are server-authoritative", "a forged completion is refused" — is a
-- claim about RLS policies and SECURITY DEFINER functions. None of it is testable from
-- JavaScript with a mocked Supabase client: a mock returns whatever the test author
-- decided it returns, so a suite built on one proves the mock and nothing else.
--
-- So the migrations are applied to a real Postgres, and the tests speak SQL as an ordinary
-- signed-in user with RLS enforced. What that needs is the surface Supabase provides and
-- the migrations assume:
--
--   * the three roles PostgREST connects as
--   * auth.uid(), read from the request's JWT claims exactly as Supabase reads it
--   * auth.users, which public.profiles references
--   * the storage schema, which 0007_dhun_storage.sql writes policies against
--   * pgcrypto, requested by one migration
--
-- Nothing here is invented behaviour. Where Supabase's own definition is short enough to
-- restate exactly (auth.uid()), it is restated exactly; where it is not (storage), only
-- the shape the migrations touch is created, because a policy on a table that does not
-- exist is a migration that fails to apply and a test suite that never runs.

-- ---------------------------------------------------------------- roles
--
-- PostgREST switches to one of these per request. `authenticated` is what a signed-in
-- browser is, and it is the role every RLS test below runs as — RLS is not enforced for
-- the table owner, so a test that stayed superuser would pass every policy it was written
-- to check.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

/*
  Tables and sequences are granted to the client roles by default on a Supabase project, and
  they have to be: RLS is a *filter* applied on top of a privilege, not a substitute for one.
  Without these grants every policy in this schema would be untestable, because the statement
  would be refused before any policy was consulted — and the suite would then pass for the
  wrong reason, reporting "refused" everywhere while proving nothing about the policies.

  FUNCTIONS ARE DELIBERATELY NOT LISTED HERE, and getting this wrong is how a security suite
  tells a comfortable lie. If `alter default privileges … on functions` granted EXECUTE to
  anon and authenticated, then the `revoke all on function … from public` that most migrations
  in this repository use would revoke only the PUBLIC pseudo-role and leave the explicit grant
  standing — so `award_points()`, `level4_activity_states(p_user)` and every other helper that
  takes somebody else's uuid would be callable by any signed-in યુવક, and this file would have
  manufactured that hole itself.

  The repository settles it. `0015_level4_gate_setting_grant.sql` exists for one reason: 0014
  revoked `level4_gate_setting()` from `public` and did not grant it to `authenticated`, and
  every select from `profiles_level4` then raised `permission denied for function
  level4_gate_setting`. That could not have happened if `authenticated` held a default-privilege
  grant. So on this project a function created by a migration is reachable only where a
  migration says `grant execute … to authenticated`, and that is what is reproduced here.
*/
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- auth

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- public.profiles.id references this. Supabase's real table has thirty columns; the
-- migrations touch none of them, so the primary key is the whole of what matters.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

/*
  auth.uid() — Supabase's own definition.

  It reads the `sub` claim of the request's JWT, which PostgREST places in the
  `request.jwt.claims` GUC before running the statement. Tests set that GUC directly, which
  is the same thing from the database's point of view: there is no code path in which a
  policy learns who the caller is by any other means.

  `true` as the second argument to current_setting is what makes an unauthenticated request
  work rather than raise — with no claims set at all this returns NULL, which is precisely
  the "anonymous" case several guards in the migrations test for.
*/
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- storage
--
-- 0007_dhun_storage.sql creates a bucket and four policies on storage.objects. Only the
-- columns those policies name are needed; the rest of Supabase's storage schema is not
-- part of any claim this suite makes.

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
