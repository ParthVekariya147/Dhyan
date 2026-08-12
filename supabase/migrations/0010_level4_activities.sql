-- ================================================================================
-- લેવલ ૪ becomes a container: sub-levels the સંચાલક composes, and a progression the
-- browser cannot forge.
--
-- What this replaces
-- ------------------
-- લેવલ ૪ was a flat list of every દ્રશ્ય with a 'જવાબ જુઓ' reveal beside each one. Two
-- things were wrong with it and neither could be fixed in the client. First, the whole
-- collection at once is not a practice, it is an inventory — there was no order in which
-- a યુવક was meant to meet it, and nothing that said "you have finished this much".
-- Second, the reveal put the answer on the same screen as the question, so the level
-- scored honesty rather than memory.
--
-- What replaces it is data: a **configuration** the સંચાલક builds, holding **activities**
-- (૪.૧, ૪.૨, …), each holding an ordered list of દ્રશ્યો. The યુવક opens ૪.૧, ticks the
-- numbers he can place, and passing it opens ૪.૨ — forever.
--
-- The three decisions this schema is shaped by
-- --------------------------------------------
--   1. **Completion is permanent, and the day is still scored.** A passed activity is
--      never taken away (§1 rule 4 — ફક્ત આનંદ, નિરાશા નહીં), so the midnight reset (§9)
--      cannot touch it; but every attempt also writes `progress.level4_score` for the IST
--      day, so the સંચાલક dashboard that reads that column keeps working unchanged.
--
--   2. **LOCKED and AVAILABLE are derived, never stored.** A stored lock is a lock that
--      can drift: reorder two activities and every row that said LOCKED is now a lie about
--      a different position. Only what actually happened is a row — an attempt, a pass, a
--      revision — and everything else is computed from it by the functions below. §2.2 of
--      LEVEL4.md fixes those rules and shared/domain/level4.js mirrors them for the UI.
--
--   3. **The RPCs are the only writer.** `level4_activity_progress` and `level4_attempts`
--      have a read policy and **no insert or update policy at all**, for anybody. A યુવક
--      cannot PATCH himself a COMPLETED row the way 0008 described him PATCHing
--      `level4_unlocked` — there is no write path to take. The SECURITY DEFINER functions
--      here are the whole of it (§37).
--
-- The sparse-overlay trade
-- -----------------------
-- `level4_activity_items.scene_id` is `text` with **no foreign key to public.scenes**, and
-- that is deliberate (LEVEL4.md §1). `public.scenes` is an *overlay*: a દ્રશ્ય the સંચાલક
-- has never edited has no row there at all, and most have not been edited. A FK would
-- therefore reject the majority of legitimate selections. The identity a scene_id points
-- at is the manifest's (`content/darshan.json` + the overlay, joined by
-- shared/domain/darshan.js), and membership is validated against that *effective*
-- collection in shared/domain/level4-selection.js — in the panel, at save and at publish.
-- Do not "fix" this by adding the constraint.
--
-- The other half of that trade is that the overlay's *withholding* must still be honoured,
-- and it is: `level4_effective_items()` below is the single reader of an activity's
-- contents, and it drops any દ્રશ્ય the સંચાલક has withheld. Every function in this file
-- goes through it, so the app and the database cannot disagree about what an activity
-- contains — which, if they did, would make the activity impossible to pass.
--
-- `gen_random_uuid()` is used below and no earlier migration needed a uuid default. It is
-- in `pg_catalog` from PostgreSQL 13 onward and needs no extension on Supabase; if this
-- file is ever replayed onto an older server, `create extension pgcrypto` is the fix.
-- ================================================================================

-- ================================================================ the configuration

-- One row is what the app is running; every other row is history or work in progress.
--
-- Versioned rather than edited in place, for the reason §10 gives: a યુવક's progress is
-- recorded against activity ids, so changing what an activity *contains* while people are
-- part-way through it silently changes what they were credited for. A published
-- configuration is therefore frozen (see level4_guard_editable() below) and
-- `level4_clone_config()` is how it is edited — deep-copied into a new DRAFT that can be
-- built up and published atomically when it is ready.
create table public.level4_configs (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  status         text not null default 'DRAFT'
                 check (status in ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED')),
  title          text not null default '',

  -- §7's gate, made the સંચાલક's to set instead of the code's. The defaults reproduce
  -- today's behaviour exactly: લેવલ ૪ opens at ૮૦ ticks in one day at લેવલ ૩, which is
  -- what 0008's trigger already enforces on `profiles.level4_unlocked`. That trigger is
  -- untouched by this migration — this is a second, per-configuration gate, and turning
  -- `require_gate` off opens the activities to anyone who reaches the page.
  require_gate   boolean not null default true,
  gate_threshold integer not null default 80 check (gate_threshold >= 0),

  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id),
  published_at timestamptz,
  published_by uuid references public.profiles (id)
);

-- At most one PUBLISHED row, ever — enforced here rather than by the publish function
-- being careful. `level4_published_config()` and `level4_state()` both do
-- `where status = 'PUBLISHED'` with no ORDER BY and no LIMIT, and a second published row
-- would make them return an arbitrary one of the two.
create unique index level4_one_published on public.level4_configs (status)
  where status = 'PUBLISHED';

comment on table public.level4_configs is
  'A version of લેવલ ૪. Exactly one row is PUBLISHED at a time; that row is what every '
  'યુવક sees. Edit a published version by cloning it (level4_clone_config), never in place.';

comment on column public.level4_configs.updated_at is
  'Stamped by level4_configs_stamp() on every update. It is also the concurrency token: a '
  'caller that read the row at T sends its PATCH with `.eq(''updated_at'', T)`, and gets '
  'zero rows back if somebody else saved first — instead of silently overwriting them.';

-- ================================================================ the activities

