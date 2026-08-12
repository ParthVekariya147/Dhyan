-- વર્ણી ધ્યાન — what opens લેવલ ૪ becomes a setting, not a property of an edition.
--
-- What was wrong
-- --------------
-- LEVEL4.md decision #3 put the gate on the published configuration: `require_gate` and
-- `gate_threshold` on `level4_configs`, editable in the લેવલ ૪ builder. That is a coherent
-- design — each published edition carries the gate it was published with — and it had one
-- consequence nobody chose:
--
--   **Until a configuration existed, there was nowhere to set the number at all.**
--
-- A સંચાલક opening a fresh project sees "No version yet" on /levels/4 and a Levels page that
-- configures a level's name, order and availability. The one question he actually wants to
-- answer — how much of લેવલ ૩ opens લેવલ ૪ — is answerable in neither place, because the only
-- field that holds it lives inside a draft he has not made yet. He goes looking on the page
-- named "Levels", finds nothing, and reasonably concludes the feature is missing.
--
-- So the gate moves to `settings['levels'].value.level4Gate`, beside the level list it
-- belongs with: one row, one RLS policy, one audit trigger, and answerable on day one.
--
-- One answer, not two
-- -------------------
-- `level4_configs.require_gate` and `.gate_threshold` are **left in place and no longer
-- read**. Not dropped: 0010's builder writes them, older drafts hold real values, and
-- dropping a column mid-flight breaks a running panel for the sake of tidiness. But nothing
-- decides anything from them after this migration, and the column comments say so.
--
-- Keeping both readable was considered and refused. A per-edition override with a global
-- fallback is two places answering one question, which is precisely the fault
-- `0011_level4_gate_view.sql` exists to remove — the panel and the યુવક app disagreeing
-- about a rule the સંચાલક set himself. It would also be invisible: the number on the Levels
-- page would be right except when it was not, and nothing on screen would say which.
--
-- What this does NOT change
-- -------------------------
-- * **લેવલ ૪ still needs a published configuration.** The gate is when, not whether. With
--   nothing published, `level4_published_config()` returns null and the યુવક app says
--   લેવલ ૪ is being prepared, exactly as before — a gate in front of an empty room.
-- * **0012 still holds.** A કસોટી already completed is never re-locked, so lowering or
--   raising this number cannot take back what a યુવક has earned.
-- * **`profiles.level4_unlocked`** is still written by 0008's trigger at its fixed ૮૦ and is
--   still nobody's authority. See 0011.
-- * **"In a single day"** is unchanged and is the whole meaning of the number: `progress`'s
--   primary key is (user_id, date), so a row is a day, and ૪૦ on Monday with ૪૦ on Tuesday
--   is not ૮૦.

-- ================================================================ the setting

-- The gate as the settings row holds it right now.
--
-- Mirrors `resolveLevel4Gate()` in shared/domain/settings.js branch for branch, including
-- which way each malformed value falls — an absent `require` reads as **true** (defaulting
-- to "open to everyone" would hand લેવલ ૪ to every યુવક because a key was missing) and a
-- threshold that is not a non-negative number falls back to ૮૦ rather than to null, because
-- a null here would make every comparison below unknown and shut the level for everybody.
--
-- `jsonb_typeof` before the cast is load-bearing: `('"eighty"'::jsonb)::text::integer`
-- raises, and an exception in a STABLE function called from a view would take out the
-- સંચાલક's Users list rather than merely misreport one column. A string that happens to
-- contain digits is also refused rather than coerced — the panel writes a JSON number, so a
-- string here means something else wrote it, and guessing at what it meant is how two
-- systems start to disagree.
--
-- SECURITY DEFINER and revoked from public, for the reason 0008 gives about
-- `has_earned_level4()`: it is called from functions that must answer identically for every
-- caller, and `settings` is readable by `authenticated` today only because the yuvak app
-- needs the app row. This does not widen that by one byte — it returns two scalars about
-- configuration, never about a person.
create or replace function public.level4_gate_setting()
returns table (require_gate boolean, gate_threshold integer)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select s.value -> 'level4Gate' as g
    from public.settings s
    where s.key = 'levels'
  )
  select
    -- Absent, or anything that is not JSON `false`, means the gate is required.
    coalesce((select (g -> 'require') <> 'false'::jsonb from raw), true),
    coalesce(
      (
        -- Nested, not `typeof = 'number' AND value >= 0`. Postgres does not promise
        -- left-to-right evaluation of AND, so the cast in the second arm may run even when
        -- the first is false — and `('"eighty"'::jsonb ->> 'x')::numeric` raises. A CASE
        -- whose arms are ordered is the documented way to make a guard actually guard, and
        -- this one runs inside profiles_level4, where an exception would take out the
        -- સંચાલક's Users list rather than misreport one column.
        select case
                 when jsonb_typeof(g -> 'threshold') = 'number' then
                   case when (g ->> 'threshold')::numeric >= 0
                        then floor((g ->> 'threshold')::numeric)::integer
                   end
               end
        from raw
      ),
      80
    );
