-- વર્ણી ધ્યાન — સંચાલક authority stops being a phone number anyone may type.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.effective_role()` (0004_rbac.sql:119) answers SUPER_ADMIN for any caller whose
-- profile carries one of three literal mobile numbers:
--
--     select 'SUPER_ADMIN'::public.admin_role
--     from public.profiles p
--     where p.id = auth.uid()
--       and p.mobile in ('9601269715', '9601269009', '9925842081')
--
-- That was written as a *bootstrap*: the founding accounts cannot be locked out of their
-- own panel by a bad `admin_profiles` row. The reasoning is sound. What it did not account
-- for is where `profiles.mobile` comes from.
--
-- It comes from the registration form. Nothing verifies it — there is no OTP anywhere in
-- this application, and `src/lib/auth.jsx` register() sends whatever was typed:
--
--     await supabase.auth.signUp({ email, password })          -- open, self-serve
--     await supabase.from('profiles').insert({ id: userId, …, mobile })
--
-- and the insert policy that governs it (0001_init.sql:201) is `with check (id = auth.uid())`
-- and nothing more. The column is UNIQUE and immutable *after* insert
-- (`profiles_guard_immutable`, 0001), so it cannot be changed later — but it can be *chosen*
-- freely on the way in, once, by anybody.
--
-- So the whole exploit is two ordinary requests, from a browser, with no session to start:
--
--     1. POST /auth/v1/signup                  { email, password }
--     2. POST /rest/v1/profiles                { …, mobile: '9601269715' }
--
-- and the second one succeeds for as long as no profile already holds that number. From
-- that moment `effective_role()` returns SUPER_ADMIN, which is the input to
-- `has_permission()`, which is what **every RLS policy in this schema** is written against:
-- every યુવક's name, mobile, email and progress becomes readable, દર્શન and settings become
-- writable, and `admin_profiles_guard()` (0004:537) will let the new SUPER_ADMIN grant
-- SUPER_ADMIN to anyone else.
--
-- The three numbers are not a secret that stands between an attacker and this. They are
-- compiled into the યુવક bundle — `shared/domain/constants.js` exports ADMIN_MOBILES,
-- `src/lib/auth.jsx` imports it for the cosmetic `isAdmin` flag, and the build lands them in
-- `dist/assets/constants-*.js`, which is served to every visitor.
--
-- The only thing standing in the way today is the UNIQUE index: whether each of the three
-- numbers already has a profile behind it. `npm run seed:admin:check` prints exactly that
-- and its own wording says what the gap is — "no profile yet (not an admin until one
-- exists)". A number with no profile is an unclaimed SUPER_ADMIN account.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- Keep the bootstrap. Stop deriving it from a value the client supplies.
--
-- The intent of 0004's fallback was "the people who founded this project keep their access
-- even if admin_profiles is wrong". That intent is about *particular accounts*, not about a
-- string. So the accounts are recorded here, once, at migration time — and from then on
-- `effective_role()` reads the record instead of re-deriving it from a column anyone can
-- claim.
--
--   * Whoever holds those numbers **right now** keeps exactly the access they have today.
--     Nobody is locked out and no panel behaviour changes for them.
--   * A profile registered **after** this migration carrying one of those numbers gets
--     nothing. The number is no longer authority; it is just a number.
--
-- Note what this does NOT do: it does not touch `admin_profiles`, `has_permission()`,
-- `permissions_for()`, the matrix, or a single RLS policy. The role model is sound and is
-- left alone. One input to it is replaced.
--
-- ── If the allowlist comes out empty ────────────────────────────────────────
--
-- Then no founding profile exists yet, `admin_profiles` was also seeded empty by 0004, and
-- this project has no administrator by either route — which was equally true before this
-- migration, except that the vacancy was fillable by whoever registered first. The supported
-- way to fill it is `scripts/seed-admin-supabase.mjs`, which runs server-side with the secret
-- key: `auth.uid()` is NULL there, so both guards below stand aside for it.
--
-- ⚠ WHOEVER APPLIES THIS MUST READ THE NOTICE IT RAISES. It prints the SMK, name and email
-- of every account being granted permanent SUPER_ADMIN. If a row on that list is not a person
-- who is supposed to have it, the escalation above has already been used, and applying this
-- migration would make that access permanent. Stop and remove the profile first.

-- ================================================================ the allowlist

create table public.bootstrap_admins (
  id       uuid primary key references public.profiles (id) on delete cascade,
  -- Kept for the audit trail only. Nothing reads it to decide anything — the primary key is
  -- the whole of the authority, which is the entire point of this file.
  mobile   text not null,
  noted_at timestamptz not null default now()
);

comment on table public.bootstrap_admins is
  'The founding accounts, resolved once at migration time from the §3 mobile list. Read by '
  'effective_role() as the lockout fallback that list used to be. Membership is by profile '
  'id, so registering a §3 number after 0024 grants nothing.';

-- RLS on with **no policy at all**: PostgREST can reach neither a select nor a write, for
-- any client role. Only SECURITY DEFINER functions running as the owner see this table, and
-- the only one that reads it is effective_role(). A readable allowlist would tell every
-- visitor which three accounts to attack.
alter table public.bootstrap_admins enable row level security;

revoke all on public.bootstrap_admins from anon, authenticated;

-- The one and only population of this table, and it happens with auth.uid() NULL — this is
-- the migration, not an act by any person.
insert into public.bootstrap_admins (id, mobile)
select p.id, p.mobile
from public.profiles p
where p.mobile in ('9601269715', '9601269009', '9925842081')
on conflict (id) do nothing;

-- Say out loud who was just made a permanent administrator. See the warning above.
do $$
declare
  r     record;
  n     integer;
begin
  select count(*) into n from public.bootstrap_admins;

  if n = 0 then
    raise notice '[0024] bootstrap allowlist is EMPTY — no §3 profile exists yet.';
    raise notice '[0024] This project has no administrator by mobile fallback. Use';
    raise notice '[0024]   SUPABASE_SECRET_KEY=… npm run seed:admin -- --email … --mobile …';
    raise notice '[0024] which runs as service_role and is unaffected by the guards below.';
  else
    raise notice '[0024] % account(s) granted permanent SUPER_ADMIN by allowlist:', n;
    for r in
      select b.mobile, p.smk, p.name, p.email, p.created_at
      from public.bootstrap_admins b
      join public.profiles p on p.id = b.id
      order by p.created_at
    loop
      raise notice '[0024]   %  %  %  <%>  registered %',
        r.mobile, r.smk, r.name, r.email, r.created_at;
    end loop;
    raise notice '[0024] If any row above is not a real સંચાલક, the registration escalation';
    raise notice '[0024] has already been used. Remove that profile and re-apply.';
  end if;
end
$$;

-- ================================================================ the fallback, rebound

-- Identical to 0004's function in every respect except where the second branch looks.
--
-- `admin_profiles` remains the ordinary path and is unchanged, ACTIVE check included. The
-- fallback below is still a fallback — it is asked only when there is no ACTIVE admin_profiles
-- row — and it still cannot be revoked from the panel, which is the lockout protection 0004
-- wanted. It simply no longer re-reads a client-supplied column to decide who qualifies.
create or replace function public.effective_role()
returns public.admin_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select ap.role
      from public.admin_profiles ap
      where ap.id = auth.uid()
        and ap.status = 'ACTIVE'
    ),
    (
      select 'SUPER_ADMIN'::public.admin_role
      from public.bootstrap_admins b
      where b.id = auth.uid()
    )
  );
$$;

comment on function public.effective_role() is
  'The role the caller is acting as, or NULL for an ordinary યુવક. admin_profiles first; then '
  'public.bootstrap_admins, which 0024 resolved once from the §3 mobile list. It does NOT read '
  'profiles.mobile: that column is chosen by the registrant and verified by nothing, so '
  'deriving authority from it made SUPER_ADMIN claimable with one INSERT (see 0024).';

-- ================================================================ squatting

-- Defence in depth, and a separate defect in its own right.
--
-- After the change above, registering with a §3 number grants nothing — so this trigger is
-- not what stops the escalation. What it stops is the other half: an attacker (or an ordinary
-- typo) *taking* a founder's number. `profiles.mobile` is UNIQUE and immutable, and it is the
-- identity `netlify/functions/login-mobile.js` resolves, so a squatted number cannot be freed
-- without deleting a row and cannot be used by the person it belongs to. That is a permanent
-- denial of service against the three accounts that matter most, available to anybody.
--
-- `auth.uid() is null` — a migration, or scripts/seed-admin-supabase.mjs running with the
-- secret key — passes through untouched. That is the documented way a founding account is
-- created, and it stays open.
create or replace function public.profiles_guard_reserved_mobile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.mobile in ('9601269715', '9601269009', '9925842081')
     and not exists (select 1 from public.bootstrap_admins b where b.id = new.id) then
    /*
      Raised as the UNIQUE violation this number would have produced had the account existed.

      Deliberate. `src/lib/auth.jsx` already maps `profiles_mobile_key` to "આ મોબાઈલ નંબરથી
      ખાતું પહેલેથી છે. લોગિન કરો." — so a reserved number and a genuinely taken one are
      indistinguishable from outside, and this endpoint cannot be used to discover which
      numbers are special. It also means no client change is needed: the message a visitor
      sees is one that already exists and already reads correctly in Gujarati.
    */
    raise exception 'duplicate key value violates unique constraint "profiles_mobile_key"'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_reserved_mobile() is
  'Refuses a browser-side INSERT claiming a §3 સંચાલક number. service_role and migrations '
  'pass through, which is how scripts/seed-admin-supabase.mjs still creates a founding '
  'account. Reported as profiles_mobile_key/23505 so the endpoint is not an oracle for which '
  'numbers are reserved.';

-- BEFORE INSERT only. The UPDATE path needs nothing: profiles_guard_immutable() (0001) has
-- always raised on any change to `mobile`.
create trigger profiles_guard_reserved_mobile
  before insert on public.profiles
  for each row execute function public.profiles_guard_reserved_mobile();