-- ૪.૧, ૪.૨, … — a sub-level, and the unit a યુવક passes.
create table public.level4_activities (
  id          uuid primary key default gen_random_uuid(),
  config_id   uuid not null references public.level4_configs (id) on delete cascade,

  -- '4.1'. Stored rather than derived from `position` because it is the name the યુવક
  -- learns the activity by: renumbering after a reorder would rename ૪.૩ to ૪.૨ under
  -- someone who had already passed it.
  code        text not null check (code ~ '^[0-9]+\.[0-9]+$'),
  title       text not null default '',
  description text not null default '',

  -- Presentation order, and therefore the unlock order: an activity is LOCKED while any
  -- active activity below it is unfinished.
  position    integer not null check (position > 0),

  -- Withheld, not deleted (§28). An inactive activity leaves every progress row it earned
  -- in place — including the scene coverage that carries a યુવક across a version change.
  active      boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- §7 C — one ૪.૨ per configuration.
  constraint level4_activities_code_unique unique (config_id, code),

  -- Deferrable because a reorder is a permutation: swapping two positions passes through a
  -- state where both rows hold the same number. DEFERRABLE INITIALLY DEFERRED means the
  -- check happens once, at commit, so the whole permutation is judged rather than each row.
  -- It only helps inside ONE transaction — PostgREST wraps one request in one transaction,
  -- so a reorder must be sent as a single bulk upsert, not a loop of PATCHes.
  constraint level4_activities_position_unique unique (config_id, position)
    deferrable initially deferred
);

create index level4_activities_config_idx on public.level4_activities (config_id, position);

comment on column public.level4_activities.code is
  'The name the યુવક sees (rendered ૪.૧ through gu()). Independent of `position` on '
  'purpose: reordering must not rename an activity somebody has already passed.';

-- Which દર્શન an activity is made of, in the order the સંચાલક arranged them (§26).
--
-- No surrogate key: the pair *is* the fact, and making (activity_id, scene_id) the primary
-- key is what enforces §7 A — the same દ્રશ્ય cannot be listed twice within one activity.
-- Across activities it may repeat, which is a valid thing to want (a revision activity that
-- re-covers earlier ground); shared/domain/level4-selection.js is what warns about it.
create table public.level4_activity_items (
  activity_id uuid not null references public.level4_activities (id) on delete cascade,
  scene_id    text not null,
  position    integer not null check (position > 0),

  primary key (activity_id, scene_id),

  -- Deferred for the same reason as above: setActivityItems() rewrites the whole list.
  constraint level4_activity_items_position_unique unique (activity_id, position)
    deferrable initially deferred
);

comment on column public.level4_activity_items.scene_id is
  'public.scenes.id, but with NO foreign key — see the header. public.scenes is a sparse '
  'overlay and most દ્રશ્યો have no row in it; a FK would reject them. Validity is checked '
  'against the effective collection in shared/domain/level4-selection.js.';

-- ================================================================ what a યુવક has done

-- One row per (યુવક, activity), and only for activities he has actually touched.
--
-- LOCKED and AVAILABLE are **not** here. No row means "not started", and everything a
-- client needs beyond that is derived by level4_activity_states() from these rows plus the
-- activity order. Storing a lock would mean rewriting every row whenever the સંચાલક
-- reorders — and being wrong in between.
create table public.level4_activity_progress (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.level4_activities (id) on delete cascade,

  -- Denormalised from the activity so that "which version was this earned under" is
  -- answerable without joining through an activity that may since have been deactivated.
  config_id   uuid not null references public.level4_configs (id) on delete cascade,

  status      text not null default 'IN_PROGRESS'
              check (status in ('IN_PROGRESS', 'REVISION_REQUIRED', 'COMPLETED')),

  attempt_count  integer not null default 0 check (attempt_count >= 0),
  revision_count integer not null default 0 check (revision_count >= 0),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),

  primary key (user_id, activity_id)
);

create index level4_progress_activity_idx on public.level4_activity_progress (activity_id);
create index level4_progress_config_idx   on public.level4_activity_progress (config_id, user_id);

comment on table public.level4_activity_progress is
  'Written only by level4_submit() and level4_mark_revision(). There is no insert or '
  'update policy on this table for any client role — that is what makes progression '
  'unforgeable rather than merely inconvenient to forge (§37).';

-- Every attempt, kept. §41's argument for the audit trail applies to a યુવક's own record
-- too: the progress row says where he is, and these rows say how he got there — which is
-- what the daily score is recomputed from, and the only place a disputed score can be
-- checked against.
create table public.level4_attempts (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.level4_activities (id) on delete cascade,
  config_id   uuid not null references public.level4_configs (id) on delete cascade,

  -- What counted: the submission intersected with the activity's own item list. A client
  -- that posts a દ્રશ્ય the activity does not contain has not ticked anything, so recording
  -- the raw payload would make the row disagree with `selected_count` beside it.
  selected_scene_ids text[] not null default '{}',
  selected_count integer not null check (selected_count >= 0),
  required_count integer not null check (required_count >= 0),
  passed         boolean not null,
  at             timestamptz not null default now()
);

create index level4_attempts_user_idx     on public.level4_attempts (user_id, at desc);
create index level4_attempts_activity_idx on public.level4_attempts (activity_id, at desc);

-- ================================================================ the derivation rules
--
-- LEVEL4.md §2.2, in SQL. shared/domain/level4.js holds the same four rules in JavaScript
-- for optimistic rendering; this side is the authority and the client's copy is a guess
-- that the next level4_state() call corrects.
--
-- All three take a uid and are SECURITY DEFINER, so — exactly as 0008 argued for
-- has_earned_level4() — none of them is granted to `authenticated`. An execute grant would
-- turn them into a way to ask questions about *another* યુવક, which §13 refuses. Their only
-- callers are the RPCs below, which run as the owner and need no grant.

-- What an activity actually contains, right now — its items minus anything the સંચાલક has
-- withheld.
--
-- Why this exists at all
-- ---------------------
-- `src/lib/useScenes.js` drops a withheld દ્રશ્ય from the collection, so it is gone from the
-- test screen and from revision. Without this function `level4_submit` would go on counting
-- it in `required`, |selected| could never reach |required|, and the activity would be
-- **permanently unpassable** — taking every activity after it down with it. A યુવક stuck
-- forever, by an act of the સંચાલક's, with nothing on screen able to explain it: the exact
-- opposite of §1 rule 4. One reader of an activity's contents, used by everything, is what
-- makes that impossible rather than merely unlikely.
--
-- The rule is `useScenes()`'s rule, and is copied from it deliberately
-- ------------------------------------------------------------------
-- A row whose `active` is false, or whose `status` is not PUBLISHED/ACTIVE, is withheld —
-- those are exactly the states 0004's `scenes_sync_status` trigger derives `active` from,
-- so this is the database's own definition of visible and not a second opinion about it.
--
-- **A scene_id with no row is included**, and that is the whole subtlety. `public.scenes`
-- is sparse: no migration seeds it and the panel writes only the row it is editing, so most
-- દ્રશ્યો have never had a row. Absence means the સંચાલક has never ruled on that દ્રશ્ય, not
-- that he withheld it — withholding is a deliberate act and leaves a row to prove it.
-- Requiring a row here would empty every activity at once.
--
-- What it deliberately does NOT apply is `isLearnable` — the second gate in useScenes(),
-- which needs a master image and a વર્ણન. That lives in the manifest
-- (`content/darshan.json`), which the database cannot see. It is enforced instead where the
-- selection is made: shared/domain/level4-selection.js refuses an item that is not
-- learnable (§7 D), in the panel, at save and at publish.
create or replace function public.level4_effective_items(p_activity_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(i.scene_id order by i.position), '{}'::text[])
  from public.level4_activity_items i
  where i.activity_id = p_activity_id
    and not exists (
      select 1
      from public.scenes s
      where s.id = i.scene_id
        and (not s.active or coalesce(s.status, 'ACTIVE') not in ('PUBLISHED', 'ACTIVE'))
    );