$$;

revoke all on function public.level4_gate_setting() from public;

comment on function public.level4_gate_setting() is
  'What opens લેવલ ૪, from settings[''levels''].value.level4Gate — the single answer since '
  '0014. Mirrors resolveLevel4Gate() in shared/domain/settings.js, including how each '
  'malformed value falls. level4_configs.require_gate/gate_threshold are no longer read.';

-- ================================================================ the predicate

-- gateOpen(user) — has this યુવક ever had a qualifying લેવલ ૩ day?
--
-- The canonical form, and it takes no configuration, because the answer no longer depends
-- on one. Deliberately still the shape 0008's `has_earned_level4()` has: "ever", on a single
-- date, never summed across days.
--
-- `require_gate = false` short-circuits before `progress` is touched — the સંચાલક saying the
-- ladder is open to everyone is not a question about this યુવક, and asking one anyway would
-- be a wasted index scan per card per render.
create or replace function public.level4_gate_open(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not g.require_gate
      or exists (
           select 1
           from public.progress p
           where p.user_id = p_user
             and p.level3_score >= g.gate_threshold
         )
  from public.level4_gate_setting() g;
$$;

revoke all on function public.level4_gate_open(uuid) from public;

-- The two-argument form 0010 defined, kept as a delegating wrapper.
--
-- Its callers — `level4_activity_states()`, `level4_submit()` (0012) — pass a config id that
-- no longer decides anything. Rewriting them to drop the argument would mean reissuing two
-- large functions to change one call site each, and every one of those lines is a line that
-- can be got wrong; this way the change is provably confined to what the gate *is*.
--
-- `p_config` is retained and ignored. That is a real cost — an argument that does nothing is
-- an argument a future reader will assume does something — so it is named in the comment
-- below as well as here. What it is NOT is a silent no-op: the config still has to exist,
-- because a caller asking about a configuration that was archived mid-request is asking
-- about a લેવલ ૪ that is not there, and `false` is the honest answer to that.
create or replace function public.level4_gate_open(p_user uuid, p_config uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.level4_configs c where c.id = p_config)
     and public.level4_gate_open(p_user);
$$;

revoke all on function public.level4_gate_open(uuid, uuid) from public;

comment on function public.level4_gate_open(uuid, uuid) is
  'Compatibility wrapper. p_config is checked for existence and otherwise IGNORED: since '
  '0014 the gate is settings[''levels''].value.level4Gate and not a property of the '
  'configuration. Call level4_gate_open(uuid) for the rule itself.';

-- ================================================================ what the app is told

-- 0010's function, reporting the gate that is actually in force.
--
-- Only the two gate fields change. They are what મુખપૃષ્ઠ and લેવલ ૩ print — "લેવલ ૩ માં ૮૦
-- પૂરાં કરો, પછી આ ખૂલશે" — and a screen that promised `cfg.gate_threshold` after this
-- migration would be naming a number no longer used to decide anything. The whole argument
-- of `useLevel4Gate()` in src/lib/level4.js is that the promise printed to a યુવક has to be
-- the promise the database keeps.
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
  gate   record;
  result jsonb;
begin
  if uid is null then
    return null;
  end if;

  select * into cfg from public.level4_configs where status = 'PUBLISHED';
  if not found then
    return null;
  end if;

  select * into gate from public.level4_gate_setting();

  select jsonb_build_object(
    'configId',        cfg.id,
    'version',         cfg.version,
    'requireGate',     gate.require_gate,
    'gateThreshold',   gate.gate_threshold,
    'gateOpen',        public.level4_gate_open(uid),
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

-- The published configuration, with the same correction.
--
-- `requireGate`/`gateThreshold` here feed `normaliseConfig()` in src/lib/level4.js, which is
-- what લેવલ ૪'s own locked screen prints. Same reasoning as above: one number reaches every
-- screen, and it is the one the predicate uses.
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
    'requireGate',   (select require_gate   from public.level4_gate_setting()),
    'gateThreshold', (select gate_threshold from public.level4_gate_setting()),
    'publishedAt',   c.published_at,
    'activities', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',          a.id,
                 'code',        a.code,
                 'title',       a.title,
                 'description', a.description,
                 'position',    a.position,
                 'sceneIds', to_jsonb(public.level4_effective_items(a.id))
               )
               order by a.position
             )
      from public.level4_activities a
      where a.config_id = c.id
        and a.active
        and cardinality(public.level4_effective_items(a.id)) > 0
    ), '[]'::jsonb)
  )
  from public.level4_configs c
  where c.status = 'PUBLISHED';
