-- વર્ણી ધ્યાન — initial schema
--
-- Replaces the Firestore model. Two things that were awkward in Firestore become
-- ordinary here, and the schema is shaped around that:
--
--   * SMK uniqueness was a companion `smkIndex` document claimed in a batch, because
--     Firestore has no unique constraint. It is now simply UNIQUE.
--   * §12's whole "one document per yuvak per day, bundle lists into single documents"
--     design existed to stay under 50,000 reads/day. Postgres has no such quota, so the
--     data is modelled by what it *is* rather than by what the biller counts.
--
-- Ownership is enforced by RLS on every table. There is no path that reads another
-- yuvak's row without being a સંચાલક (§13).

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,

  -- §4. SMK is three initials then three digits, unique across every yuvak (PGV881).
  smk           text not null unique check (smk ~ '^[A-Z]{3}[0-9]{3}$'),
  name          text not null check (length(trim(name)) > 0),
  email         text not null,
  -- Unique because it is the alternate login identifier, and because it decides who is
  -- a સંચાલક — two profiles sharing a number would make that ambiguous.
  mobile        text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),

  zone_id       text not null default 'surat',
  sub_zone_id   text not null check (sub_zone_id in ('vedroad', 'varachha', 'navsari')),

  -- §5 entry gate. Honour-system answers, recorded so the સંચાલક can see who said હા.
  like_answer     boolean not null default false,
  comment_answer  boolean not null default false,
  gate_passed_at  timestamptz,

  level4_unlocked boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.profiles.mobile is
  'Immutable after insert (see the trigger below): it decides admin access.';

-- ---------------------------------------------------------------- daily progress

create table public.progress (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- §9: everything resets at midnight IST and the day''s result is kept forever.
  date         date not null,
  level3_score integer not null default 0 check (level3_score >= 0),
  level4_score integer not null default 0 check (level4_score >= 0),
  updated_at   timestamptz not null default now(),
  primary key (user_id, date)
);

-- Deliberately no `<= 108` ceiling. The collection is 100 scenes today and grows to 109
-- the moment the સંચાલક writes the last nine વર્ણન; a hardcoded bound would start
-- rejecting honest writes on that day.

create index progress_date_idx on public.progress (date desc);

-- ---------------------------------------------------------------- learning journey

create type public.learning_stage as enum (
  'NOT_STARTED', 'VIDEO_DARSHAN', 'IMAGE_LEARNING', 'RECOGNITION',
  'SUBMITTED', 'PENDING_REVIEW', 'MEMORY_RECALL', 'COMPLETED'
);

create table public.learning_state (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  current_stage       public.learning_stage not null default 'NOT_STARTED',
  remembered_item_ids text[] not null default '{}',
  pending_item_ids    text[] not null default '{}',
  mastered_item_ids   text[] not null default '{}',
  completed_sessions  integer not null default 0 check (completed_sessions >= 0),
  updated_at          timestamptz not null default now()
);

-- §20 — submitted sessions are history and are never removed. The id is derived from the
-- user and the round, so a retried submit overwrites its own row rather than making two.
create table public.learning_sessions (
  id                  text primary key,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  remembered_item_ids text[] not null default '{}',
  pending_item_ids    text[] not null default '{}',
  total               integer not null check (total > 0),
  created_at          timestamptz not null default now()
);

create index learning_sessions_user_idx on public.learning_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------- content

create table public.scenes (
  id       text primary key,
  index    integer not null,
  "order"  integer not null,
  active   boolean not null default true,
  caption  text not null default '',
  updated_at timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit trail

-- §41, §42 — append-only. No update or delete policy exists for anyone, સંચાલક included:
-- a log an administrator can edit records nothing.
create table public.audit_logs (
  id        bigserial primary key,
  actor_id  uuid not null references public.profiles (id),
  action    text not null check (length(action) > 0),
  target_id text not null default '',
  meta      jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);

create index audit_logs_at_idx on public.audit_logs (at desc);

-- ---------------------------------------------------------------- who is a સંચાલક

-- §3, plus the developer account added 2026-08-11.
--
-- The list lives in this function rather than in a table on purpose: a table row is data
-- an attacker with a write path could add themselves to, whereas changing this requires a
-- migration. It mirrors the decision made in the Firestore rules.
--
-- SECURITY DEFINER matters for a second reason: this reads public.profiles, which has RLS
-- that itself calls is_admin(). Running as the owner bypasses RLS inside the function and
-- so avoids infinite recursion.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and mobile in ('9601269715', '9601269009', '9925842081')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- immutability

-- mobile, email and smk cannot change after insert.
--
-- mobile grants admin, email is the only password-recovery route, and smk is a member id
-- other records are matched against. In Firestore this was protectedUnchanged() in the
-- rules; here a trigger is the equivalent, and it applies to service_role too, which RLS
-- policies would not.
create or replace function public.profiles_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.mobile is distinct from old.mobile then
    raise exception 'mobile cannot be changed after registration';
  end if;
  if new.email is distinct from old.email then
    raise exception 'email cannot be changed after registration';
  end if;
  if new.smk is distinct from old.smk then
    raise exception 'smk cannot be changed after registration';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_guard_immutable
  before update on public.profiles
  for each row execute function public.profiles_guard_immutable();

-- ---------------------------------------------------------------- RLS

alter table public.profiles          enable row level security;
alter table public.progress          enable row level security;
alter table public.learning_state    enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.scenes            enable row level security;
alter table public.settings          enable row level security;
alter table public.audit_logs        enable row level security;

-- profiles ---------------------------------------------------------
create policy "own profile readable" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "own profile insertable" on public.profiles
  for insert with check (id = auth.uid());

create policy "own profile updatable" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- No delete policy: records are never removed — history is the point of the app.

-- progress ---------------------------------------------------------
create policy "own progress readable" on public.progress
  for select using (user_id = auth.uid() or public.is_admin());

create policy "own progress writable" on public.progress
  for insert with check (user_id = auth.uid());

create policy "own progress updatable" on public.progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- learning ---------------------------------------------------------
create policy "own learning readable" on public.learning_state
  for select using (user_id = auth.uid() or public.is_admin());

create policy "own learning writable" on public.learning_state
  for insert with check (user_id = auth.uid());

create policy "own learning updatable" on public.learning_state
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sessions readable" on public.learning_sessions
  for select using (user_id = auth.uid() or public.is_admin());

create policy "own sessions writable" on public.learning_sessions
  for insert with check (user_id = auth.uid());

create policy "own sessions updatable" on public.learning_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- content ----------------------------------------------------------
create policy "scenes readable by signed-in" on public.scenes
  for select to authenticated using (true);
create policy "scenes writable by admin" on public.scenes
  for all using (public.is_admin()) with check (public.is_admin());

create policy "settings readable by signed-in" on public.settings
  for select to authenticated using (true);
create policy "settings writable by admin" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- audit ------------------------------------------------------------
create policy "audit readable by admin" on public.audit_logs
  for select using (public.is_admin());

-- actor_id is pinned to the caller so an entry cannot be attributed to someone else.
create policy "audit appendable by admin" on public.audit_logs
  for insert with check (public.is_admin() and actor_id = auth.uid());

-- Deliberately no update or delete policy, for anyone.

-- ---------------------------------------------------------------- seed

insert into public.settings (key, value) values
  ('app', '{"youtubeUrl": null, "dhun": []}'::jsonb)
on conflict (key) do nothing;