$$;

revoke all on function public.level4_effective_items(uuid) from public;

comment on function public.level4_effective_items(uuid) is
  'An activity''s દ્રશ્યો minus the ones the સંચાલક has withheld — the single definition of '
  '"what this activity contains" for every other function here. A scene_id with no row in '
  'public.scenes is included: the overlay is sparse and absence is not withholding.';

-- covered(user) — every દ્રશ્ય inside every activity this યુવક has an explicit COMPLETED
-- row for, in any configuration, of any version.
--
-- "any version" is the whole point (decision #4). When the સંચાલક publishes a new
-- arrangement of the same દર્શન, a યુવક who had passed ૪.૧ and ૪.૨ of the old one does not
-- start again: the new activities whose contents he has already covered count as done, and
-- only genuinely new ground is asked of him. Nothing is lost and nothing is falsely
-- credited, because coverage is per-દ્રશ્ય and not per-activity.
--
-- Through level4_effective_items(), so that both sides of the ⊆ test below shrink by the
-- same set when a દ્રશ્ય is withheld. That is what keeps a completion from evaporating:
-- if items(a) ⊆ covered before, then items(a) \ withheld ⊆ covered \ withheld after —
-- the subset relation survives the withdrawal because the same ids left both sides.
create or replace function public.level4_covered_scene_ids(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct covered.scene_id), '{}'::text[])
  from public.level4_activity_progress pr
  cross join lateral unnest(public.level4_effective_items(pr.activity_id)) as covered(scene_id)
  where pr.user_id = p_user
    and pr.status = 'COMPLETED';
$$;

revoke all on function public.level4_covered_scene_ids(uuid) from public;

-- gateOpen(user, config) — has this યુવક ever had a qualifying લેવલ ૩ day?
--
-- Deliberately the same shape as 0008's has_earned_level4(): "ever", on a single date,
-- never summed across days. It reads the configuration's own threshold rather than
-- level4_unlock_threshold(), because decision #3 put that number in the સંચાલક's hands —
-- the default of 80 is what makes the two agree out of the box.
--
-- coalesce(..., false) rather than a null for an unknown configuration: a caller asking
-- about a config that does not exist is asking about a gate that is not open.
create or replace function public.level4_gate_open(p_user uuid, p_config uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (not c.require_gate)
        or exists (
             select 1
             from public.progress p
             where p.user_id = p_user
               and p.level3_score >= c.gate_threshold
           )
    from public.level4_configs c
    where c.id = p_config
  ), false);
$$;

revoke all on function public.level4_gate_open(uuid, uuid) from public;