$$;

revoke all on function public.level4_published_config() from public;
grant execute on function public.level4_published_config() to authenticated;

-- ================================================================ the panel's column

-- 0011's view, asking the same question of the same authority.
--
-- 0011 inlined the predicate because `level4_gate_open(uuid, uuid)` could not be granted to
-- `authenticated` — it takes any uuid and answers about that person, so a grant would let one
-- યુવક ask about another (§13). That reasoning is unchanged and the inlining stays; what
-- changes is that the copy now reads the setting instead of the configuration, and that
-- there is no longer any dependence on a configuration existing at all.
--
-- That last point is a real change in meaning and is the right one. The column answers "has
-- this યુવક met the requirement for લેવલ ૪", which is a fact about him and the setting. It
-- used to answer `false` for everybody whenever nothing was published — a project mid-setup
-- reported that not one of its ~2,000 યુવકો had reached લેવલ ૪, when what was true is that
-- લેવલ ૪ had no content yet. Whether there is anything to *open* is a different question and
-- the Level 4 page is where it is asked.
--
-- `security_invoker = on` remains load-bearing: without it this view would run with its
-- owner's rights over `profiles` and `progress` and hand every row to anyone permitted to
-- select from it. With it, the underlying policies apply to whoever is asking.
create or replace view public.profiles_level4
with (security_invoker = on) as
select
  p.*,
  coalesce(
    (
      select (not g.require_gate)
          or exists (
               select 1
                 from public.progress pr
                where pr.user_id = p.id
                  and pr.level3_score >= g.gate_threshold
             )
        from public.level4_gate_setting() g
    ),
    false
  ) as level4_gate_open
from public.profiles p;

comment on view public.profiles_level4 is
  'profiles, plus the લેવલ ૪ gate as settings[''levels''].value.level4Gate defines it right '
  'now (0014). Read-only and derived — see level4_gate_open(uuid). Unlike 0011 this no '
  'longer requires a published configuration: it reports whether the યુવક has met the '
  'requirement, not whether there is content behind it.';

grant select on public.profiles_level4 to authenticated;

-- ================================================================ the old columns

-- Written by the લેવલ ૪ builder, read by nothing.
--
-- Left in place deliberately — see the header. The comments are the warning to whoever finds
-- them next, because a column called `gate_threshold` holding ૮૦ is exactly the sort of thing
-- someone repairs a bug by editing.
comment on column public.level4_configs.gate_threshold is
  'NO LONGER READ (0014). The gate is settings[''levels''].value.level4Gate — one answer, '
  'set on the Levels page, applying to every edition. Kept because older drafts hold real '
  'values and dropping a live column breaks the running panel. Editing this changes nothing.';

comment on column public.level4_configs.require_gate is
  'NO LONGER READ (0014). See gate_threshold above and level4_gate_setting().';
