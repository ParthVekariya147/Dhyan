-- વર્ણી ધ્યાન — લેવલ ૩ as repeated પુનરાવર્તન: the draft that saves itself, the revision that
-- accumulates, and the pace rule that tells સાધના from scrolling.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT WAS ACTUALLY BROKEN, AND WHY IT LOOKED LIKE A SAVING PROBLEM
-- ════════════════════════════════════════════════════════════════════════════
--
-- The report was "લેવલ ૩ sometimes saves and sometimes does not". Four separate faults produce
-- that one symptom, and only one of them is about saving:
--
--   1. **A partial પુનરાવર્તન was never paid at all.** `activity_submit()` step 9 calls
--      `award_points()` only when `status = 'COMPLETED'` (0021:970), and લેવલ ૩ is COMPLETED
--      only when `completed_n >= total_n` (0021:828-832) — all ૧૦૮. So ticking ૫૦ and pressing
--      નોંધાવો reached the award engine **zero times**, under every configuration, including the
--      per-તિક rule that exists precisely to pay partials. This is the fault that made the
--      feature look random: it worked on a full collection and silently paid nothing otherwise.
--
--   2. **Ticking wrote no event.** A tick is a localStorage write flushed to `progress`
--      (src/lib/progress.js §12), and `progress` holds one integer, `level3_score`. No attempt
--      row, no ledger row, no દ્રશ્ય ids. A યુવક who ticked ૫૦ and walked away left nothing
--      behind that any report or the board could ever see.
--
--   3. **The ticked set existed only on one handset.** Nothing server-side holds "what is
--      ticked right now", so a refresh on a second phone restores a *score floor* and no boxes
--      (`scoreOf()`, progress.js:164). §12 of the requirement asks for the unfinished session to
--      come back; there was nowhere for it to come back from.
--
--   4. **Nothing could tell સાધના from a scroll.** લેવલ ૨ records a દર્શન when the foot of the
--      list is half on screen (DarshanFeed.jsx:118-132) — true after a four-second flick — and
--      લેવલ ૩ measured nothing whatsoever.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES **NOT** ADD, BECAUSE IT IS ALREADY THERE
-- ════════════════════════════════════════════════════════════════════════════
--
-- The cumulative-revision rule the requirement describes at length — ૫૦ then ૪૦ is ૯૦, then ૩૦
-- is ૧૨૦, no cap — **is already implemented and already tested**. `award_points()`'s તિક branch
-- under `tick.mode = 'TICK'` with `earn.tickCount = 'ALL'` pays every valid દ્રશ્ય of every
-- submission, keyed idempotently on the attempt id (0033:986-1063); scripts/test-point-bonus.mjs
-- asserts ૧૦૮ then ten more is ૧૧૮. `activity_attempts.attempt_number` is already the revision
-- number, `activity_attempts` is already the immutable per-revision history, and
-- `point_transactions` is already the ledger.
--
-- So there is **no new points table, no new history table and no second scoring computation**
-- in this file. §18 and §24 of the requirement forbid all three, and the audit
-- (docs/POINT_DATA_FLOW.md) records that the single-writer property is what must not break.
-- `point_award()` is still the only INSERT site in the schema.
--
-- What is genuinely missing is a place to keep the **unfinished** session, a way to make the
-- award engine see partials, an honest measure of time, and a set of દ્રશ્ય ids the server can
-- check against. Those four are what follows.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE PACE RULE — "૫૦ ટિક માટે ૫૦ સેકંડ"
-- ════════════════════════════════════════════════════════════════════════════
--
-- One તિક is worth one second of attention, and the number of seconds is the સંચાલક's:
--
--     paid ticks = least( valid ticks, (engaged seconds + grace) / secondsPerTick )
--
-- No cliff, and that is the decision rather than an accident. A gate — "under the time, pay
-- nothing" — punishes a યુવક who was thirty seconds quick exactly as hard as one who flicked to
-- the bottom, and §1 rule 4 refuses that reading. Under the cap, ૫૦ ticks in ૪૫ seconds is ૪૫,
-- ૧૦૮ ticks in ૧૨ seconds is ૧૨, and ૧૦૮ ticks over three minutes is ૧૦૮.
--
-- **The seconds are counted by this database and never by the handset.** There is no
-- `p_engaged_ms` parameter anywhere in this file and there must not be one — §17 is explicit
-- that the client is not trusted with anything the points depend on, and a client-supplied
-- duration is a client-supplied point value wearing a different hat. `level3_draft_save()`
-- accumulates the gap between one autosave and the next against its own `now()`, discarding any
-- gap longer than `pace.maxGapSeconds` — a phone left open on a bus counts as nothing, and a
-- યુવક who reads a વર્ણન for half a minute before ticking it counts as half a minute.
--
-- The consequence worth stating: to earn ૧૦૮ ticks a યુવક must keep the page open, ticking, for
-- ~૧૦૮ seconds of real time. There is no request he can send that shortens that.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE દ્રશ્ય CATALOGUE — the check 0021 could not make
-- ════════════════════════════════════════════════════════════════════════════
--
-- `activity_submit()` says so itself (0021:804-806): it does **not** intersect the submitted ids
-- with a live collection, "because લેવલ ૩ has no fixed list to intersect with". That was true.
-- The collection is `content/darshan.json`, a file in the browser bundle, and `public.scenes`
-- holds only the rows a સંચાલક has touched — so Postgres could exclude a *withheld* દ્રશ્ય
-- (`admin_withheld_scene_ids()`, 0029:197) but had no way to refuse an id it had simply never
-- heard of. Five hundred invented ids would have counted as five hundred ticks.
--
-- `scene_catalog` is that missing list, synced from the manifest, and `live_scene_ids()` is the
-- catalogue minus the withheld. Two properties keep it from becoming a new way to break:
--
--   * **An empty catalogue checks nothing.** Until the first sync runs, membership is not
--     tested and behaviour is exactly today's. A migration that silently stopped paying every
--     યુવક until a build step ran would be the worst failure available here.
--   * **`admin_content_total()` is the backstop either way.** Even with no catalogue, a
--     submission can never be paid for more દ્રશ્યો than the collection is known to hold.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS REISSUED, AND WHAT IS DELIBERATELY LEFT ALONE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reissued: `award_points()` (the તિક branch learns the catalogue and the pace rule — 0031 and
-- 0033 both reissued exactly this function for exactly this kind of change),
-- `daily_record_points()` and `daily_record_save()` (see the reconciliation note below).
--
-- **Not** reissued, on purpose: `activity_submit()`, which is 0021's statement of what an
-- attempt is; `level4_submit()`; `settings_check_points()`, whose `tick` block refuses unknown
-- keys — which is why the pace numbers live under their own `points.pace` key with their own
-- validator trigger rather than inside `tick`, the same "a second function, not a wider one"
-- 0031 argues for. Nothing here touches the unlock machine, and nothing repricing anything that
-- has already been paid.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE RECONCILIATION, WHICH WOULD OTHERWISE HAVE UNDONE ALL OF THIS
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0034's `daily_record_save()` forces `sum(ledger for the day) == the record's total` by writing
-- one compensating `DAILY_ADJUST` row, and it prices લેવલ ૩ from `daily_activity_counts` as a
-- **distinct set of દ્રશ્યો for the day**. Those two facts together are a trap: ૫૦ then ૪૦
-- accumulates to ૯૦ in the ledger, the record computes ૫૦ distinct દ્રશ્યો, and the first save
-- of the /daily form writes **-૪૦**. The whole feature would unwind the moment a યુવક opened a
-- screen that has nothing to do with it.
--
-- The fix is a division of ownership rather than a new sum. Under a તિક rule the **event path
-- owns લેવલ ૩ entirely**: `daily_record_points()` returns 0 for it, and the reconciliation
-- excludes `TICK` and `REVISION` rows from the base it compares against. The day's stored total
-- still counts them, so 0034's guarantee — the record's total equals the day's ledger sum —
-- holds exactly as before. Levels ૧, ૨ and ૪ and the twenty-four hour window are untouched.

-- ================================================================ the દ્રશ્ય catalogue

-- The collection, as Postgres is allowed to know it.
--
-- Ids only, and deliberately: this is not a copy of the દર્શન and must never become one. What
-- the server needs is the answer to "is this a દ્રશ્ય at all", which no other table can give —
-- `public.scenes` carries overrides and therefore only the rows somebody edited (0029:190-193).
-- `display_index` rides along because a report that has to print દ્રશ્ય ૪૨ should not have to
-- ask the browser what ૪૨ means, and it is nullable because an id is valid whether or not its
-- number is known.
create table if not exists public.scene_catalog (
  id            text primary key,
  display_index integer,
  synced_at     timestamptz not null default now()
);

alter table public.scene_catalog
  add column if not exists display_index integer,
  add column if not exists synced_at     timestamptz not null default now();

create index if not exists scene_catalog_index_idx
  on public.scene_catalog (display_index);

comment on table public.scene_catalog is
  'Every દ્રશ્ય id the published collection contains, synced from content/darshan.json (0035). '
  'The list activity_submit() said it did not have (0021:804-806). Ids only — the content stays '
  'in the manifest and the overrides stay in public.scenes.';

-- Has the catalogue ever been filled?
--
-- Every membership test below is conditional on this, and that is the whole of the deployment
-- story: apply the migration and nothing changes; run the sync and ids start being checked.
create or replace function public.scene_catalog_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.scene_catalog);
$$;

revoke all on function public.scene_catalog_ready() from public;
grant execute on function public.scene_catalog_ready() to authenticated;

-- The દ્રશ્યો that may be counted today: in the catalogue, and not withheld.
--
-- An array rather than a subquery at each call site, for `admin_withheld_scene_ids()`'s own
-- stated reason (0029:193-195): `stable`, so it is evaluated once per statement rather than once
-- per row, and there is one definition to change.
create or replace function public.live_scene_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(c.id), '{}'::text[])
  from public.scene_catalog c
  where not (c.id = any (public.admin_withheld_scene_ids()));
$$;

revoke all on function public.live_scene_ids() from public;
grant execute on function public.live_scene_ids() to authenticated;

comment on function public.live_scene_ids() is
  'The દ્રશ્યો a submission may be paid for: catalogued and not withheld (0035). Empty when the '
  'catalogue has never been synced, which every caller reads as "cannot check" rather than as '
  '"nothing is valid" — see scene_catalog_ready().';

-- Replace the catalogue with what the manifest holds.
--
-- Whole-list and not incremental, because the manifest is the truth and a diff would leave this
-- table holding whatever a failed half-sync left behind. Ids are never removed from the manifest
-- (ORDERING.md §1), so in practice this only ever adds — the delete is there for the day that
-- stops being true, and it runs in the same transaction as the insert so the catalogue is never
-- momentarily empty.
--
-- **Refuses an empty list.** Handing this an empty array is far more likely to be a broken build
-- step than a deliberate emptying of the collection, and the consequence — every id becomes
-- unrecognised and every તિક stops being paid — is too expensive to allow by accident.
create or replace function public.scene_catalog_sync(p_scenes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.has_permission('darshan.update') then
    raise exception 'scene_catalog_forbidden' using errcode = '42501';
  end if;

  if p_scenes is null or jsonb_typeof(p_scenes) <> 'array' then
    raise exception 'Scene catalogue: expected a list like [{"id": "darshan-001", "index": 1}].'
      using errcode = 'check_violation';
  end if;

  create temporary table _catalog_in (id text primary key, display_index integer)
    on commit drop;

  insert into _catalog_in (id, display_index)
  select distinct on (el.value ->> 'id')
         el.value ->> 'id',
         case when jsonb_typeof(coalesce(el.value -> 'index', el.value -> 'displayIndex')) = 'number'
              then round((coalesce(el.value ->> 'index', el.value ->> 'displayIndex'))::numeric)::integer
         end
  from jsonb_array_elements(p_scenes) el
  where nullif(btrim(coalesce(el.value ->> 'id', '')), '') is not null;

  select count(*)::integer into n from _catalog_in;

  if n = 0 then
    raise exception 'Scene catalogue: refusing to empty the catalogue - no usable ids in the payload.'
      using errcode = 'check_violation';
  end if;

  delete from public.scene_catalog c
  where not exists (select 1 from _catalog_in i where i.id = c.id);

  insert into public.scene_catalog (id, display_index, synced_at)
  select i.id, i.display_index, now() from _catalog_in i
  on conflict (id) do update
    set display_index = excluded.display_index,
        synced_at     = excluded.synced_at;

  return n;
end;
$$;

revoke all on function public.scene_catalog_sync(jsonb) from public;
grant execute on function public.scene_catalog_sync(jsonb) to authenticated;

comment on function public.scene_catalog_sync(jsonb) is
  'Replaces public.scene_catalog with the manifest''s ids (0035). Requires darshan.update. '
  'Refuses an empty payload, because the cost of accepting one is every તિક ceasing to be paid.';

-- ================================================================ the pace rule

-- `settings['levels'].value.points.pace`, resolved.
--
-- A second resolver beside `point_rules()` rather than a wider one, which is 0031's own pattern
-- and its stated reason (shared/domain/points.js:358-361): the price of a level and the shape of
-- a pace rule are separate questions, and widening the first to answer the second means
-- re-verifying a mirror that was already right. Reissuing `point_rules()` would also mean
-- reissuing `settings_check_points()`, a three-hundred-line trigger that guards every level's
-- pricing, to widen one closed list.
--
-- Every field falls back to the behaviour of the day before it existed:
--
--   secondsPerTick  0 — no pace rule at all, which is what every project has today.
--   graceSeconds    0 — no free seconds on top.
--   maxGapSeconds   180 — the longest silence between two autosaves that still counts as
--                   attention. Not 0, because 0 would mean no time could ever accumulate; this
--                   one has a working default because it is an anti-abuse detail rather than a
--                   business decision, and a project that never opens the panel should still be
--                   measuring honestly.
create or replace function public.point_pace()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select case when jsonb_typeof(s.value #> '{points,pace}') = 'object'
                then s.value #> '{points,pace}' end as v
    from public.settings s
    where s.key = 'levels'
  )
  select jsonb_build_object(
    'secondsPerTick',
    coalesce((select case when jsonb_typeof(v -> 'secondsPerTick') = 'number' then
                       case when round((v ->> 'secondsPerTick')::numeric) between 0 and 3600
                            then round((v ->> 'secondsPerTick')::numeric)::integer end
                     end from p), 0),
    'graceSeconds',
    coalesce((select case when jsonb_typeof(v -> 'graceSeconds') = 'number' then
                       case when round((v ->> 'graceSeconds')::numeric) between 0 and 86400
                            then round((v ->> 'graceSeconds')::numeric)::integer end
                     end from p), 0),
    'maxGapSeconds',
    coalesce((select case when jsonb_typeof(v -> 'maxGapSeconds') = 'number' then
                       case when round((v ->> 'maxGapSeconds')::numeric) between 5 and 3600
                            then round((v ->> 'maxGapSeconds')::numeric)::integer end
                     end from p), 180)
  );
$$;

revoke all on function public.point_pace() from public;
grant execute on function public.point_pace() to authenticated;

comment on function public.point_pace() is
  'settings[''levels''].value.points.pace, resolved (0035): secondsPerTick, graceSeconds, '
  'maxGapSeconds. Mirrors resolvePointPace() in shared/domain/points.js. An absent block is '
  'secondsPerTick 0, which is no pace rule and therefore the behaviour of every project today.';

-- The pace block's validator, as its own trigger.
--
-- `settings_check_points()` already refuses an unknown key inside `tick` (0031:986-988), which is
-- exactly why the pace numbers are not in there. Its own trigger keeps the two independent: this
-- one can be dropped, widened or replaced without reissuing the function that decides what every
-- level is worth. Both are BEFORE triggers that validate and return NEW, so the order they fire
-- in cannot matter.
create or replace function public.settings_check_pace()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  pc jsonb;
  e  record;
  n  numeric;
  lo integer;
  hi integer;
begin
  if new.key <> 'levels' or not (new.value ? 'points') then
    return new;
  end if;

  if not (new.value -> 'points' ? 'pace') then
    return new;
  end if;

  pc := new.value #> '{points,pace}';

  if jsonb_typeof(pc) <> 'object' then
    raise exception 'Pace rule: expected an object like {"secondsPerTick": 1, "graceSeconds": 0}.'
      using errcode = 'check_violation';
  end if;

  for e in select key, value from jsonb_each(pc) loop
    if e.key not in ('secondsPerTick', 'graceSeconds', 'maxGapSeconds') then
      raise exception 'Pace rule: "%" is not one of secondsPerTick, graceSeconds, maxGapSeconds.', e.key
        using errcode = 'check_violation';
    end if;

    if jsonb_typeof(e.value) <> 'number' then
      raise exception 'Pace rule: % must be a number.', e.key using errcode = 'check_violation';
    end if;

    n := (e.value #>> '{}')::numeric;

    if n <> trunc(n) then
      raise exception 'Pace rule: % must be a whole number of seconds.', e.key
        using errcode = 'check_violation';
    end if;

    -- The bounds are the resolver's, and they are stated in both places for the reason
    -- RULE_VERSION_MAX records (shared/domain/points.js:434-437): a bound the validator enforces
    -- must be inside the range the resolver casts to, or the resolver's forgiveness is a raise.
    lo := case e.key when 'maxGapSeconds' then 5 else 0 end;
    hi := case e.key when 'secondsPerTick' then 3600
                     when 'graceSeconds'   then 86400
                     else 3600 end;

    if n < lo or n > hi then
      raise exception 'Pace rule: % is between % and % (got %).', e.key, lo, hi, n
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists settings_check_pace on public.settings;

create trigger settings_check_pace
  before insert or update on public.settings
  for each row
  execute function public.settings_check_pace();

comment on function public.settings_check_pace() is
  'Refuses a malformed points.pace block before it is stored (0035). Its own trigger rather than '
  'a widening of settings_check_points(), whose tick block owns a different closed key list.';

-- ================================================================ what an attempt cost in time

-- How long the યુવક was actually at it, in milliseconds, or NULL when nobody measured.
--
-- **Written only by `level3_finalize()`, and only from this database's own clock.** No client
-- sends it, no RPC accepts it, and `activity_submit()` — which is not reissued — leaves it NULL.
--
-- NULL therefore means "unmeasured", and the pace rule does not bind an unmeasured attempt. That
-- is the deliberate reading and it is worth being plain about the cost: a handset still running
-- a bundle cached before this migration submits through `activity_submit()`, arrives with NULL,
-- and is paid without a pace check exactly as it is today. The alternative — treating NULL as
-- zero seconds — would stop paying every yuvak who had not yet reloaded, which is a worse
-- failure than a transitional gap that closes itself as bundles roll over.
alter table public.activity_attempts
  add column if not exists engaged_ms bigint;

alter table public.activity_attempts
  drop constraint if exists activity_attempts_engaged_check;

alter table public.activity_attempts
  add constraint activity_attempts_engaged_check
  check (engaged_ms is null or engaged_ms >= 0);

comment on column public.activity_attempts.engaged_ms is
  'Server-measured attention behind this attempt, in ms, or NULL when unmeasured (0035). '
  'Accumulated by level3_draft_save() from its own now(); never supplied by any client.';

-- ================================================================ the unfinished પુનરાવર્તન

-- One row per યુવક: the પુનરાવર્તન he is in the middle of.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Why one row and not one per session
-- ────────────────────────────────────────────────────────────────────────────
--
-- The requirement (§6) asks for every finished પુનરાવર્તન to be an independent, immutable event
-- with its own number, its દ્રશ્યો, its count and its points. **That table already exists.**
-- `activity_attempts` is append-only, has `attempt_number` scoped to (યુવક, level, activity,
-- day), stores `selected_scene_ids`, and is what every history view, every admin report and
-- `point_bonus_count()` already read. Adding a second one would be the duplicate §18 forbids and
-- would immediately raise the question of which of the two the board believes.
--
-- What has never existed is the **draft**: the ticks a યુવક has made and not yet finished with.
-- A draft is not an event — it has no number, no points and no place in any history — and there
-- is only ever one of them per યુવક, so it is one row keyed by him.
--
-- Finalising copies the draft into an `activity_attempts` row and empties it. **Emptying is what
-- starting the next પુનરાવર્તન is** (§3, §11): the history is untouched, the ledger is untouched,
-- the day's earlier revisions keep their points, and only the boxes clear. There is no state in
-- which resetting can subtract anything, because nothing in this table has ever been added to.
create table if not exists public.level3_drafts (
  user_id       uuid primary key references public.profiles (id) on delete cascade,

  -- The IST day the draft belongs to. A draft that survives midnight is rolled rather than
  -- carried: the ticks belong to the day they were made, and `level3_draft_get()` finalises the
  -- old day before opening the new one so nothing is silently re-dated.
  activity_date date not null default (timezone('Asia/Kolkata', now())::date),

  scene_ids     text[] not null default '{}',

  -- Attention, in milliseconds, accumulated server-side. See level3_draft_save().
  engaged_ms    bigint not null default 0,

  started_at    timestamptz not null default now(),
  -- The clock the next gap is measured from. Distinct from `started_at`, which never moves.
  updated_at    timestamptz not null default now(),

  -- Held across a retried finalise so that a lost response cannot become a second પુનરાવર્તન.
  -- Cleared when the draft is emptied, because the next પુનરાવર્તન is a different intention.
  client_token  uuid
);

alter table public.level3_drafts
  add column if not exists activity_date date not null default (timezone('Asia/Kolkata', now())::date),
  add column if not exists scene_ids     text[] not null default '{}',
  add column if not exists engaged_ms    bigint not null default 0,
  add column if not exists started_at    timestamptz not null default now(),
  add column if not exists updated_at    timestamptz not null default now(),
  add column if not exists client_token  uuid;

alter table public.level3_drafts
  drop constraint if exists level3_drafts_engaged_check;

alter table public.level3_drafts
  add constraint level3_drafts_engaged_check check (engaged_ms >= 0);

create index if not exists level3_drafts_date_idx
  on public.level3_drafts (activity_date desc);

comment on table public.level3_drafts is
  'The લેવલ ૩ પુનરાવર્તન a યુવક is in the middle of (0035): the ticks so far and the attention '
  'behind them. One row per યુવક — the finished revisions are activity_attempts rows and this '
  'is not a second copy of them. Emptied on finalise, which is what beginning the next '
  'પુનરાવર્તન means; nothing here is ever subtracted from anything.';

-- ================================================================ the award engine, reissued

-- `award_points()`, with two new facts in the તિક branch and nothing else changed.
--
-- Reissued rather than wrapped, which is what 0031 and 0033 both did to this same function for
-- this same kind of change. The signature, the callers and every other branch are untouched:
-- `activity_submit()` step 9 and the `level4_attempts_award` trigger still call it, the flat
-- branch still reads `earn.levelN`, the લેવલ ૪ repeat branch is unmoved, and `point_bonus_apply()`
-- is still added to every return.
--
-- What the તિક branch learns:
--
--   1. **The catalogue.** A દ્રશ્ય id that is not in `live_scene_ids()` is not counted — the
--      check 0021:804-806 said it could not make. Skipped entirely while the catalogue is empty,
--      so applying this migration alone changes nothing.
--   2. **The collection's size as a ceiling**, from `admin_content_total()`, which holds even
--      with no catalogue.
--   3. **The pace rule.** Paid ticks are capped by measured attention at the સંચાલક's rate.
--
-- All three only ever *reduce* a count. There is no configuration of this file under which a
-- submission is paid for more than it was paid for before.
create or replace function public.award_points(
  p_user    uuid,
  p_date    date,
  p_level   integer,
  p_key     text,
  p_source  text,
  p_source_id bigint,
  p_attempt integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rules      jsonb;
  key        text := coalesce(p_key, '');
  value_now  integer;
  written    integer := 0;
  mode       text;
  counting   text;
  earn_mode  text;
  fresh      integer;
  paid_today integer;
  cap        integer;
  rep_value  integer;
  rep_limit  integer;
  rep_today  integer;
  -- 0035 — the દ્રશ્ય catalogue and the pace rule.
  live       text[];
  catalog_on boolean;
  pace       jsonb;
  per_tick_s integer;
  engaged    bigint;
  allowed    integer;
  content_n  integer;
begin
  if p_user is null or p_date is null or p_level is null then
    return 0;
  end if;

  -- The off switch, and it has to be asked here rather than left to `point_value_for()`.
  -- 0031's reasoning, unchanged and now covering three more branches: `point_rules()` resolves
  -- the new keys and knows nothing about `enabled`, so without this line a project with points
  -- switched off and an `earn` mode or a milestone rule still configured would go on paying.
  -- A scoring system nobody switched on is what §J3 forbids.
  if not (select s.enabled from public.point_settings() s) then
    return 0;
  end if;

  if not public.point_rule_live(p_level, key, p_date) then
    return 0;
  end if;

  rules := public.point_rules();

  -- ── લેવલ ૩ under a tick rule ──────────────────────────────────────────────
  if p_level = 3 and (rules #>> '{tick,mode}') in ('TICK', 'REVISION') then
    mode := rules #>> '{tick,mode}';

    -- 0035. The two facts every count below is filtered by, read once for the statement rather
    -- than once per row (`admin_withheld_scene_ids()`'s own reasoning, 0029:193-195).
    -- `catalog_on` false means the catalogue has never been synced, and every membership test
    -- is then skipped — an unsynced project pays exactly what it paid before this migration.
    catalog_on := public.scene_catalog_ready();
    live       := public.live_scene_ids();

    if mode = 'REVISION' then
      -- Per submission. The idempotency key is the attempt, so a retried submit pays once and
      -- a genuinely new નોંધાવો pays again.
      value_now := (rules #>> '{tick,perRevision}')::integer;
    else
      counting := coalesce(rules #>> '{earn,tickCount}', 'FRESH');

      if counting = 'ALL' then
        -- Every valid દ્રશ્ય this submission names, whether or not an earlier submission of
        -- the same day already named it. The distinct is still taken **within** the attempt —
        -- a client that posts the same id twice has ticked it once — and the withheld ones are
        -- still subtracted, because a દ્રશ્ય the સંચાલક has taken out of the collection is not
        -- one that may be paid.
        select count(*)::integer into fresh
        from (
          select distinct s.scene_id
          from public.activity_attempts a
          cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
          where a.id = p_source_id
            and not (s.scene_id = any (public.admin_withheld_scene_ids()))
            -- 0035: and not an id the catalogue has never heard of. This is the check
            -- activity_submit() said it could not make (0021:804-806) — five hundred invented
            -- ids now count as nothing rather than as five hundred ticks.
            and (not catalog_on or s.scene_id = any (live))
        ) mine;
      else
        -- 0031's rule, unchanged: દ્રશ્યો newly brought to mind today. The distinct દ્રશ્યો
        -- named by this attempt, minus any withheld, minus every one already named by an
        -- earlier attempt of the same day. Without that last subtraction a યુવક submitting the
        -- same ૧૦૮ ticks five times is paid for ૫૪૦ ticks he made once.
        select count(*)::integer into fresh
        from (
          select distinct s.scene_id
          from public.activity_attempts a
          cross join lateral unnest(a.selected_scene_ids) as s(scene_id)
          where a.id = p_source_id
            and not (s.scene_id = any (public.admin_withheld_scene_ids()))
            -- 0035: and not an id the catalogue has never heard of. This is the check
            -- activity_submit() said it could not make (0021:804-806) — five hundred invented
            -- ids now count as nothing rather than as five hundred ticks.
            and (not catalog_on or s.scene_id = any (live))
        ) mine
        where not exists (
          select 1
          from public.activity_attempts e
          cross join lateral unnest(e.selected_scene_ids) as t(scene_id)
          where e.user_id = p_user
            and e.activity_date = p_date
            and e.level_id = 3
            and e.activity_key = key
            and e.id < p_source_id
            and t.scene_id = mine.scene_id
        );
      end if;

      -- ── 0035: the collection is a ceiling on any one submission ──────────
      --
      -- The backstop under the catalogue, and it holds even while the catalogue is empty: a
      -- submission cannot be paid for more દ્રશ્યો than the collection is known to contain.
      -- `admin_content_total()` (0029:150) derives that from what attempts have reported over
      -- the last 180 days, so it is the server's own number and never a browser's.
      content_n := public.admin_content_total();
      if content_n > 0 then
        fresh := least(fresh, content_n);
      end if;

      -- ── 0035: the pace rule — "૫૦ ટિક માટે ૫૦ સેકંડ" ──────────────────────
      --
      -- One તિક is worth one second of attention, at whatever rate the સંચાલક set. **A cap and
      -- never a gate**: ૫૦ ticks in ૪૫ seconds is ૪૫, not nothing — a gate would punish a યુવક
      -- who was half a minute quick exactly as hard as one who flicked to the bottom, and §1
      -- rule 4 refuses that reading.
      --
      -- `engaged_ms` is this database's own measurement, accumulated by level3_draft_save()
      -- from its own now(); no client can send it. NULL means unmeasured and does not bind —
      -- see the column comment for why that is the safe direction during a bundle rollover.
      --
      -- Per-તિક mode only. `REVISION` mode prices a submission rather than a દ્રશ્ય, so a rule
      -- written per તિક has nothing to say about it, and half-applying it would be worse than
      -- not applying it.
      pace       := public.point_pace();
      per_tick_s := (pace ->> 'secondsPerTick')::integer;

      if per_tick_s > 0 and p_source = 'ACTIVITY_ATTEMPT' and fresh > 0 then
        select a.engaged_ms into engaged
        from public.activity_attempts a
        where a.id = p_source_id;

        if engaged is not null then
          -- Integer division throughout, so a part-second buys nothing and the arithmetic this
          -- performs is the arithmetic a યુવક can do in his head.
          allowed := ((engaged / 1000) + (pace ->> 'graceSeconds')::integer) / per_tick_s;
          fresh   := greatest(least(fresh, allowed), 0);
        end if;
      end if;

      value_now := fresh * (rules #>> '{tick,perTick}')::integer;

      -- The day's ceiling, if the સંચાલક set one. Read from the ledger rather than counted in
      -- the caller, so a second phone submitting at the same moment cannot spend the same
      -- headroom twice.
      cap := (rules #>> '{tick,dailyCap}')::integer;
      if cap > 0 then
        select coalesce(sum(t.points), 0)::integer into paid_today
        from public.point_transactions t
        where t.user_id = p_user
          and t.activity_date = p_date
          and t.award_kind = 'TICK';

        value_now := least(value_now, greatest(cap - paid_today, 0));
      end if;
    end if;

    written := public.point_award(
      p_user, p_date, p_level, key, value_now,
      case when mode = 'TICK' then 'TICK' else 'REVISION' end,
      p_source, p_source_id, p_attempt,
      lower(mode) || ':' || coalesce(p_source_id, 0)::text
    );

    -- The tick rule is already a per-submission rule, so `earn.level3` has nothing to say to
    -- it: choosing between "per દ્રશ્ય" and "per નોંધાવો" is what `tick.mode` is, and stacking
    -- a second per-submission rule on top would pay twice for one act under two names (§G).
    return written + public.point_bonus_apply(
      p_user, p_date, p_level, key, p_source, p_source_id, p_attempt);
  end if;

  -- ── the flat branch, under the level's earning mode ───────────────────────
  --
  -- `'level' || p_level` and not a lookup in a list of four: the resolver does not enumerate
  -- the ladders and neither does this. A level with no key configured reads DAY_FIRST, which
  -- is 0021's rule and is what an untouched project gets at every level.
  earn_mode := coalesce(rules #>> array['earn', 'level' || p_level::text], 'DAY_FIRST');

  value_now := coalesce(public.point_value_for(p_level, key), 0);

  if value_now > 0 then
    if earn_mode = 'EVERY' then
      -- Keyed on the event, so a retried submission of ONE act still pays once while a genuine
      -- second act pays again. `p_source` is part of the key because `activity_attempts.id`
      -- and `level4_attempts.id` are independent bigserials that both start at 1 — the id
      -- alone is not unique across the two ladders, which is the same collision
      -- `attempt_history` (0021:1141) offsets by 2^62 to avoid.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now, 'REPEAT',
        p_source, p_source_id, p_attempt,
        'every:' || coalesce(p_source, '') || ':' || coalesce(p_source_id, 0)::text
      );
    elsif earn_mode = 'ONCE' then
      -- Once per (યુવક, level, activity) for all time. The key carries all three because
      -- point_transactions_idem_idx is global — a key of 'once:1:video' would let the first
      -- યુવક to finish લેવલ ૧ spend it for everybody.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now, 'REPEAT',
        p_source, p_source_id, p_attempt,
        'once:' || p_user::text || ':' || p_level::text || ':' || key
      );
    else
      -- 0021's rule, unchanged, arbitrated by the day index and carrying no key.
      written := public.point_award(
        p_user, p_date, p_level, key, value_now,
        'DAY_FIRST', p_source, p_source_id, p_attempt, null
      );
    end if;
  end if;

  -- ── the repeat rule ───────────────────────────────────────────────────────
  --
  -- Reached only under DAY_FIRST and only when the day-scoped award wrote nothing: either the
  -- day was already paid, or this level is worth nothing. લેવલ ૪ only, because "sitting the
  -- કસોટી again" is the act the સંચાલક asked to be able to price. Under EVERY the question
  -- does not arise — every submission has already been paid — and under ONCE a second award is
  -- precisely what the mode refuses.
  if written = 0
     and earn_mode = 'DAY_FIRST'
     and p_level = 4
     and (rules #> '{repeat,enabled}') = 'true'::jsonb then

    rep_value := coalesce(
      case when jsonb_typeof(rules #> '{repeat,byCode}' -> key) = 'number'
           then (rules #>> array['repeat', 'byCode', key])::integer end,
      (rules #>> '{repeat,default}')::integer,
      0
    );

    if rep_value > 0 then
      rep_limit := (rules #>> '{repeat,dailyLimit}')::integer;

      if rep_limit > 0 then
        select count(*)::integer into rep_today
        from public.point_transactions t
        where t.user_id = p_user
          and t.activity_date = p_date
          and t.award_kind = 'REPEAT';
      else
        rep_today := 0;
      end if;

      if rep_limit = 0 or rep_today < rep_limit then
        written := public.point_award(
          p_user, p_date, 4, key, rep_value, 'REPEAT',
          p_source, p_source_id, p_attempt,
          'repeat:' || coalesce(p_source_id, 0)::text
        );
      end if;
    end if;
  end if;

  -- The milestones, whatever the base award did. See step 4 in the header above.
  return written + public.point_bonus_apply(
    p_user, p_date, p_level, key, p_source, p_source_id, p_attempt);
end;
$$;

revoke all on function public.award_points(uuid, date, integer, text, text, bigint, integer) from public;

comment on function public.award_points(uuid, date, integer, text, text, bigint, integer) is
  'Applies the live point rules to one recorded event and returns what was written (0021, '
  'reissued 0031, 0033 and 0035). Same signature, same callers. 0035 adds three reductions to '
  'the તિક branch and only to it: દ્રશ્ય ids are checked against live_scene_ids() when the '
  'catalogue has been synced, no submission is paid for more દ્રશ્યો than admin_content_total() '
  'knows the collection to hold, and paid ticks are capped by the server-measured attention '
  'behind the attempt at point_pace().secondsPerTick. Every other branch is 0033''s, unchanged.';

-- ================================================================ paying a partial પુનરાવર્તન

-- The fault at the top of this file, fixed the way લેવલ ૪ already does it.
--
-- `activity_submit()` awards only a COMPLETED attempt (0021:970), so a ૫૦/૧૦૮ પુનરાવર્તન never
-- reached the award engine — under a per-તિક rule, which exists to pay exactly that, it was paid
-- nothing. The function is 0021's statement of what an attempt is and is deliberately not
-- reissued here; so the award arrives the way a passed કસોટી's does, from an AFTER INSERT
-- trigger on the row itself (`level4_attempts_award`, 0021:1096-1100).
--
-- **Only the attempts `activity_submit()` skips**, which is why the trigger's WHEN clause tests
-- `status <> 'COMPLETED'`. A COMPLETED attempt is still paid by step 9 and still reports its
-- figure back to the screen; overlapping the two would have made `pointsAwarded` read 0 for
-- everybody, because the second call to a keyed award is an idempotent no-op and returns
-- nothing. (It would have been *safe* — `tick:<attempt id>` guarantees one payment either way —
-- just silently wrong on screen.)
--
-- **Only under a તિક rule.** Under `tick.mode = 'ACTIVITY'`, which is what every unconfigured
-- project runs, a partial પુનરાવર્તન goes on earning nothing exactly as it does today. Paying it
-- the flat day value would be this migration changing what a project pays without anybody asking
-- it to, which is the surprise DEFAULT_POINTS refuses to be.
create or replace function public.activity_attempts_level3_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.point_rules() #>> '{tick,mode}') not in ('TICK', 'REVISION') then
    return null;
  end if;

  perform public.award_points(
    new.user_id,
    new.activity_date,
    3,
    new.activity_key,
    'ACTIVITY_ATTEMPT',
    new.id,
    new.attempt_number
  );

  return null;
end;
$$;

drop trigger if exists activity_attempts_level3_award on public.activity_attempts;

create trigger activity_attempts_level3_award
  after insert on public.activity_attempts
  for each row
  when (new.level_id = 3 and new.status <> 'COMPLETED')
  execute function public.activity_attempts_level3_award();

comment on function public.activity_attempts_level3_award() is
  'Pays a partial લેવલ ૩ પુનરાવર્તન under a તિક rule (0035), from an AFTER INSERT trigger rather '
  'than from inside activity_submit() — the same division level4_attempts_award() uses (0021). '
  'Fires only for the attempts step 9 skips (status <> COMPLETED) and only when tick.mode is '
  'TICK or REVISION, so an unconfigured project is unaffected. The award is idempotent on '
  'tick:<attempt id>, so it cannot double-pay whatever else runs.';

-- ================================================================ the day's derived row

-- Recount `daily_activity_progress` for one (યુવક, day, level, activity).
--
-- Lifted verbatim from `activity_submit()` step 8 (0021:907-962), including its rule that the
-- row is **recounted in full and never incremented** — so a retry, a double submit or a lost
-- response cannot inflate it, and a row that has somehow drifted is corrected by the next call.
-- `completed_items` is the size of the day's *union* of દ્રશ્યો and not `max(completed_items)`,
-- because a યુવક who covers ૪૦ this morning and a different ૪૦ this afternoon has covered ૮૦.
--
-- It exists as a function because `level3_finalize()` writes attempts without going through
-- `activity_submit()`, and the day's derived row must not be left describing yesterday.
-- `activity_submit()` keeps its inline copy: reissuing it to call this would mean reissuing
-- 0021's definition of an attempt to save a duplication, and the duplication is the cheaper of
-- the two risks.
create or replace function public.daily_activity_progress_recount(
  p_user  uuid,
  p_date  date,
  p_level integer,
  p_key   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with day as (
    select a.*
    from public.activity_attempts a
    where a.user_id = p_user
      and a.activity_date = p_date
      and a.level_id = p_level
      and a.activity_key = p_key
  ),
  ids as (
    select distinct s.scene_id
    from day d
    cross join lateral unnest(d.selected_scene_ids) as s(scene_id)
  )
  insert into public.daily_activity_progress
    (user_id, activity_date, level_id, activity_key,
     total_items, completed_items, completed_scene_ids, attempt_count, status,
     started_at, completed_at, updated_at)
  select
    p_user, p_date, p_level, p_key,
    coalesce(max(d.total_items), 0),
    (select count(*) from ids i)::integer,
    coalesce((select array_agg(i.scene_id order by i.scene_id) from ids i), '{}'::text[]),
    count(*)::integer,
    case when bool_or(d.status = 'COMPLETED') then 'COMPLETED' else 'REVISION_REQUIRED' end,
    coalesce(min(d.submitted_at), now()),
    min(d.submitted_at) filter (where d.status = 'COMPLETED'),
    now()
  from day d
  having count(*) > 0
  on conflict (user_id, activity_date, level_id, activity_key) do update
    set total_items         = excluded.total_items,
        completed_items     = excluded.completed_items,
        completed_scene_ids = excluded.completed_scene_ids,
        attempt_count       = excluded.attempt_count,
        status              = excluded.status,
        started_at          = least(daily_activity_progress.started_at, excluded.started_at),
        completed_at        = coalesce(daily_activity_progress.completed_at, excluded.completed_at),
        updated_at          = now();
end;
$$;

revoke all on function public.daily_activity_progress_recount(uuid, date, integer, text) from public;

comment on function public.daily_activity_progress_recount(uuid, date, integer, text) is
  'Recounts one (યુવક, day, level, activity) row of daily_activity_progress from the day''s '
  'attempts (0035). activity_submit() step 8''s logic, verbatim, so level3_finalize() can keep '
  'the derived row honest without that function being reissued.';

-- ================================================================ what the page reads

-- Everything લેવલ ૩ needs to draw itself, as one document.
--
-- One function shared by every RPC below, so that the shape a save returns and the shape a fetch
-- returns are the same shape — 0034's reasoning for `daily_record_snapshot()`, and the same
-- consequence: a screen that had to reconcile two documents is a screen with a second copy of
-- the rules in it.
--
-- **Every number here is counted, and none is stored.** The current પુનરાવર્તન is the draft;
-- the finished ones are `activity_attempts` rows; the points are `point_transactions` rows. §10
-- of the requirement asks for the first two to be visibly separate figures and this is where
-- that separation is made — `current` is a session, `today` and `total` are history, and nothing
-- adds one to the other.
create or replace function public.level3_snapshot(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d        public.level3_drafts%rowtype;
  today    date := timezone('Asia/Kolkata', now())::date;
  pace     jsonb := public.point_pace();
  per_s    integer;
  live     text[] := public.live_scene_ids();
  ready    boolean := public.scene_catalog_ready();
  valid    text[];
  eligible integer;
begin
  select * into d from public.level3_drafts where user_id = p_user;

  per_s := (pace ->> 'secondsPerTick')::integer;

  -- The draft's ticks, as the award engine would see them today. Shown rather than the raw
  -- array so the count on screen is the count that would be paid — a યુવક reading ૫૦ and being
  -- paid ૪૭ because three દ્રશ્યો were withdrawn at noon would be the page disagreeing with the
  -- ledger about what he just did.
  select coalesce(array_agg(distinct s.sid), '{}'::text[]) into valid
  from unnest(coalesce(d.scene_ids, '{}'::text[])) as s(sid)
  where not (s.sid = any (public.admin_withheld_scene_ids()))
    and (not ready or s.sid = any (live));

  -- How many of them the clock has earned so far. `null` when no pace rule is configured, which
  -- the screen reads as "there is nothing to say about time" rather than as a limit of zero.
  if per_s > 0 then
    eligible := greatest(
      least(
        coalesce(cardinality(valid), 0),
        ((coalesce(d.engaged_ms, 0) / 1000) + (pace ->> 'graceSeconds')::integer) / per_s
      ), 0);
  end if;

  return jsonb_build_object(
    'date', today,

    -- ── the પુનરાવર્તન he is in the middle of ────────────────────────────────
    'current', jsonb_build_object(
      'open',      (d.user_id is not null),
      'date',      d.activity_date,
      'sceneIds',  to_jsonb(coalesce(valid, '{}'::text[])),
      'ticks',     coalesce(cardinality(valid), 0),
      'engagedMs', coalesce(d.engaged_ms, 0),
      'startedAt', d.started_at,
      'savedAt',   d.updated_at,
      -- What finalising right now would be worth, at the pace rule. NULL when no rule is set.
      'eligibleTicks', eligible
    ),

    'pace', jsonb_build_object(
      'secondsPerTick', per_s,
      'graceSeconds',   (pace ->> 'graceSeconds')::integer,
      -- The whole session's requirement, so the page can say "આશરે N મિનિટ" without doing the
      -- multiplication itself (§17 — the client computes nothing the server can state).
      'requiredSeconds', case when per_s > 0
                              then coalesce(cardinality(valid), 0) * per_s
                              else 0 end
    ),

    -- ── today ────────────────────────────────────────────────────────────────
    'today', (
      select jsonb_build_object(
        'revisions', coalesce(count(*), 0),
        'ticks',     coalesce(sum(coalesce(cardinality(a.selected_scene_ids), 0)), 0),
        'points',    coalesce((
          select sum(t.points) from public.point_transactions t
          where t.user_id = p_user and t.activity_date = today and t.level_id = 3
        ), 0)
      )
      from public.activity_attempts a
      where a.user_id = p_user and a.activity_date = today
        and a.level_id = 3 and a.activity_key = 'revision'
    ),

    -- ── every પુનરાવર્તન he has ever finished ────────────────────────────────
    --
    -- `ticks` is the **sum** of the per-પુનરાવર્તન counts and not the size of their union, which
    -- is the requirement's arithmetic said out loud (§2, §9): ૫૦ then ૪૦ is ૯૦ whether or not
    -- the second forty were the same દ્રશ્યો. A યુવક who brings the same fifty to mind twice has
    -- done the સાધના twice, and the union would report that he had done it once.
    'total', (
      select jsonb_build_object(
        'revisions', coalesce(count(*), 0),
        'ticks',     coalesce(sum(coalesce(cardinality(a.selected_scene_ids), 0)), 0),
        'days',      coalesce(count(distinct a.activity_date), 0),
        'lastAt',    max(a.submitted_at),
        'points',    coalesce((
          select sum(t.points) from public.point_transactions t
          where t.user_id = p_user and t.level_id = 3
        ), 0)
      )
      from public.activity_attempts a
      where a.user_id = p_user and a.level_id = 3 and a.activity_key = 'revision'
    ),

    -- ── today's finished પુનરાવર્તન, newest first ────────────────────────────
    --
    -- Today only. The whole history is `/history`'s to render and is already there; what this
    -- page needs is the list §27 asks it to print under the current session — "૫૦ ticks → +૫૦"
    -- — so a યુવક can see that resetting took nothing away from him.
    'revisions', coalesce((
      select jsonb_agg(r order by r ->> 'at' desc)
      from (
        select jsonb_build_object(
          'n',         a.attempt_number,
          'ticks',     coalesce(cardinality(a.selected_scene_ids), 0),
          'at',        a.submitted_at,
          'engagedMs', a.engaged_ms,
          'status',    a.status,
          'points',    coalesce((
            select sum(t.points) from public.point_transactions t
            where t.user_id = p_user and t.source = 'ACTIVITY_ATTEMPT' and t.source_id = a.id
          ), 0)
        ) as r
        from public.activity_attempts a
        where a.user_id = p_user and a.activity_date = today
          and a.level_id = 3 and a.activity_key = 'revision'
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.level3_snapshot(uuid) from public;

comment on function public.level3_snapshot(uuid) is
  'Everything લેવલ ૩ renders, as one document (0035): the unfinished પુનરાવર્તન, the pace rule, '
  'today, the lifetime totals and today''s finished પુનરાવર્તન. Counted from level3_drafts, '
  'activity_attempts and point_transactions — nothing here is stored and nothing is a second '
  'scoring computation. total.ticks is the SUM of the per-પુનરાવર્તન counts, never the size of '
  'their union: ૫૦ then ૪૦ is ૯૦.';

-- ================================================================ opening the પુનરાવર્તન

-- The draft as it stands, creating one if he has never had a session and rolling it if the day
-- has turned.
--
-- **Rolling finalises rather than re-dates.** A draft made yesterday evening holds yesterday's
-- સાધના, and quietly stamping today's date on it would file work under a day it did not happen
-- and hand a યુવક points for a morning he has not had. So the old day's ticks are finished
-- against their own date first — the ordinary "he closed the app mid-પુનરાવર્તન and came back
-- tomorrow" — and the new day starts empty. Nothing is ever discarded.
create or replace function public.level3_draft_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  today date := timezone('Asia/Kolkata', now())::date;
  d     public.level3_drafts%rowtype;
begin
  if actor is null then
    raise exception 'level3_not_signed_in' using errcode = '42501';
  end if;

  if not public.is_active_user() then
    raise exception 'level3_not_active' using errcode = '42501';
  end if;

  select * into d from public.level3_drafts where user_id = actor;

  if d.user_id is null then
    insert into public.level3_drafts (user_id, activity_date)
    values (actor, today)
    on conflict (user_id) do nothing;

  elsif d.activity_date <> today then
    if coalesce(cardinality(d.scene_ids), 0) > 0 then
      perform public.level3_commit(actor, d.activity_date, null);
    end if;

    update public.level3_drafts
       set activity_date = today,
           scene_ids     = '{}'::text[],
           engaged_ms    = 0,
           started_at    = now(),
           updated_at    = now(),
           client_token  = null
     where user_id = actor;
  end if;

  return public.level3_snapshot(actor);
end;
$$;

revoke all on function public.level3_draft_get() from public;
grant execute on function public.level3_draft_get() to authenticated;

comment on function public.level3_draft_get() is
  'The યુવક''s current લેવલ ૩ પુનરાવર્તન, opened if he has none and rolled if the day has turned '
  '(0035). Rolling finalises yesterday''s ticks against yesterday''s date rather than re-dating '
  'them. Derives the યુવક from auth.uid() and takes no parameter that could name another.';

-- ================================================================ saving, and the clock

-- The autosave. Every tick, coalesced by the caller into one call every few seconds.
--
-- ────────────────────────────────────────────────────────────────────────────
-- The clock is this function's, and that is the whole of §17 for this feature
-- ────────────────────────────────────────────────────────────────────────────
--
-- There is no duration parameter. Attention is the gap between one call and the next, measured
-- against this database's `now()`, and a gap longer than `pace.maxGapSeconds` is not counted at
-- all — a phone left open on a bus adds nothing, a યુવક who reads a વર્ણન for forty seconds
-- before ticking it adds forty. There is no request anybody can send that makes the number
-- larger than the time that actually passed.
--
-- The consequence, and it is the point: to be paid for ૧૦૮ ticks at one second each, the page
-- must genuinely stay open and saving for about ૧૦૮ seconds. Ticking every box in four seconds
-- and leaving records ૧૦૮ ticks and is paid for four.
--
-- The ids are stored as sent, only deduplicated and blank-stripped. Filtering to the live
-- collection happens where it is read (`level3_snapshot`) and where it is paid (`award_points`),
-- never here: a દ્રશ્ય the સંચાલક withholds at noon and restores at one o'clock should not have
-- been silently deleted from a યુવક's afternoon.
create or replace function public.level3_draft_save(p_scene_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor  uuid := auth.uid();
  today  date := timezone('Asia/Kolkata', now())::date;
  d      public.level3_drafts%rowtype;
  gap_ms bigint;
  max_ms bigint;
  ids    text[];
begin
  if actor is null then
    raise exception 'level3_not_signed_in' using errcode = '42501';
  end if;

  if not public.is_active_user() then
    raise exception 'level3_not_active' using errcode = '42501';
  end if;

  -- Opens or rolls first, so a save is never the thing that creates a mis-dated draft.
  perform public.level3_draft_get();

  select * into d from public.level3_drafts where user_id = actor for update;

  select coalesce(array_agg(distinct s.sid), '{}'::text[]) into ids
  from unnest(coalesce(p_scene_ids, '{}'::text[])) as s(sid)
  where nullif(btrim(s.sid), '') is not null;

  max_ms := (public.point_pace() ->> 'maxGapSeconds')::bigint * 1000;
  gap_ms := greatest((extract(epoch from (now() - d.updated_at)) * 1000)::bigint, 0);

  if gap_ms > max_ms then
    gap_ms := 0;
  end if;

  update public.level3_drafts
     set scene_ids     = ids,
         activity_date = today,
         engaged_ms    = engaged_ms + gap_ms,
         updated_at    = now(),
         -- A different set of ticks is a different intention, so a token minted for the previous
         -- set must not make this one a replay of it. Same rule LevelPage's signature keeps on
         -- the handset, kept here as well because the handset is not trusted to.
         client_token  = case when scene_ids is distinct from ids then null else client_token end
   where user_id = actor;

  return public.level3_snapshot(actor);
end;
$$;

revoke all on function public.level3_draft_save(text[]) from public;
grant execute on function public.level3_draft_save(text[]) to authenticated;

comment on function public.level3_draft_save(text[]) is
  'Stores the ticks of the પુનરાવર્તન in progress and accumulates the attention behind them '
  '(0035). The duration is measured from this database''s own clock — there is no parameter for '
  'it and there must not be one (§17) — and a gap longer than pace.maxGapSeconds counts as '
  'nothing. Awards no points; only level3_commit() does that.';

-- ================================================================ finishing a પુનરાવર્તન

-- Turn the draft into an immutable event, pay it, and empty the draft.
--
-- The shared body behind `level3_finalize()` and the day-roll in `level3_draft_get()`, taking
-- the user and the date explicitly so the roll can finish yesterday against yesterday.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency, which is enforced here and not in React (§7)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Three defences, in order, and each covers what the one before it cannot:
--
--   1. **The token**, matched against `activity_attempts.client_token` before anything is
--      written. A double tap, a refresh, a reply the phone never received: all return the
--      snapshot without writing. The partial unique index `activity_attempts_token_idx` (0021)
--      is what makes it a guarantee rather than a check, and the `unique_violation` handler
--      below is where a retry that raced the original lands.
--   2. **An empty draft finalises nothing.** Pressing નોંધાવો twice in a row cannot make a
--      second પુનરાવર્તન out of no ticks, because the first press emptied the draft.
--   3. **The award key.** `tick:<attempt id>` through `point_award()`, so even if two attempts
--      somehow existed, each is paid once and only once, for ever.
--
-- Nothing in the browser is trusted with any of it.
create or replace function public.level3_commit(
  p_user  uuid,
  p_date  date,
  p_token uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  d        public.level3_drafts%rowtype;
  att      public.activity_attempts%rowtype;
  ids      text[];
  n        integer;
  total_n  integer;
  st       text;
  tries    integer := 0;
begin
  select * into d from public.level3_drafts where user_id = p_user for update;

  if d.user_id is null then
    return null;
  end if;

  ids := coalesce(d.scene_ids, '{}'::text[]);
  n   := coalesce(cardinality(ids), 0);

  if n = 0 then
    return null;
  end if;

  -- The retry, answered before a row moves.
  if p_token is not null then
    select * into att
    from public.activity_attempts a
    where a.user_id = p_user and a.client_token = p_token;

    if found then
      return att.id;
    end if;
  end if;

  -- What the કસોટી asked for. The server's own number (`admin_content_total()`, 0029:150) and
  -- never a browser's, and `greatest` so a collection smaller than what he ticked — which
  -- happens the day a દ્રશ્ય is added and the estimate has not caught up — cannot make a full
  -- પુનરાવર્તન read as more than the whole.
  total_n := greatest(public.admin_content_total(), n);
  st      := case when n >= total_n and total_n > 0 then 'COMPLETED' else 'REVISION_REQUIRED' end;

  -- The attempt number is computed inside the INSERT so it is the server's answer and cannot be
  -- supplied; the loop is 0021:847-890's, for the same race and with the same five tries.
  loop
    tries := tries + 1;

    begin
      insert into public.activity_attempts
        (user_id, level_id, activity_key, activity_date, attempt_number,
         selected_scene_ids, total_items, completed_items, status,
         client_token, engaged_ms, submitted_at)
      select
        p_user, 3, 'revision', p_date,
        coalesce(max(a.attempt_number), 0) + 1,
        ids, total_n, n, st, p_token, d.engaged_ms, now()
      from public.activity_attempts a
      where a.user_id = p_user
        and a.level_id = 3
        and a.activity_key = 'revision'
        and a.activity_date = p_date
      returning * into att;

      exit;

    exception when unique_violation then
      -- The token index means a retry raced the original and the original won; hand back its
      -- row. Anything else is the attempt-number race, which is retried.
      if p_token is not null then
        select * into att
        from public.activity_attempts a
        where a.user_id = p_user and a.client_token = p_token;

        if found then
          return att.id;
        end if;
      end if;

      if tries >= 5 then
        raise;
      end if;
    end;
  end loop;

  perform public.daily_activity_progress_recount(p_user, p_date, 3, 'revision');

  -- The award. Called here rather than left to the trigger because a COMPLETED attempt does not
  -- fire it, and because this path has no `activity_submit()` above it to do the job. Keyed, so
  -- the trigger firing first for a partial makes this an idempotent no-op — which is why the
  -- caller reads the figure back from the ledger and never from this return value.
  perform public.award_points(
    p_user, p_date, 3, 'revision', 'ACTIVITY_ATTEMPT', att.id, att.attempt_number);

  -- Emptied, which **is** the beginning of the next પુનરાવર્તન (§3, §11). The history keeps the
  -- row just written, the ledger keeps what it paid, and only the boxes clear. `started_at` and
  -- `updated_at` both move so the next session's clock starts now rather than inheriting this
  -- one's, and the token is dropped because the next પુનરાવર્તન is a different intention.
  update public.level3_drafts
     set scene_ids    = '{}'::text[],
         engaged_ms   = 0,
         started_at   = now(),
         updated_at   = now(),
         client_token = null
   where user_id = p_user;

  return att.id;
end;
$$;

revoke all on function public.level3_commit(uuid, date, uuid) from public;

comment on function public.level3_commit(uuid, date, uuid) is
  'Turns the draft into an activity_attempts row, pays it through award_points(), recounts the '
  'day and empties the draft (0035). Emptying is what starting the next પુનરાવર્તન means — no '
  'history and no ledger row is ever touched. Idempotent on the client token, on an empty draft, '
  'and finally on the award key.';

-- નોંધાવો. Finish this પુનરાવર્તન and tell him what it was worth.
create or replace function public.level3_finalize(p_client_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  today date := timezone('Asia/Kolkata', now())::date;
  aid   bigint;
  snap  jsonb;
begin
  if actor is null then
    raise exception 'level3_not_signed_in' using errcode = '42501';
  end if;

  if not public.is_active_user() then
    raise exception 'level3_not_active' using errcode = '42501';
  end if;

  perform public.level3_draft_get();

  aid  := public.level3_commit(actor, today, p_client_token);
  snap := public.level3_snapshot(actor);

  -- What this પુનરાવર્તન earned, **read back from the ledger** and never taken from
  -- `award_points()`'s return value. Under the keyed award a second call writes nothing and
  -- returns 0, and the trigger may legitimately have got there first — so the only honest source
  -- for "what did this attempt pay" is the rows filed against it.
  return snap || jsonb_build_object(
    'saved',    (aid is not null),
    'attemptId', aid,
    'awarded',  coalesce((
      select sum(t.points) from public.point_transactions t
      where t.user_id = actor and t.source = 'ACTIVITY_ATTEMPT' and t.source_id = aid
    ), 0)
  );
end;
$$;

revoke all on function public.level3_finalize(uuid) from public;
grant execute on function public.level3_finalize(uuid) to authenticated;

comment on function public.level3_finalize(uuid) is
  'નોંધાવો — finishes the current લેવલ ૩ પુનરાવર્તન and returns the snapshot plus what it earned '
  '(0035). The figure is read back from point_transactions, never from award_points()''s return, '
  'because a keyed award that has already been written returns 0.';

-- ફરી શરૂ કરો. Finish what is on screen, then start again from empty.
--
-- **A reset is a save, never a delete** (§3, §11). The requirement is emphatic and it is the
-- single most important sentence in this file: unchecking the boxes means "start another
-- પુનરાવર્તન", not "throw away the last one". So the ticks standing at the moment he presses it
-- are finished into their own event and paid, and only then does the board clear. There is no
-- code path here that removes an attempt, removes a ledger row, or lowers a total.
create or replace function public.level3_reset(p_client_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.level3_finalize(p_client_token);
end;
$$;

revoke all on function public.level3_reset(uuid) from public;
grant execute on function public.level3_reset(uuid) to authenticated;

comment on function public.level3_reset(uuid) is
  'Starts a new લેવલ ૩ પુનરાવર્તન by finishing the current one first (0035). A reset saves and '
  'never deletes: no attempt, no ledger row and no total is touched, and the yuvak keeps every '
  'point the cleared ticks earned him.';

-- The yuvak's own લેવલ ૩ figures, for any screen that wants them without the draft.
create or replace function public.my_level3_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'level3_not_signed_in' using errcode = '42501';
  end if;

  return public.level3_snapshot(actor);
end;
$$;

revoke all on function public.my_level3_summary() from public;
grant execute on function public.my_level3_summary() to authenticated;

comment on function public.my_level3_summary() is
  'level3_snapshot() for the signed-in યુવક (0035). Derives him from auth.uid(); there is no '
  'parameter that could name another.';

-- ================================================================ the daily record, corrected
create or replace function public.daily_record_points(
  p_user  uuid,
  p_level integer,
  p_key   text,
  p_count integer,
  p_date  date
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rules jsonb;
  key   text    := coalesce(p_key, '');
  n     integer := greatest(coalesce(p_count, 0), 0);
  mode  text;
  earn  text;
  val   integer;
  cap   integer;
begin
  if p_user is null or p_level is null or p_date is null or n = 0 then
    return 0;
  end if;

  if not (select s.enabled from public.point_settings() s) then
    return 0;
  end if;

  if not public.point_rule_live(p_level, key, p_date) then
    return 0;
  end if;

  rules := public.point_rules();

  -- ── 0035: under a તિક rule the event path owns લેવલ ૩ outright ───────────
  --
  -- 0034 priced લેવલ ૩ here from the day's **distinct** દ્રશ્યો, which was right while a day
  -- was worth one પુનરાવર્તન. It is wrong the moment પુનરાવર્તન accumulate: ૫૦ then ૪૦ is ૯૦ in
  -- the ledger and ૫૦ distinct દ્રશ્યો in the form, so the reconciliation below would write a
  -- compensating **-૪૦** the first time a યુવક opened /daily — a screen with nothing to do with
  -- લેવલ ૩ silently undoing his afternoon.
  --
  -- Two owners for one number is the fault, not the arithmetic. Under a તિક rule the event path
  -- prices every submission as it happens, idempotently, keyed on the attempt; so this returns
  -- nothing and `daily_record_save()` excludes TICK and REVISION rows from the base it
  -- reconciles against. The day's stored total still counts them, so 0034's guarantee —
  -- sum(ledger for the day) == the record's total — holds exactly as it did.
  --
  -- `tick.mode = 'ACTIVITY'` is untouched: there the day really is worth one flat figure, the
  -- form really is entitled to restate it, and everything below runs as before.
  if p_level = 3 and (rules #>> '{tick,mode}') in ('TICK', 'REVISION') then
    return 0;
  end if;

  earn := coalesce(rules #>> array['earn', 'level' || p_level::text], 'DAY_FIRST');
  val  := coalesce(public.point_value_for(p_level, key), 0);

  if val <= 0 then
    return 0;
  end if;

  if earn = 'EVERY' then
    return val * n;
  end if;

  if earn = 'ONCE' then
    -- Already paid on an earlier day means this day is worth nothing. BONUS rows are excluded
    -- because a milestone is not the activity's own award, and DAILY_ADJUST rows are excluded
    -- because they belong to no level and would match every key.
    if exists (
      select 1
      from public.point_transactions t
      where t.user_id = p_user
        and t.level_id = p_level
        and t.activity_key = key
        and t.activity_date < p_date
        and coalesce(t.award_kind, 'DAY_FIRST') not in ('BONUS', 'DAILY_ADJUST')
    ) then
      return 0;
    end if;
  end if;

  -- DAY_FIRST and ONCE alike: the day pays once.
  return val;
end;
$$;

revoke all on function public.daily_record_points(uuid, integer, text, integer, date) from public;

comment on function public.daily_record_points(uuid, integer, text, integer, date) is
  'What one level''s reported count is worth on one day (0034, reissued 0035). 0035 hands લેવલ ૩ '
  'back to the event path whenever tick.mode is TICK or REVISION: it returns 0, and '
  'daily_record_save() excludes TICK and REVISION rows from the base it reconciles against, so '
  'accumulated પુનરાવર્તન cannot be clawed back by a form that prices them as a distinct set. '
  'tick.mode = ACTIVITY is unchanged.';
create or replace function public.daily_record_save(
  p_date         date  default null,
  p_counts       jsonb default '[]'::jsonb,
  p_client_token uuid  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  today    date := timezone('Asia/Kolkata', now())::date;
  day      date := coalesce(p_date, timezone('Asia/Kolkata', now())::date);
  payload  jsonb := '[]'::jsonb;
  rec      public.daily_activity_records%rowtype;
  created  boolean := false;
  new_ver  integer;
  e        record;
  ids      text[];
  by_scene boolean;
  cnt      integer;
  cap      integer;
  rec_cnt  integer;
  pts      integer;
  old_cnt  integer;
  old_pts  integer;
  target   integer := 0;
  ledger   integer;
  delta    integer;
  bonus    integer := 0;
  before_  integer;
  result   jsonb;
  -- 0035. `disp` is what a level's row *shows*; `pts` is what the form *prices*. They differ
  -- for લેવલ ૩ under a તિક rule, where the ledger is the only honest source of the figure and
  -- the form must not restate it. `l3_tick` is that same figure for the whole day.
  disp     integer;
  l3_tick  integer := 0;
begin
  -- ── 1. who is asking ──────────────────────────────────────────────────────
  if actor is null then
    raise exception 'daily_record_not_signed_in' using errcode = '42501';
  end if;

  if not public.is_active_user() then
    raise exception 'daily_record_not_active' using errcode = '42501';
  end if;

  -- A day he has not lived yet is not a day he can report. The other end is deliberately open:
  -- the window is a property of when he spoke, so a record may be opened for an old day, and
  -- bounding how far back he may reach is policy with no setting behind it yet.
  if day > today then
    raise exception 'Daily record: % is in the future - a day cannot be reported before it happens.', day
      using errcode = 'check_violation';
  end if;

  -- ── the retry, answered before anything is written ────────────────────────
  --
  -- The ordinary duplicate — a double tap, a refresh, a lost response the phone retried — is
  -- answered here with the record itself, which is what the caller wanted in the first place.
  -- The true race is decided by daily_activity_updates_token_idx at the end and is refused
  -- rather than paid twice, because a check cannot decide a race (0021:288-294).
  if p_client_token is not null
     and exists (select 1 from public.daily_activity_updates u
                 where u.user_id = actor and u.client_token = p_client_token
                   and u.level_id is null) then
    return public.daily_record_snapshot(actor, day);
  end if;

  -- ── the payload, checked before a row moves ───────────────────────────────
  --
  -- **A list of rows, never an object keyed by level.** `{"1": 0, "2": 3}` is the shape a screen
  -- reaches for first and it cannot carry this day: `daily_activity_counts` is keyed by
  -- (record, level, **activity**) because લેવલ ૪ is several કસોટીઓ under one ladder, and a map
  -- from a level number to a count has nowhere to say which of them ૨ belongs to. The other way
  -- out — deriving the activity key from the level number — would mean writing 'video',
  -- 'darshan' and 'revision' into this file, which is exactly the hardcoding 0021 owns and this
  -- one must not repeat. So it is refused loudly rather than read as an empty list, because a
  -- shape mismatch that silently zeroed a યુવક's day would be the worst failure available here.
  if p_counts is not null and jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Daily record: counts must be a list like [{"level": 2, "activity": "darshan", "count": 3}], not an object keyed by level - a level alone cannot say which કસોટી a લેવલ ૪ count belongs to.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) el
             where jsonb_typeof(el.value) <> 'object') then
    raise exception 'Daily record: each entry must be an object like {"level": 2, "activity": "darshan", "count": 3}.'
      using errcode = 'check_violation';
  end if;

  -- Normalised to one spelling before anything reads it. The client may write `level` or
  -- `level_id`, `activity` or `activity_key`, `count` or `reported`, `sceneIds` or `scene_ids` —
  -- liberality about names costs one pass here and saves a mapping layer on the far side, which
  -- would be a second place for the shape to be wrong. It is liberality about **names** only:
  -- the shape above is not negotiable.
  select coalesce(jsonb_agg(jsonb_build_object(
           'level',    coalesce(el.value -> 'level',    el.value -> 'level_id'),
           'activity', coalesce(el.value -> 'activity', el.value -> 'activity_key'),
           'count',    coalesce(el.value -> 'count',    el.value -> 'reported',
                                el.value -> 'reported_count'),
           'sceneIds', coalesce(el.value -> 'sceneIds', el.value -> 'scene_ids')
         )), '[]'::jsonb)
    into payload
  from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) el;

  -- `coalesce(jsonb_typeof(...), 'absent')`, never the bare comparison. `->` on a missing key is
  -- SQL NULL, `jsonb_typeof(NULL)` is NULL, and `NULL <> 'number'` is NULL rather than true — so
  -- the bare form silently passes an entry with no level at all, which then fails four hundred
  -- lines later as a not-null violation on a column the યુવક never heard of.
  if exists (select 1 from jsonb_array_elements(payload) el
             where coalesce(jsonb_typeof(el.value -> 'level'), 'absent') <> 'number') then
    raise exception 'Daily record: each entry needs a level.'
      using errcode = 'check_violation';
  end if;

  -- The bound is the ledger's own (point_transactions_level_id_check), not a new one invented
  -- here: a count that could never be paid is not a count worth storing.
  if exists (select 1 from jsonb_array_elements(payload) el
             where round((el.value ->> 'level')::numeric) not between 1 and 4) then
    raise exception 'Daily record: a level must be one the ledger can pay.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from jsonb_array_elements(payload) el
             where jsonb_typeof(el.value -> 'count') = 'number'
               and round((el.value ->> 'count')::numeric) < 0) then
    raise exception 'Daily record: a count cannot be negative.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload) el
    group by round((el.value ->> 'level')::numeric)::integer,
             coalesce(el.value ->> 'activity', '')
    having count(*) > 1
  ) then
    raise exception 'Daily record: the same level and activity appears more than once.'
      using errcode = 'check_violation';
  end if;

  perform set_config('varni.daily_record', 'save', true);

  -- ── 2. the record ─────────────────────────────────────────────────────────
  select * into rec
  from public.daily_activity_records
  where user_id = actor and activity_date = day
  for update;

  if rec.id is null then
    insert into public.daily_activity_records (user_id, activity_date)
    values (actor, day)
    returning * into rec;
    created := true;
    new_ver := rec.version;
  else
    -- The floor under this is daily_record_guard(), which refuses the UPDATE below whatever
    -- this branch decides. It is stated here as well so that the યુવક is told why rather than
    -- being shown a trigger's message about a row.
    if now() >= rec.edit_until then
      raise exception 'Daily record: the 24-hour window for % closed at % - it can no longer be edited.',
        rec.activity_date, rec.edit_until using errcode = 'check_violation';
    end if;
    new_ver := rec.version + 1;
  end if;

  before_ := coalesce(rec.total_points, 0);

  -- ── 3-5. every level named by the payload, and every level the record already had ────
  --
  -- The union is what makes a removal a change rather than a silence: a યુવક who deletes
  -- લેવલ ૨ from his day is saying it was 0, and a loop over the payload alone would leave
  -- yesterday's ૩ standing and paid.
  for e in
    with sent as (
      select round((el.value ->> 'level')::numeric)::integer as lvl,
             coalesce(el.value ->> 'activity', '')           as akey,
             case when jsonb_typeof(el.value -> 'count') = 'number'
                  then round((el.value ->> 'count')::numeric)::integer end as cnt,
             case when jsonb_typeof(el.value -> 'sceneIds') = 'array'
                  then el.value -> 'sceneIds' end as ids
      from jsonb_array_elements(payload) el
    ),
    held as (
      select c.level_id as lvl, c.activity_key as akey, null::integer as cnt, null::jsonb as ids
      from public.daily_activity_counts c
      where c.record_id = rec.id
        and not exists (select 1 from sent s where s.lvl = c.level_id and s.akey = c.activity_key)
    )
    select * from sent
    union all
    select * from held
    order by lvl, akey
  loop
    -- The દ્રશ્યો, deduplicated and with the withheld ones removed. The same tick sent twice
    -- is one tick, and a દ્રશ્ય the સંચાલક has taken out of the collection is not one that may
    -- be counted — admin_withheld_scene_ids() (0029) is the same authority award_points()'s
    -- TICK branch subtracts.
    if e.ids is null then
      ids := '{}'::text[];
      by_scene := false;
    else
      select coalesce(array_agg(distinct t.sid), '{}'::text[]) into ids
      from jsonb_array_elements_text(e.ids) as t(sid)
      where nullif(btrim(t.sid), '') is not null
        and not (t.sid = any (public.admin_withheld_scene_ids()));
      by_scene := true;
    end if;

    -- When the payload names દ્રશ્યો the ids ARE the count, because they are more specific
    -- than a number beside them: a client that sent ૧૦૮ and named ૪૦ has named ૪૦. When it
    -- names none, the number stands on its own — a યુવક may say he brought ૬૦ to mind without
    -- being asked to list them.
    if by_scene then
      cnt := cardinality(ids);
    else
      cnt := greatest(coalesce(e.cnt, 0), 0);
    end if;

    -- ── 4. the maximum, if the સંચાલક set one ───────────────────────────────
    cap := public.daily_max_for(e.lvl);
    if cap is not null and cnt > cap then
      cnt := cap;
      -- The દ્રશ્યો are trimmed with the count, so the evidence never says more than the
      -- number it backs. Ordered, so the trim is a fact rather than whatever the array
      -- happened to hold first.
      if by_scene then
        select coalesce(array_agg(q.sid order by q.sid), '{}'::text[]) into ids
        from (select u.sid from unnest(ids) as u(sid) order by u.sid limit cap) q;
      end if;
    end if;

    rec_cnt := public.daily_record_recorded(actor, day, e.lvl, e.akey, by_scene);
    pts     := public.daily_record_points(actor, e.lvl, e.akey, cnt, day);
    disp    := pts;

    -- 0035. `daily_record_points()` returns 0 for લેવલ ૩ under a તિક rule because the event
    -- path owns it (see that function). Storing that 0 in the row would put a nought on the
    -- સંચાલક's screen beside a day the ledger paid ૯૦ for, so the row shows what was actually
    -- paid. Read, never reconciled: `target` below still takes `pts`.
    if e.lvl = 3 and pts = 0 then
      select coalesce(sum(t.points), 0)::integer into disp
      from public.point_transactions t
      where t.user_id = actor
        and t.activity_date = day
        and t.level_id = 3
        and t.award_kind in ('TICK', 'REVISION');
    end if;

    select c.reported_count, c.points into old_cnt, old_pts
    from public.daily_activity_counts c
    where c.record_id = rec.id and c.level_id = e.lvl and c.activity_key = e.akey;

    insert into public.daily_activity_counts
      (record_id, level_id, activity_key, reported_count, recorded_count, verified, points, scene_ids)
    values
      (rec.id, e.lvl, e.akey, cnt, rec_cnt, cnt <= rec_cnt, disp, ids)
    on conflict (record_id, level_id, activity_key) do update
      set reported_count = excluded.reported_count,
          recorded_count = excluded.recorded_count,
          verified       = excluded.verified,
          points         = excluded.points,
          scene_ids      = excluded.scene_ids;

    target := target + pts;

    -- ── 8a. the audit, one row per level that actually moved ────────────────
    if old_cnt is distinct from cnt or old_pts is distinct from disp then
      insert into public.daily_activity_updates
        (record_id, user_id, actor_id, version, action, level_id, activity_key,
         old_count, new_count, old_points, new_points)
      values
        (rec.id, actor, actor, new_ver,
         case when created then 'CREATED' else 'UPDATED' end,
         e.lvl, e.akey, old_cnt, cnt, old_pts, disp);
    end if;
  end loop;

  -- ── 6. the ledger, reconciled ─────────────────────────────────────────────
  --
  -- The day's non-BONUS sum is what the base award currently stands at, whatever wrote it —
  -- an auto-award from `activity_submit()`, a legacy row from before 0031, a manual correction
  -- by the સંચાલક, or an earlier version of this very record. `target` is what the record now
  -- says the day is worth. The difference is one row.
  --
  -- **Never an UPDATE and never a DELETE.** 0031:669-674: a correction that was itself a
  -- mistake is corrected by a third row, and all three stay. The delta may be negative, which
  -- is why `point_transactions_points_check` was widened above.
  -- 0035 adds TICK and REVISION to the exclusion, and the reason is ownership rather than
  -- arithmetic. Those rows are લેવલ ૩'s per-પુનરાવર્તન awards, written by the event path,
  -- idempotent on the attempt id, and already correct. Comparing a form that does not price
  -- them against a base that contains them is what would produce a negative DAILY_ADJUST large
  -- enough to erase an afternoon's સાધના. BONUS is excluded for 0034's original reason.
  select coalesce(sum(t.points), 0)::integer into ledger
  from public.point_transactions t
  where t.user_id = actor
    and t.activity_date = day
    and coalesce(t.award_kind, 'DAY_FIRST') not in ('BONUS', 'TICK', 'REVISION');

  -- What the event path paid લેવલ ૩ today. Not reconciled — only added back into the stored
  -- total below, so that the record still states the whole day and 0034's guarantee survives.
  select coalesce(sum(t.points), 0)::integer into l3_tick
  from public.point_transactions t
  where t.user_id = actor
    and t.activity_date = day
    and t.award_kind in ('TICK', 'REVISION');

  delta := target - ledger;

  if delta <> 0 then
    -- level 0 and an empty activity_key: the difference is a fact about the day and not about
    -- any one ladder, which is the same "belongs to no level" 0031 gave a manual adjustment.
    -- The key is the record and its version — never an attempt id, because every existing
    -- repeatable key is one (0033:1057, :1086, :1142) and reusing one would be refused as a
    -- duplicate while minting a fake attempt would create a second scoring system.
    perform public.point_award(
      actor, day, 0, '', delta, 'DAILY_ADJUST',
      'DAILY_RECORD', 0, 0,
      'daily:' || rec.id::text || ':' || new_ver::text,
      'Daily record ' || day::text || ' v' || new_ver::text
    );
  end if;

  -- ── 7. the milestones, through 0033's engine ──────────────────────────────
  --
  -- `point_bonus_apply()` and not a second bonus path. The two gates it normally sits behind
  -- are `award_points()`'s and have to be restated here, in the same order, because this is a
  -- second caller and not a second engine: a project with points switched off must not start
  -- paying milestones because a form was filled in.
  if (select s.enabled from public.point_settings() s) then
    for e in
      select c.level_id as lvl, c.activity_key as akey
      from public.daily_activity_counts c
      where c.record_id = rec.id and c.reported_count > 0
      order by c.level_id, c.activity_key
    loop
      if public.point_rule_live(e.lvl, e.akey, day) then
        perform public.point_bonus_apply(actor, day, e.lvl, e.akey, 'DAILY_RECORD', 0, 0);
      end if;
    end loop;
  end if;

  select coalesce(sum(t.points), 0)::integer into bonus
  from public.point_transactions t
  where t.user_id = actor and t.activity_date = day and t.award_kind = 'BONUS';

  -- ── 9. the totals and the version ─────────────────────────────────────────
  -- `+ l3_tick`, so that after the delta above the identity 0034 promises still holds:
  -- the day's non-bonus ledger sum is `target` (reconciled) plus `l3_tick` (excluded from the
  -- reconciliation and therefore untouched by it), and the record states exactly that.
  update public.daily_activity_records
     set total_base_points  = target + l3_tick,
         total_bonus_points = bonus,
         total_points       = target + l3_tick + bonus,
         version            = new_ver,
         status             = 'OPEN'
   where id = rec.id;

  -- ── 8b. the head row ──────────────────────────────────────────────────────
  insert into public.daily_activity_updates
    (record_id, user_id, actor_id, version, action, level_id, activity_key,
     old_count, new_count, old_points, new_points, client_token)
  values
    (rec.id, actor, actor, new_ver,
     case when created then 'CREATED' else 'UPDATED' end,
     null, '', null, null, before_, target + l3_tick + bonus, p_client_token);

  perform set_config('varni.daily_record', '', true);

  result := public.daily_record_snapshot(actor, day);

  return result;
end;
$$;

revoke all on function public.daily_record_save(date, jsonb, uuid) from public;
grant execute on function public.daily_record_save(date, jsonb, uuid) to authenticated;

comment on function public.daily_record_save(date, jsonb, uuid) is
  'The one write path for a daily record (0034, reissued 0035). Unchanged except that the '
  'reconciliation now excludes the event path''s own લેવલ ૩ awards (TICK, REVISION) from the '
  'base it compares against, and adds them back into the record''s stored total — so 0034''s '
  'guarantee that the day''s ledger sum equals the record''s total still holds, while an '
  'accumulating લેવલ ૩ can no longer be undone by opening /daily.';

-- ================================================================ the સંચાલક's લેવલ ૩

-- One row per યુવક: everything §19 asks the progress report to show about લેવલ ૩.
--
-- A companion to `admin_progress_report()` rather than a widening of it, and for the reason
-- 0032 gives for its own seven readers: that function already takes nineteen parameters and
-- returns thirty columns, and every screen that calls it would have to be re-verified. This is
-- joined onto it by uid in the browser, exactly as `admin_activity_counts()` already is
-- (progressService.js:349-357).
--
-- **`ticks` is the sum and not the union.** `admin_activity_counts.ticks` answers "how much of
-- the collection has he brought to mind" and is deliberately a distinct set (0032:684-694); this
-- answers "how much સાધના has he done", which is a different question and is additive. Both are
-- true and the report needs both, so neither is changed into the other.
create or replace function public.admin_level3_report(
  p_users uuid[]  default null,
  p_from  date    default null,
  p_to    date    default null,
  p_day   date    default null
)
returns table (
  user_id          uuid,
  revisions        bigint,
  ticks            bigint,
  scenes_distinct  bigint,
  points           bigint,
  days             bigint,
  last_at          timestamptz,
  today_revisions  bigint,
  today_ticks      bigint,
  today_points     bigint,
  engaged_ms       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with day as (
    select coalesce(p_day, timezone('Asia/Kolkata', now())::date) as d
  ),
  att as (
    select a.*
    from public.activity_attempts a
    where a.level_id = 3
      and a.activity_key = 'revision'
      and (p_users is null or a.user_id = any (p_users))
      and (p_from is null or a.activity_date >= p_from)
      and (p_to   is null or a.activity_date <= p_to)
  ),
  tx as (
    select t.user_id, t.activity_date, t.points
    from public.point_transactions t
    where t.level_id = 3
      and (p_users is null or t.user_id = any (p_users))
      and (p_from is null or t.activity_date >= p_from)
      and (p_to   is null or t.activity_date <= p_to)
  )
  select
    u.user_id,
    coalesce(a.revisions, 0),
    coalesce(a.ticks, 0),
    coalesce(a.scenes_distinct, 0),
    coalesce(x.points, 0),
    coalesce(a.days, 0),
    a.last_at,
    coalesce(a.today_revisions, 0),
    coalesce(a.today_ticks, 0),
    coalesce(x.today_points, 0),
    coalesce(a.engaged_ms, 0)
  from (
    select user_id from att
    union
    select user_id from tx
  ) u
  left join (
    select
      att.user_id,
      count(*)                                                          as revisions,
      sum(coalesce(cardinality(att.selected_scene_ids), 0))             as ticks,
      count(distinct s.scene_id)                                        as scenes_distinct,
      count(distinct att.activity_date)                                 as days,
      max(att.submitted_at)                                             as last_at,
      count(*) filter (where att.activity_date = (select d from day))   as today_revisions,
      coalesce(sum(coalesce(cardinality(att.selected_scene_ids), 0))
               filter (where att.activity_date = (select d from day)), 0) as today_ticks,
      coalesce(sum(att.engaged_ms), 0)                                  as engaged_ms
    from att
    left join lateral unnest(att.selected_scene_ids) as s(scene_id)
      on not (s.scene_id = any (public.admin_withheld_scene_ids()))
    group by att.user_id
  ) a on a.user_id = u.user_id
  left join (
    select
      tx.user_id,
      sum(tx.points)                                                    as points,
      coalesce(sum(tx.points) filter (where tx.activity_date = (select d from day)), 0) as today_points
    from tx
    group by tx.user_id
  ) x on x.user_id = u.user_id;
$$;

revoke all on function public.admin_level3_report(uuid[], date, date, date) from public;
grant execute on function public.admin_level3_report(uuid[], date, date, date) to authenticated;

comment on function public.admin_level3_report(uuid[], date, date, date) is
  'Per-યુવક લેવલ ૩ figures for the progress report (0035): પુનરાવર્તન count, total ticks (the '
  'SUM across revisions, not the union), distinct દ્રશ્યો, points from the ledger, days, last '
  'activity, and the same three for one chosen day. Joined onto admin_progress_report() by uid '
  'in the browser, the way admin_activity_counts() already is.';

-- Every પુનરાવર્તન one યુવક has finished, newest first — §20's screen.
create or replace function public.admin_user_level3_detail(
  p_user  uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if not public.has_permission('progress.read') then
    raise exception 'level3_detail_forbidden' using errcode = '42501';
  end if;

  if p_user is null then
    raise exception 'level3_detail_no_user' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'userId', p_user,

    'totals', (
      select jsonb_build_object(
        'revisions', coalesce(count(*), 0),
        'ticks',     coalesce(sum(coalesce(cardinality(a.selected_scene_ids), 0)), 0),
        'days',      coalesce(count(distinct a.activity_date), 0),
        'lastAt',    max(a.submitted_at),
        'points',    coalesce((
          select sum(t.points) from public.point_transactions t
          where t.user_id = p_user and t.level_id = 3
        ), 0)
      )
      from public.activity_attempts a
      where a.user_id = p_user and a.level_id = 3 and a.activity_key = 'revision'
    ),

    -- One entry per પુનરાવર્તન, with what it was paid beside what it recorded. §20 asks for the
    -- સંચાલક to be able to see exactly how the total was produced, so the points are the rows
    -- filed against that attempt and not a share of the day divided out.
    'revisions', coalesce((
      select jsonb_agg(r order by (r ->> 'at') desc)
      from (
        select jsonb_build_object(
          'date',      a.activity_date,
          'n',         a.attempt_number,
          'at',        a.submitted_at,
          'ticks',     coalesce(cardinality(a.selected_scene_ids), 0),
          'total',     a.total_items,
          'status',    a.status,
          'engagedMs', a.engaged_ms,
          'points',    coalesce((
            select sum(t.points) from public.point_transactions t
            where t.user_id = p_user and t.source = 'ACTIVITY_ATTEMPT' and t.source_id = a.id
          ), 0)
        ) as r
        from public.activity_attempts a
        where a.user_id = p_user and a.level_id = 3 and a.activity_key = 'revision'
        order by a.submitted_at desc
        limit lim
      ) x
    ), '[]'::jsonb),

    -- The day-by-day roll-up §14 asks for: ૧૪ ઓગસ્ટ = ૫૦ + ૪૦ = ૯૦.
    'days', coalesce((
      select jsonb_agg(r order by (r ->> 'date') desc)
      from (
        select jsonb_build_object(
          'date',      a.activity_date,
          'revisions', count(*),
          'ticks',     sum(coalesce(cardinality(a.selected_scene_ids), 0)),
          'points',    coalesce((
            select sum(t.points) from public.point_transactions t
            where t.user_id = p_user and t.level_id = 3 and t.activity_date = a.activity_date
          ), 0)
        ) as r
        from public.activity_attempts a
        where a.user_id = p_user and a.level_id = 3 and a.activity_key = 'revision'
        group by a.activity_date
        order by a.activity_date desc
        limit 400
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_user_level3_detail(uuid, integer) from public;
grant execute on function public.admin_user_level3_detail(uuid, integer) to authenticated;

comment on function public.admin_user_level3_detail(uuid, integer) is
  'One યુવક''s complete લેવલ ૩ history (0035): every પુનરાવર્તન with its ticks, its points and '
  'the attention behind it, plus a day-by-day roll-up. Guarded by progress.read with a perform, '
  'never by a CTE — 0032''s rule.';

-- ================================================================ RLS and privileges

alter table public.scene_catalog   enable row level security;
alter table public.level3_drafts   enable row level security;

-- The catalogue is a list of ids and a fact about nobody, so any signed-in યુવક may read it —
-- the same choice 0033 made for `point_bonus_rules` and 0034 for `point_config_versions`. It is
-- written only by `scene_catalog_sync()`, which is SECURITY DEFINER and checks `darshan.update`,
-- so there is no write policy at all and RLS refuses every command it has no policy for.
drop policy if exists "scene catalog readable" on public.scene_catalog;

create policy "scene catalog readable" on public.scene_catalog
  for select using (auth.uid() is not null);

-- The draft is his and nobody else's, plus `progress.read` for the સંચાલક — `progress`'s own
-- idiom since 0004:602-610. **Read only.** Every write goes through the three SECURITY DEFINER
-- functions above, which is what makes the clock unforgeable: an own-row UPDATE policy would
-- hand the યુવક `engaged_ms`, and `engaged_ms` is the pace rule.
drop policy if exists "own level3 draft readable" on public.level3_drafts;

create policy "own level3 draft readable" on public.level3_drafts
  for select using (user_id = auth.uid() or public.has_permission('progress.read'));

-- Belt and braces behind the missing policies, and 0021's reasoning for it: Supabase's default
-- privileges grant every new table in `public` to anon and authenticated, so RLS is otherwise
-- the only thing standing there. Revoking as well means a mistake in a future migration — an
-- added policy, a disabled RLS — still does not open the path.
revoke insert, update, delete on public.scene_catalog from anon, authenticated;
revoke insert, update, delete on public.level3_drafts from anon, authenticated;

-- ================================================================ notes for the next reader
--
-- **Turning this on.** Nothing above changes what any project pays until two things are done,
-- and both are the સંચાલક's:
--
--   1. `settings['levels'].value.points.tick.mode = 'TICK'` with `perTick` above 0, and
--      `earn.tickCount = 'ALL'` — the panel already has both controls (Level3Card,
--      EarningModeCard). That is the ૫૦ + ૪૦ = ૯૦ rule, and it was already implemented and
--      already tested before this file existed.
--   2. `settings['levels'].value.points.pace.secondsPerTick` above 0, for the pace rule.
--
-- Until then `tick.mode` is ACTIVITY, `secondsPerTick` is 0, the catalogue is empty, and every
-- branch added here is skipped. That is deliberate: a migration that started charging or
-- refusing on the day it was applied would be deciding policy that belongs to a person.
--
-- **What was left alone, and should stay that way.** `activity_submit()`, `level4_submit()`,
-- `settings_check_points()`, `point_rules()`, the unlock machine (`level4_gate_open()`,
-- `deriveStatuses`, `level4_activity_states`), `progress.level3_score` and its absent guard
-- (0026:63-72 explains why it has none), and every row already in `point_transactions`.
-- `progress.level3_score` is still written by the handset and is still what the લેવલ ૪ gate
-- reads; this file does not move that, because who may reach લેવલ ૪ is an access question and
-- 0031/0033 both keep scoring changes out of it.