-- completed(user, activity), for every activity in a configuration at once.
--
--   explicit COMPLETED row  OR  (items ≠ ∅ AND items ⊆ covered)
--
-- The `items ≠ ∅` half is not defensive noise. An activity with no items would otherwise
-- satisfy "every item is covered" vacuously, and a સંચાલક mid-way through building ૪.૫
-- would find that every યુવક had already passed it. `level4_publish()` refuses to publish
-- such an activity for the same reason; this is the second lock on the same door. It is
-- also what an activity whose every દ્રશ્ય has been withheld now looks like — see
-- level4_activity_states() for what becomes of it.
--
-- The explicit row is tested FIRST and alone. An activity a યુવક has actually passed stays
-- passed whatever later happens to its contents — it is not re-derived from coverage, so
-- there is no arrangement of withheld દ્રશ્યો that can make this branch stop being true.
create or replace function public.level4_completed_activity_ids(p_user uuid, p_config uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with cov as (select public.level4_covered_scene_ids(p_user) as ids)
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.level4_activities a
  cross join cov
  cross join lateral (select public.level4_effective_items(a.id) as ids) eff
  where a.config_id = p_config
    and (
      exists (
        select 1
        from public.level4_activity_progress pr
        where pr.user_id = p_user
          and pr.activity_id = a.id
          and pr.status = 'COMPLETED'
      )
      or (
        -- `<@` is "contained by", and it is true for an empty left-hand array — which is
        -- why the cardinality test comes first and not as an afterthought.
        cardinality(eff.ids) > 0
        and eff.ids <@ cov.ids
      )
    );
$$;

revoke all on function public.level4_completed_activity_ids(uuid, uuid) from public;

-- status(user, activity) for the whole configuration, in one pass.
--
-- The order of the branches is the rule and is not interchangeable: the gate is asked
-- first so that a યુવક who has not reached લેવલ ૪ sees a wholly locked page, and COMPLETED
-- is asked before the position check so that an activity he has already passed is never
-- re-locked by a later reordering that put something unfinished in front of it.
--
-- `completed_at` is null for an activity credited through coverage rather than by an
-- attempt of its own. That is honest — there was no moment at which he completed *this*
-- activity — and the UI must treat the status, not the timestamp, as the answer.
--
-- An activity whose every દ્રશ્ય has been withheld is not listed
-- ------------------------------------------------------------
-- `cardinality(eff.ids) > 0` drops it, exactly as `a.active` drops a withheld activity.
-- The alternatives are both worse. Listing it as AVAILABLE hands the યુવક a test with
-- nothing in it that can never be passed, and — because an unfinished activity locks the
-- ones after it — freezes the rest of લેવલ ૪ behind an empty screen. Treating it as passed
-- credits him with a ધ્યાન he never did, which decision #4 is careful never to do.
--
-- So it leaves, for as long as its contents are gone, the same way its દ્રશ્યો left
-- `useScenes()` — and it takes nothing with it. The progress row stays, its coverage still
-- counts toward every other activity, and restoring one દ્રશ્ય brings the card back exactly
-- as it was, COMPLETED included. Nothing is deleted and no status is ever lowered; the
-- journey simply does not ask for something that is not there. The same test is applied by
-- level4_published_config(), so both halves of what the app renders agree.
--
-- It is dropped even when the યુવક has completed it, which looks like the harsher choice
-- and is the safer one: the two functions must select the same activities from the same
-- user-independent rule, or the app would be merging a list of activities against a list of
-- statuses that do not correspond.
create or replace function public.level4_activity_states(p_user uuid, p_config uuid)
returns table (
  activity_id    uuid,
  pos            integer,
  status         text,
  attempt_count  integer,
  revision_count integer,
  completed_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with done as (select public.level4_completed_activity_ids(p_user, p_config) as ids),
       gate as (select public.level4_gate_open(p_user, p_config) as is_open),
       act  as (
         select a.id,
                a.position                      as p,
                a.id = any(done.ids)            as is_done,
                pr.status                       as explicit_status,
                coalesce(pr.attempt_count, 0)   as attempts,
                coalesce(pr.revision_count, 0)  as revisions,
                pr.completed_at
         from public.level4_activities a
         cross join done
         cross join lateral (select public.level4_effective_items(a.id) as ids) eff
         left join public.level4_activity_progress pr
                on pr.activity_id = a.id
               and pr.user_id = p_user
         where a.config_id = p_config
           and a.active
           and cardinality(eff.ids) > 0
       )
  select act.id,
         act.p,
         case
           when not (select is_open from gate) then 'LOCKED'
           when act.is_done                    then 'COMPLETED'
           when exists (
                  select 1 from act prev
                  where prev.p < act.p and not prev.is_done
                )                              then 'LOCKED'
           when act.explicit_status in ('REVISION_REQUIRED', 'IN_PROGRESS')
                                               then act.explicit_status
           else 'AVAILABLE'
         end,
         act.attempts,
         act.revisions,
         act.completed_at
  from act
  order by act.p;
$$;

revoke all on function public.level4_activity_states(uuid, uuid) from public;

-- ================================================================ reading, from the app

-- The published configuration, whole, in one round trip.
--
-- `where status = 'PUBLISHED'` is the only filter and there is no argument, so no DRAFT
-- ever leaves the database through this function however it is called (§9). That matters
-- more than it looks: a DRAFT is the સંચાલક thinking out loud, and a યુવક who could read
-- one would see activities that may never exist.
--
-- Returns null when nothing is published — a legitimate state on the day the panel is
-- first opened, not an error. The client renders લેવલ ૪ as "coming soon", never as broken.
create or replace function public.level4_published_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',            c.id,
    'version',       c.version,
    'title',         c.title,
    'requireGate',   c.require_gate,
    'gateThreshold', c.gate_threshold,
    'publishedAt',   c.published_at,
    'activities', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',          a.id,
                 'code',        a.code,
                 'title',       a.title,
                 'description', a.description,
                 'position',    a.position,
                 -- The effective list, so the test screen asks for exactly what
                 -- level4_submit() will require. Anything else and a withheld દ્રશ્ય is a
                 -- checkbox that cannot be ticked or a requirement that cannot be met.
                 'sceneIds', to_jsonb(public.level4_effective_items(a.id))
               )
               order by a.position
             )
      from public.level4_activities a
      where a.config_id = c.id
        and a.active
        -- Nothing left to ask: not listed, for as long as that is true. See
        -- level4_activity_states(), which drops the same activities by the same test.
        and cardinality(public.level4_effective_items(a.id)) > 0
    ), '[]'::jsonb)
  )
  from public.level4_configs c
  where c.status = 'PUBLISHED';
$$;

revoke all on function public.level4_published_config() from public;
grant execute on function public.level4_published_config() to authenticated;

-- The caller's own derived state. Never takes a uid — auth.uid() is the only subject this
-- function will discuss, so there is no argument to tamper with and no row to leak.
--
-- `coveredSceneIds` is included so the client can run the same derivation locally between
-- calls (shared/domain/level4.js). It is the caller's own coverage and nobody else's.
create or replace function public.level4_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  cfg    public.level4_configs%rowtype;
  result jsonb;
begin
  if uid is null then
    return null;
  end if;

  select * into cfg from public.level4_configs where status = 'PUBLISHED';
  if not found then
    return null;
  end if;

  -- One row out of an aggregate over zero rows is still one row, so a configuration whose
  -- activities are all inactive answers with an empty list rather than with null.
  select jsonb_build_object(
    'configId',        cfg.id,
    'version',         cfg.version,
    'requireGate',     cfg.require_gate,
    'gateThreshold',   cfg.gate_threshold,
    'gateOpen',        public.level4_gate_open(uid, cfg.id),
    'coveredSceneIds', to_jsonb(public.level4_covered_scene_ids(uid)),
    'allComplete',     coalesce(bool_and(s.status = 'COMPLETED'), false),
    'activities', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',            s.activity_id,
          'status',        s.status,
          'attemptCount',  s.attempt_count,
          'revisionCount', s.revision_count,
          'completedAt',   s.completed_at
        )
        order by s.pos
      ), '[]'::jsonb)
  )
  into result
  from public.level4_activity_states(uid, cfg.id) s;

  return result;
end;
$$;

revoke all on function public.level4_state() from public;
grant execute on function public.level4_state() to authenticated;

-- ================================================================ writing, from the app

-- The only way an attempt exists.
--
-- Eight steps, and the first three are the ones that make §37 true. Each raises its own
-- message so the client can tell a closed gate from a locked activity from a configuration
-- that was archived while the page was open — three situations that need three different
-- Gujarati sentences, none of which is an error message about the database.
--
--   level4_not_signed_in — no auth.uid(); the session expired mid-page.
--   level4_not_active    — the account is SUSPENDED or DISABLED (§7 of the governance
--                          spec). SECURITY DEFINER bypasses RLS, so the lifecycle that
--                          "own progress writable" enforces for every other write has to
--                          be asked for explicitly here, or this function would be the one
--                          hole in it.
--   level4_not_published — the activity is gone, inactive, or belongs to a version that is
--                          no longer the published one. Reload and start again.
--   level4_gate_closed   — લેવલ ૩ has not been reached yet.
--   level4_locked        — an earlier activity is unfinished.
--
-- What it deliberately does NOT do is compare answers. Passing is "every દ્રશ્ય in this
-- activity was ticked" (§15) — the numbers ticked are intersected with the required list,
-- and nothing anywhere judges whether the યુવક was *right* about a particular one. There
-- is no wrong answer in this design, only ground not yet covered.
create or replace function public.level4_submit(p_activity_id uuid, p_selected text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid          uuid := auth.uid();
  act          public.level4_activities%rowtype;
  cfg          public.level4_configs%rowtype;
  done_ids     uuid[];
  required_ids text[];
  selected_ids text[];
  required_n   integer;
  selected_n   integer;
  did_pass     boolean;
  new_status   text;
  attempts     integer;
  next_id      uuid;
  today        date := timezone('Asia/Kolkata', now())::date;
  day_score    integer;
begin
  if uid is null then
    raise exception 'level4_not_signed_in';
  end if;

  -- 0. The account is still ACTIVE. See the note above on why this is asked here.
  if not public.is_active_user() then
    raise exception 'level4_not_active';
  end if;

  -- 1. The activity exists, is active, and belongs to the PUBLISHED configuration.
  --    All three in one query: any of them failing means the same thing to the યુવક —
  --    what he is looking at is not what the app is running any more.
  select a.* into act
  from public.level4_activities a
  join public.level4_configs c on c.id = a.config_id
  where a.id = p_activity_id
    and a.active
    and c.status = 'PUBLISHED';

  if not found then
    raise exception 'level4_not_published';
  end if;

  select * into cfg from public.level4_configs where id = act.config_id;

  -- 2. The gate.
  if not public.level4_gate_open(uid, cfg.id) then
    raise exception 'level4_gate_closed';
  end if;

  -- 3. Everything below this activity is finished.
  --
  --    The completed set is fetched once into a variable rather than called inside the
  --    EXISTS: it is STABLE, so the planner *may* fold it, but "may" is not a promise, and
  --    it walks every item of every activity each time it runs.
  --
  --    The last condition of the EXISTS is the one to read twice: an activity whose every
  --    દ્રશ્ય has been withheld asks for nothing, so it cannot be passed and therefore must
  --    not be allowed to block. Without it, withholding a handful of images would shut
  --    every યુવક out of the rest of લેવલ ૪ with no way forward — the same trap
  --    level4_activity_states() keeps such an activity off the page to avoid.
  done_ids := public.level4_completed_activity_ids(uid, cfg.id);

  if exists (
    select 1
    from public.level4_activities prev
    where prev.config_id = act.config_id
      and prev.active
      and prev.position < act.position
      and not (prev.id = any(done_ids))
      and cardinality(public.level4_effective_items(prev.id)) > 0
  ) then
    raise exception 'level4_locked';
  end if;

  -- 4. required := what the activity effectively contains — its items minus anything the
  --    સંચાલક has withheld, which is precisely the list the test screen drew its checkboxes
  --    from. selected := what was ticked, distinct, intersected with required. Duplicates
  --    and unknown ids are dropped rather than rejected: a client that sends them is buggy,
  --    not malicious, and failing the યુવક for it would break §1 rule 4 over something he
  --    did not do.
  required_ids := public.level4_effective_items(act.id);

  select coalesce(array_agg(distinct sel.scene_id), '{}'::text[])
    into selected_ids
  from unnest(coalesce(p_selected, '{}'::text[])) as sel(scene_id)
  where sel.scene_id = any(required_ids);

  required_n := coalesce(array_length(required_ids, 1), 0);
  selected_n := coalesce(array_length(selected_ids, 1), 0);

  -- 5. Passing is covering all of it. `required_n > 0` keeps an activity with nothing in
  --    it — one still being built, or one whose every દ્રશ્ય is currently withheld — from
  --    being passed by submitting nothing. Such an activity is not offered on the page at
  --    all, so this is the floor under that, not the thing the યુવક meets.
  did_pass := (selected_n = required_n and required_n > 0);

  -- 6. The attempt, always recorded, passed or not.
  insert into public.level4_attempts
    (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed)
  values
    (uid, act.id, act.config_id, selected_ids, selected_n, required_n, did_pass);

  -- 7. The progress row.
  --
  --    A COMPLETED row is never demoted. §1 rule 4 is unconditional about this: a યુવક who
  --    passed ૪.૨ in March and reopens it in June to practise has not un-passed it by
  --    ticking eleven of twelve. `completed_at` is coalesced for the same reason — the
  --    first pass is the one that happened.
  insert into public.level4_activity_progress
    (user_id, activity_id, config_id, status, attempt_count, completed_at, updated_at)
  values
    (uid, act.id, act.config_id,
     case when did_pass then 'COMPLETED' else 'REVISION_REQUIRED' end,
     1,
     case when did_pass then now() end,
     now())
  on conflict (user_id, activity_id) do update
    set attempt_count = level4_activity_progress.attempt_count + 1,
        status = case
                   when level4_activity_progress.status = 'COMPLETED' then 'COMPLETED'
                   else excluded.status
                 end,
        completed_at = coalesce(level4_activity_progress.completed_at, excluded.completed_at),
        updated_at = now()
  returning attempt_count, status into attempts, new_status;

  -- 8. The day's score (decision #2).
  --
  --    Counted from the attempts themselves rather than incremented, so a retry, a double
  --    submit or a lost response cannot inflate it — the answer is a property of the day's
  --    rows, not of how many times this function ran. `greatest` on the way in because
  --    `progress` is also written by તબક્કો ૩ and by future levels: a banked score is
  --    never lowered by anything here, including a day whose earlier attempts covered more.
  select count(distinct ticked.scene_id)
    into day_score
  from public.level4_attempts att
  cross join lateral unnest(att.selected_scene_ids) as ticked(scene_id)
  where att.user_id = uid
    and timezone('Asia/Kolkata', att.at)::date = today;

  insert into public.progress (user_id, date, level4_score, updated_at)
  values (uid, today, day_score, now())
  on conflict (user_id, date) do update
    set level4_score = greatest(progress.level4_score, excluded.level4_score),
        updated_at = now();

  -- 9. Where to go next: the lowest-positioned active activity that is still unfinished
  --    after this attempt. Null when everything is done — the page shows the completion
  --    state instead of pushing him onward.
  if did_pass then
    done_ids := public.level4_completed_activity_ids(uid, cfg.id);

    select a.id into next_id
    from public.level4_activities a
    where a.config_id = cfg.id
      and a.active
      and a.position > act.position
      and not (a.id = any(done_ids))
    order by a.position
    limit 1;
  end if;

  return jsonb_build_object(
    'passed',         did_pass,
    'selectedCount',  selected_n,
    'requiredCount',  required_n,
    'status',         new_status,
    'attemptCount',   attempts,
    'nextActivityId', next_id
  );
end;
$$;

revoke all on function public.level4_submit(uuid, text[]) from public;
grant execute on function public.level4_submit(uuid, text[]) to authenticated;

comment on function public.level4_submit(uuid, text[]) is
  'The only writer of level4_attempts and level4_activity_progress, and the only way a '
  'લેવલ ૪ activity is ever completed. Neither table has an insert or update policy for any '
  'client role, so there is no second path to keep in step with this one (§37).';

-- "I went back and looked at these again."
--
-- The same three checks as level4_submit, because the revision screen shows the ચિત્ર and
-- the વર્ણન — it is the answer key, and it must not be reachable for an activity the યુવક
-- has not unlocked.
--
-- It counts, and changes nothing else. A યુવક who opens revision has not failed anything:
-- if no row exists yet he gets the table's IN_PROGRESS default, and an existing status —
-- COMPLETED included — is left exactly as it was. REVISION_REQUIRED is written by a
-- submission that did not cover everything, never by the act of revising.
create or replace function public.level4_mark_revision(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  act        public.level4_activities%rowtype;
  done_ids   uuid[];
  new_status text;
  revisions  integer;
begin
  if uid is null then
    raise exception 'level4_not_signed_in';
  end if;

  if not public.is_active_user() then
    raise exception 'level4_not_active';
  end if;

  select a.* into act
  from public.level4_activities a
  join public.level4_configs c on c.id = a.config_id
  where a.id = p_activity_id
    and a.active
    and c.status = 'PUBLISHED';

  if not found then
    raise exception 'level4_not_published';
  end if;

  if not public.level4_gate_open(uid, act.config_id) then
    raise exception 'level4_gate_closed';
  end if;

  done_ids := public.level4_completed_activity_ids(uid, act.config_id);

  -- An activity with nothing left to ask does not block — the same rule, and for the same
  -- reason, as in level4_submit().
  if exists (
    select 1
    from public.level4_activities prev
    where prev.config_id = act.config_id
      and prev.active
      and prev.position < act.position
      and not (prev.id = any(done_ids))
      and cardinality(public.level4_effective_items(prev.id)) > 0
  ) then
    raise exception 'level4_locked';
  end if;

  insert into public.level4_activity_progress
    (user_id, activity_id, config_id, revision_count, updated_at)
  values
    (uid, act.id, act.config_id, 1, now())
  on conflict (user_id, activity_id) do update
    set revision_count = level4_activity_progress.revision_count + 1,
        updated_at = now()
  returning status, revision_count into new_status, revisions;

  return jsonb_build_object(
    'status',        new_status,
    'revisionCount', revisions
  );
end;
$$;

revoke all on function public.level4_mark_revision(uuid) from public;
grant execute on function public.level4_mark_revision(uuid) to authenticated;

-- ================================================================ writing, from the panel

-- Publishing: the moment a configuration becomes what every યુવક sees.
--
-- It is an RPC and not an UPDATE from the panel for two reasons. The first is atomicity
-- (§38): promoting the new version and archiving the old one are one decision, and a
-- browser that managed the first and lost its connection before the second would leave the
-- app either with two published versions or with none. Inside this function they are one
-- transaction — either both happen or neither does.
--
-- The second is that publishing is the only point at which the whole configuration can be
-- judged. An empty configuration, or one holding an activity with no દર્શન in it, is a
-- dead end for a યુવક (§1) and cannot be published at all — checked here, where it is the
-- database saying so, rather than only in the panel that can be edited.
--
--   level4_publish_no_activities           — nothing active to do
--   level4_publish_empty_activity: 4.3     — that activity has no દ્રશ્યો
--   level4_publish_withheld_activity: 4.3  — every દ્રશ્ય in it is currently withheld, so it
--                                            would show a યુવક nothing
--
-- The audit row is not written here. `audit_level4_config()` fires on the UPDATE below,
-- inside the same transaction, from to_jsonb(old)/to_jsonb(new) — 0004's rule, that the
-- database writes the trail and the client cannot omit it, applied unchanged.
create or replace function public.level4_publish(p_config_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg         public.level4_configs%rowtype;
  n_active    integer;
  empty_code  text;
  previous_id uuid;
begin
  if not public.has_permission('settings.update') then
    raise exception 'not permitted to publish a level 4 configuration';
  end if;

  -- FOR UPDATE, so two administrators pressing Publish on two different versions at the
  -- same moment are serialised rather than racing the partial unique index.
  select * into cfg from public.level4_configs where id = p_config_id for update;

  if not found then
    raise exception 'level4_publish_not_found';
  end if;

  if cfg.status = 'PUBLISHED' then
    raise exception 'level4_publish_already_published';
  end if;

  if cfg.status = 'ARCHIVED' then
    raise exception 'level4_publish_archived';
  end if;

  select count(*) into n_active
  from public.level4_activities a
  where a.config_id = cfg.id
    and a.active;

  if n_active = 0 then
    raise exception 'level4_publish_no_activities';
  end if;

  select a.code into empty_code
  from public.level4_activities a
  where a.config_id = cfg.id
    and a.active
    and not exists (select 1 from public.level4_activity_items i where i.activity_id = a.id)
  order by a.position
  limit 1;

  if empty_code is not null then
    raise exception 'level4_publish_empty_activity: %', empty_code;
  end if;

  -- And the same question asked of what is actually visible. An activity every one of whose
  -- દ્રશ્યો is currently withheld has items and still shows a યુવક nothing, so publishing it
  -- would put an activity on the page that leaves the moment it arrives. It is a separate
  -- message from the one above because it is a different mistake with a different fix: that
  -- one needs દ્રશ્યો chosen, this one needs them released in the દર્શન panel.
  select a.code into empty_code
  from public.level4_activities a
  where a.config_id = cfg.id
    and a.active
    and cardinality(public.level4_effective_items(a.id)) = 0
  order by a.position
  limit 1;

  if empty_code is not null then
    raise exception 'level4_publish_withheld_activity: %', empty_code;
  end if;

  -- Two statements rather than one, and not for want of trying: `level4_one_published` is
  -- a *partial* unique index, which cannot be declared DEFERRABLE (only constraints can,
  -- and constraints cannot be partial). A single UPDATE touching both rows is checked row
  -- by row in an order Postgres does not promise, so it can transiently hold two PUBLISHED
  -- rows and fail. Archiving first is ordered, and the function body is one transaction —
  -- the atomicity §38 asks for is the transaction's, not the statement's.
  update public.level4_configs
     set status = 'ARCHIVED',
         updated_at = now()
   where status = 'PUBLISHED'
     and id <> p_config_id
  returning id into previous_id;

  update public.level4_configs
     set status = 'PUBLISHED',
         published_at = now(),
         published_by = auth.uid(),
         updated_at = now()
   where id = p_config_id;

  return jsonb_build_object(
    'configId',         cfg.id,
    'version',          cfg.version,
    'archivedConfigId', previous_id,
    'activityCount',    n_active
  );
end;
$$;

revoke all on function public.level4_publish(uuid) from public;
grant execute on function public.level4_publish(uuid) to authenticated;

-- Editing a published configuration, safely: don't. Copy it (§10).
--
-- A deep copy — configuration, activities, items — into a new DRAFT at version max+1, so
-- the સંચાલક can rearrange freely while every યુવક carries on with the version that is
-- live. When the copy is published, decision #4 carries progress across it by દ્રશ્ય
-- coverage rather than by activity id, which is what makes this cheap to do.
--
-- The activities and their items are copied in a single statement. The new ids are not
-- known until the INSERT runs, so the item copy joins the returned rows back to the source
-- on `code` — unique within a configuration by constraint, which is what makes it a safe
-- key to map on.
create or replace function public.level4_clone_config(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  src    public.level4_configs%rowtype;
  new_id uuid;
begin
  if not public.has_permission('settings.update') then
    raise exception 'not permitted to clone a level 4 configuration';
  end if;

  select * into src from public.level4_configs where id = p_config_id;
  if not found then
    raise exception 'level4_clone_not_found';
  end if;

  insert into public.level4_configs
    (version, status, title, require_gate, gate_threshold, created_by, updated_by)
  select coalesce(max(version), 0) + 1,
         'DRAFT',
         src.title,
         src.require_gate,
         src.gate_threshold,
         auth.uid(),
         auth.uid()
  from public.level4_configs
  returning id into new_id;

  with src_act as (
    select * from public.level4_activities where config_id = p_config_id
  ),
  new_act as (
    insert into public.level4_activities (config_id, code, title, description, position, active)
    select new_id, code, title, description, position, active from src_act
    returning id, code
  )
  insert into public.level4_activity_items (activity_id, scene_id, position)
  select new_act.id, i.scene_id, i.position
  from new_act
  join src_act on src_act.code = new_act.code
  join public.level4_activity_items i on i.activity_id = src_act.id;

  -- Written here rather than by a trigger, because what happened is not "a configuration
  -- appeared" — it is "this version was taken from that one", and only this function knows
  -- the pair. A DRAFT created from scratch is not audited at all: it changes nothing any
  -- યુવક can see, and publishing it records the whole thing in `after`.
  if auth.uid() is not null then
    insert into public.audit_logs
      (actor_id, actor_role, action, resource_type, target_id, meta)
    values
      (auth.uid(), public.effective_role()::text, 'LEVEL4_CONFIG_CLONED', 'level4_configs',
       new_id::text,
       jsonb_build_object('fromConfigId', src.id, 'fromVersion', src.version));
  end if;

  return new_id;
end;
$$;

revoke all on function public.level4_clone_config(uuid) from public;
grant execute on function public.level4_clone_config(uuid) to authenticated;

-- ================================================================ stamps and guards

-- `updated_at` is a concurrency token, so it has to be the database that sets it — a
-- client that stamps its own can stamp the value it already holds and defeat the check it
-- is participating in. `updated_by`/`created_by` fall back to the existing value when
-- auth.uid() is null, which is a migration or the service key, not a person.
create or replace function public.level4_configs_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists level4_configs_stamp on public.level4_configs;

create trigger level4_configs_stamp
  before insert or update on public.level4_configs
  for each row execute function public.level4_configs_stamp();

create or replace function public.level4_activities_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists level4_activities_stamp on public.level4_activities;

create trigger level4_activities_stamp
  before insert or update on public.level4_activities
  for each row execute function public.level4_activities_stamp();

-- §10, enforced rather than documented.
--
-- Once a configuration is published, its contents are the ground a યુવક's progress is
-- recorded against: activity ids in `level4_activity_progress`, દ્રશ્ય ids in the coverage
-- that carries him across versions. Editing an activity in place would rewrite the meaning
-- of rows already written — someone credited with "passed ૪.૨" would silently be credited
-- with whatever ૪.૨ contains now.
--
-- So a PUBLISHED or ARCHIVED configuration accepts only a change of `status` (which is how
-- publish and archive work) and its publication stamps. Everything else is refused, and
-- `level4_clone_config()` is the way forward. A trigger and not a policy, for 0004's
-- reason: this must apply to the service key too.
create or replace function public.level4_configs_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('PUBLISHED', 'ARCHIVED')
     and (new.version        is distinct from old.version
       or new.title          is distinct from old.title
       or new.require_gate   is distinct from old.require_gate
       or new.gate_threshold is distinct from old.gate_threshold) then
    raise exception 'level4_config_frozen';
  end if;

  return new;
end;
$$;

drop trigger if exists level4_configs_guard on public.level4_configs;

-- BEFORE ROW triggers fire in name order, so this one runs before level4_configs_stamp.
-- That is harmless here, unlike in 0008 where the order was load-bearing: the guard reads
-- only the columns the stamp never touches, so it judges the same values either way.
create trigger level4_configs_guard
  before update on public.level4_configs
  for each row execute function public.level4_configs_guard();

-- The same rule, one level down: no activity and no item may be added, changed or removed
-- under a configuration that is no longer a draft.
--
-- OLD and NEW are read through a record variable chosen by tg_op rather than directly,
-- because NEW is unassigned during DELETE and OLD is unassigned during INSERT — reading
-- either at the wrong time raises "record is not assigned yet" (the same trap 0004's
-- audit_scene() documents).
create or replace function public.level4_guard_editable()
returns trigger
language plpgsql
as $$
declare
  r  record;
  st text;
begin
  if tg_op = 'DELETE' then
    r := old;
  else
    r := new;
  end if;

  if tg_table_name = 'level4_activities' then
    select c.status into st
    from public.level4_configs c
    where c.id = r.config_id;
  else
    select c.status into st
    from public.level4_activities a
    join public.level4_configs c on c.id = a.config_id
    where a.id = r.activity_id;
  end if;

  -- A null status is not a failure to find the parent, and must not be treated as one.
  -- It happens in two ordinary places: a cascade delete, where the parent is already gone;
  -- and level4_clone_config(), whose items are inserted in the same statement that creates
  -- their activities — rows a data-modifying CTE has written are not visible to the rest of
  -- that statement, so this lookup finds nothing. The foreign key still checks at the end
  -- of the statement, by which time they are. Neither case is an edit to a live version.
  if st is not null and st not in ('DRAFT', 'VALIDATED') then
    raise exception 'level4_config_frozen';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists level4_activities_guard on public.level4_activities;
drop trigger if exists level4_items_guard      on public.level4_activity_items;

create trigger level4_activities_guard
  before insert or update or delete on public.level4_activities
  for each row execute function public.level4_guard_editable();

create trigger level4_items_guard
  before insert or update or delete on public.level4_activity_items
  for each row execute function public.level4_guard_editable();

-- ================================================================ audit

-- The trail for a configuration, derived from the diff exactly as audit_scene() is.
--
-- INSERT is deliberately not audited: a DRAFT nobody can see is not yet an administrative
-- act, and 0004's warning about burying the trail applies — the panel writes a draft
-- repeatedly while it is being built. The act is publishing, and the row it writes carries
-- the whole configuration in `after`.
create or replace function public.audit_level4_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  act   text := 'LEVEL4_CONFIG_UPDATED';
begin
  -- No session user: a migration or the service key. Those changes are in the migration
  -- history instead, and audit_logs.actor_id is NOT NULL.
  if actor is null or not public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'PUBLISHED' then
      act := 'LEVEL4_PUBLISHED';
    elsif new.status = 'ARCHIVED' then
      act := 'LEVEL4_ARCHIVED';
    else
      act := 'LEVEL4_CONFIG_UPDATED';
    end if;
  end if;

  insert into public.audit_logs
    (actor_id, actor_role, action, resource_type, target_id, "before", "after")
  values
    (actor, public.effective_role()::text, act, 'level4_configs', new.id::text,
     to_jsonb(old), to_jsonb(new));

  return new;
end;
$$;

drop trigger if exists audit_level4_configs on public.level4_configs;

create trigger audit_level4_configs
  after update on public.level4_configs
  for each row execute function public.audit_level4_config();

-- ================================================================ RLS

alter table public.level4_configs           enable row level security;
alter table public.level4_activities        enable row level security;
alter table public.level4_activity_items    enable row level security;
alter table public.level4_activity_progress enable row level security;
alter table public.level4_attempts          enable row level security;

-- Content ----------------------------------------------------------
--
-- Readable by anyone who may see settings, and — separately — by every signed-in યુવક once
-- it is PUBLISHED. The second half is what lets the app fall back to reading the tables
-- directly if it ever needs to; the RPCs above are SECURITY DEFINER and do not depend on
-- it. A DRAFT stays invisible to a યુવક by both routes.
--
-- `settings.update` is the write permission rather than a new one of its own: LEVEL4.md §1
-- freezes the permission matrix, and composing લેવલ ૪ is configuring the app, which is
-- exactly what that permission already names.

create policy "level4 config readable" on public.level4_configs
  for select using (public.has_permission('settings.read') or status = 'PUBLISHED');

create policy "level4 config insertable" on public.level4_configs
  for insert with check (public.has_permission('settings.update'));

create policy "level4 config updatable" on public.level4_configs
  for update using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

-- No delete policy. Versions are archived, never removed (§28) — the history is what a
-- યુવક's completed activities point at.

create policy "level4 activity readable" on public.level4_activities
  for select using (
    exists (
      select 1 from public.level4_configs c
      where c.id = config_id
        and (public.has_permission('settings.read') or c.status = 'PUBLISHED')
    )
  );

create policy "level4 activity insertable" on public.level4_activities
  for insert with check (public.has_permission('settings.update'));

create policy "level4 activity updatable" on public.level4_activities
  for update using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

-- Activities *are* deletable, unlike configurations and unlike દર્શન: an activity is
-- removed while a version is still a draft, which is before it can mean anything to
-- anybody. level4_guard_editable() is what stops it once the version is published.
create policy "level4 activity deletable" on public.level4_activities
  for delete using (public.has_permission('settings.update'));

create policy "level4 item readable" on public.level4_activity_items
  for select using (
    exists (
      select 1
      from public.level4_activities a
      join public.level4_configs c on c.id = a.config_id
      where a.id = activity_id
        and (public.has_permission('settings.read') or c.status = 'PUBLISHED')
    )
  );

create policy "level4 item insertable" on public.level4_activity_items
  for insert with check (public.has_permission('settings.update'));

create policy "level4 item updatable" on public.level4_activity_items
  for update using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

-- setActivityItems() replaces a membership list, so removing a row is half of an ordinary
-- edit here rather than a destruction of anything.
create policy "level4 item deletable" on public.level4_activity_items
  for delete using (public.has_permission('settings.update'));

-- Progress ---------------------------------------------------------
--
-- Read your own, or read everyone's with `progress.read` — the same shape as
-- "own progress readable" on public.progress, and the same permission, so the સંચાલક
-- dashboard sees લેવલ ૪ detail exactly where it already sees the daily score.
--
-- **And no write policy, for anyone.** Not a narrow one — none. RLS denies any command it
-- has no policy for, so INSERT, UPDATE and DELETE are refused for `authenticated` no
-- matter what the row says, and the SECURITY DEFINER RPCs above (which run as the owner
-- and so are not subject to RLS) are the only way a row here is ever written. That is the
-- difference between this and `profiles.level4_unlocked`, which 0008 had to defend with a
-- guard trigger precisely because its policy let the client write the column at all.

create policy "own level4 progress readable" on public.level4_activity_progress
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

create policy "own level4 attempts readable" on public.level4_attempts
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

-- Belt and braces behind the missing policies: Supabase's default privileges grant every
-- new table in `public` to anon and authenticated, so RLS is otherwise the only thing
-- standing there. Revoking the privilege as well means a mistake in a future migration —
-- an added policy, a disabled RLS — still does not open a write path from a browser.
revoke insert, update, delete on public.level4_activity_progress from anon, authenticated;
revoke insert, update, delete on public.level4_attempts          from anon, authenticated;

-- The attempts sequence goes with it: no client inserts, so no client needs the sequence.
revoke usage, select on sequence public.level4_attempts_id_seq from anon, authenticated;
