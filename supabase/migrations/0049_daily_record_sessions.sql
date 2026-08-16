-- વર્ણી ધ્યાન — a લેવલ ૩ day is several sittings, and the form may now say so.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- આજની પ્રગતિ asks one question per ladder: "how many today". For લેવલ ૧ and લેવલ ૨ that is
-- the whole truth — a દર્શન is one act, and three of them is the number three.
--
-- લેવલ ૩ is not shaped like that. A યુવક sits with the વર્ણન યાદી in the morning, again after
-- work, and again at night, and what he actually knows at each of those moments is *how many
-- this time* — not the running total for the day. A single box forces him to do the arithmetic
-- himself before he can correct anything: to add tonight's ૩૦ he must first remember what this
-- morning's ૨૭ and this evening's ૧૫ came to, and if he gets it wrong the day is wrong with no
-- way to see where. `daily_activity_counts` stored one figure per (record, level, activity), so
-- the sittings were not merely unshown — they were not kept.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX, AND WHAT IT DELIBERATELY DOES NOT TOUCH
-- ════════════════════════════════════════════════════════════════════════════
--
-- One array column beside the figure, on the table that already holds one:
--
--     reported_count    integer     ← what the day is worth. Unchanged, and still authoritative.
--     reported_sessions integer[]   ← the sittings it is made of, or empty.
--
-- **`reported_count` stays the only number anything reads.** The points, the ledger
-- reconciliation, the compensating DAILY_ADJUST row, `point_bonus_count()`'s milestone
-- substitution, every `admin_*` report and every Excel export go on reading that column and are
-- not reissued here — a day reported as ૨૭ + ૧૫ is worth exactly what a day reported as ૪૨ is
-- worth, because it IS ૪૨. That is the property that makes this change small: there is no
-- second scoring computation and this does not add one (§3 of docs/DAILY_RECORD_ARCHITECTURE.md).
--
-- The precedent is `scene_ids`, added by 0034 to the same table for the same kind of reason: it
-- records the SHAPE a report was made in without becoming a second answer to what the report
-- said. Sessions follow its rules exactly — the list decides the count when one is sent, the
-- list is trimmed with the count when the સંચાલક's maximum clamps it, and a payload carrying
-- neither is treated as it always was.
--
-- Two functions are reissued and no others: `daily_record_snapshot()`, so a screen can read the
-- sittings back, and `daily_record_save()`, so it can write them. Both are 0034's own bodies
-- with the additions patched in, so nothing else in four hundred lines could drift while being
-- copied.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Backward compatibility, in both directions
-- ════════════════════════════════════════════════════════════════════════════
--
--   * An OLD CLIENT against this schema sends no `sessions` key, writes the empty array, and
--     behaves byte for byte as it did under 0034.
--   * A NEW CLIENT against an OLD schema sends a `sessions` key that 0034's normaliser drops on
--     the floor, and its `count` — which the client sends beside it — stands. The day is still
--     right; only the breakdown is lost. That is why the client sends both.
--   * A day saved WITH sittings and then re-saved WITHOUT them keeps the figure and clears the
--     breakdown, which is the honest reading: a report of one number is a report of one number.

alter table public.daily_activity_counts
  add column if not exists reported_sessions integer[] not null default '{}';

comment on column public.daily_activity_counts.reported_sessions is
  'The sittings behind reported_count, in the order the યુવક entered them, or empty when the '
  'day was reported as a single figure (0049). Never authoritative on its own: reported_count '
  'is what every reader in this schema sums, and daily_record_save() pins it to this array''s '
  'total whenever the array is sent. Kept for the same reason scene_ids is - it records the '
  'shape of the report, not a second answer to it.';

-- Every element non-negative, and the sum is not constrained here on purpose: the ceiling is
-- `dailyMax`, which is a setting rather than a schema fact, and daily_record_save() clamps
-- against it. A CHECK naming a number would be the hardcoded maximum §7 forbids.
alter table public.daily_activity_counts
  drop constraint if exists daily_activity_counts_sessions_check;

alter table public.daily_activity_counts
  add constraint daily_activity_counts_sessions_check
  check (reported_sessions is not null and 0 <= all (reported_sessions));

-- ================================================================ reading them back


create or replace function public.daily_record_snapshot(p_user uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r      public.daily_activity_records%rowtype;
  found_ boolean;
begin
  select * into r
  from public.daily_activity_records
  where user_id = p_user and activity_date = p_date;

  found_ := (r.id is not null);

  return jsonb_build_object(
    'date',   p_date,
    'exists', found_,

    'recordId', r.id,
    'version',  coalesce(r.version, 0),

    'status',       case when not found_ then 'NONE'
                         when now() >= r.edit_until then 'LOCKED'
                         else 'OPEN' end,
    'storedStatus', r.status,
    -- An explicit boolean beside the string, because a screen that had to interpret a vocabulary
    -- is a screen that will one day meet a token nobody told it about. **A day with no record is
    -- editable**: the twenty-four hours start at the first save, not at the start of the day, so
    -- there is nothing running yet and nothing to be late for. A day that has not happened is
    -- the one exception, and daily_record_save() refuses it for the same reason.
    'editable',
    case when p_date > timezone('Asia/Kolkata', now())::date then false
         when not found_ then true
         else now() < r.edit_until end,

    'firstSubmittedAt', r.first_submitted_at,
    'lastUpdatedAt',    r.last_updated_at,
    'editUntil',        r.edit_until,
    'lockedAt',         r.locked_at,

    -- **The figure the countdown trusts**, and the reason it is sent rather than left to be
    -- derived from `editUntil`: a handset whose clock is four minutes fast would lock the form
    -- four minutes early, and one four minutes slow would let a યુવક type into a day the server
    -- is about to refuse. A duration is the same number on every clock; an instant is not.
    -- Always a number, never null and never negative — 0 is what a closed record has.
    'remainingSeconds',
    case when not found_ or now() >= r.edit_until then 0
         else floor(extract(epoch from (r.edit_until - now())))::integer end,

    'totals', jsonb_build_object(
      'base',   coalesce(r.total_base_points, 0),
      'bonus',  coalesce(r.total_bonus_points, 0),
      'points', coalesce(r.total_points, 0)
    ),

    -- The same three figures and the two window fields, flat and in snake_case. Not redundancy
    -- for its own sake: the client reads across both conventions and pinning both here means one
    -- document that cannot be read two ways, rather than a mapping layer on the far side that
    -- would be a second place for the shape to be wrong.
    'base_points',       coalesce(r.total_base_points, 0),
    'bonus_points',      coalesce(r.total_bonus_points, 0),
    'total_points',      coalesce(r.total_points, 0),
    'edit_until',        r.edit_until,
    'locked_at',         r.locked_at,
    'remaining_seconds',
    case when not found_ or now() >= r.edit_until then 0
         else floor(extract(epoch from (r.edit_until - now())))::integer end,

    -- The reconciliation, returned rather than assumed. A screen never has to trust that the
    -- ledger agrees with the record — it can see that it does, and so can the suite.
    'ledgerPoints',
    coalesce((select sum(t.points)::integer
              from public.point_transactions t
              where t.user_id = p_user and t.activity_date = p_date), 0),

    'counts',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'level',    c.level_id,
               'activity', c.activity_key,
               'reported', c.reported_count,
               'recorded', c.recorded_count,
               'verified', c.verified,
               'points',   c.points,
               'sceneIds', to_jsonb(c.scene_ids),
               -- The breakdown behind `reported`, or an empty array when the report was a
               -- single figure (0049). Returned beside the number rather than instead of it:
               -- every reader in this schema goes on summing `reported_count`, and a client
               -- that has never heard of sessions renders exactly what it rendered before.
               'sessions', to_jsonb(c.reported_sessions),
               'reported_sessions', to_jsonb(c.reported_sessions),
               -- **NULL when the સંચાલક set no maximum for this ladder**, never 0. A 0 would
               -- read as "the maximum is zero" and lock the field at nothing; an absent maximum
               -- is an unbounded one, and the screen renders the difference.
               'max',      public.daily_max_for(c.level_id),
               'reported_count', c.reported_count,
               'recorded_count', c.recorded_count
             ) order by c.level_id, c.activity_key)
      from public.daily_activity_counts c
      where c.record_id = r.id
    ), '[]'::jsonb),

    -- Every maximum the સંચાલક has set, so a screen opening a day that has no record yet — and
    -- therefore no per-level rows to read a maximum from — can still bound its controls from the
    -- same authority that clamps the save. A disabled control is not a rule (0018); this is the
    -- rule, and the control is drawn from it.
    'maximums', public.point_rules() -> 'dailyMax'
  );
end;
$$;

revoke all on function public.daily_record_snapshot(uuid, date) from public;

comment on function public.daily_record_snapshot(uuid, date) is
  'One daily record as a jsonb document - the window, the totals, the per-level counts and the '
  'ledger sum for the same day (0034, reissued 0049 to return reported_sessions beside every '
  'count). Shared by daily_record_save() and daily_record_get() so that a save and a fetch '
  'return the same shape. Takes a p_user and is therefore granted to nobody; both callers '
  'derive the યુવક from auth.uid().';

-- ================================================================ writing them


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
  sess     integer[];
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
           'sceneIds', coalesce(el.value -> 'sceneIds', el.value -> 'scene_ids'),
           'sessions', coalesce(el.value -> 'sessions', el.value -> 'reported_sessions')
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

  -- The sessions, checked with the same loudness as the count above and for the same reason:
  -- a breakdown that arrived in a shape this function did not expect must not be read as an
  -- absent one, because an absent one means "keep the single figure" and silently discarding a
  -- યુવક's sittings is the failure this column exists to prevent.
  if exists (select 1 from jsonb_array_elements(payload) el
             where jsonb_typeof(el.value -> 'sessions') not in ('array', 'null')) then
    raise exception 'Daily record: sessions must be a list of counts like {"sessions": [27, 15]}.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1
             from jsonb_array_elements(payload) el,
                  lateral jsonb_array_elements(
                    case when jsonb_typeof(el.value -> 'sessions') = 'array'
                         then el.value -> 'sessions' else '[]'::jsonb end) s
             where jsonb_typeof(s.value) <> 'number'
                or round((s.value #>> '{}')::numeric) < 0) then
    raise exception 'Daily record: every session must be a count of zero or more.'
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
                  then el.value -> 'sceneIds' end as ids,
             case when jsonb_typeof(el.value -> 'sessions') = 'array'
                  then el.value -> 'sessions' end as sessions
      from jsonb_array_elements(payload) el
    ),
    held as (
      select c.level_id as lvl, c.activity_key as akey, null::integer as cnt, null::jsonb as ids,
             null::jsonb as sessions
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

    -- ── the sittings, and what they are allowed to decide ───────────────────
    --
    -- 0049. A લેવલ ૩ day is not one act: a યુવક sits with the વર્ણન યાદી in the morning, again
    -- after work, and again at night, and a single box asking "how many today" cannot be
    -- corrected an hour later without him first working out what he had already counted. So the
    -- report may arrive as a list of sittings.
    --
    -- **The list decides the count**, exactly as `sceneIds` does five lines above and for the
    -- identical reason: it is more specific than a number beside it, so a client that sent ૪૨
    -- and named ૨૭ + ૧૫ has named ૪૨ whatever the ૪૨ said. That keeps ONE figure authoritative
    -- per (day, level, activity) — `reported_count` — which is what lets every other function
    -- in this schema stay exactly as 0034 and 0035 wrote it: the points, the ledger
    -- reconciliation, the milestone counts and the whole સંચાલક panel read that column and
    -- never this one.
    --
    -- `sceneIds` wins over sessions where a payload carries both, because દ્રશ્યો are evidence
    -- of WHICH વર્ણન and sessions are only a shape of WHEN. Nothing sends both today.
    if by_scene or e.sessions is null then
      sess := null;
    else
      select coalesce(array_agg(greatest(round((s.value #>> '{}')::numeric)::integer, 0)
                                order by s.ord), '{}'::integer[])
        into sess
      from jsonb_array_elements(e.sessions) with ordinality as s(value, ord);

      cnt := coalesce((select sum(v) from unnest(sess) as u(v)), 0)::integer;
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

    -- The sittings are trimmed with the count for the same reason the દ્રશ્યો are: a breakdown
    -- that adds to more than the figure above it is a screen contradicting itself. Trimmed from
    -- the END, and the sitting that straddles the ceiling is reduced rather than dropped — the
    -- earliest sittings are the ones he is surest of, and losing a whole one would move a number
    -- he did not touch.
    if sess is not null
       and coalesce((select sum(v) from unnest(sess) as u(v)), 0) > cnt then
      declare
        acc  integer := 0;
        kept integer[] := '{}'::integer[];
        take integer;
        v    integer;
      begin
        foreach v in array sess loop
          exit when acc >= cnt;
          take := least(v, cnt - acc);
          kept := kept || take;
          acc  := acc + take;
        end loop;
        sess := kept;
      end;
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
      (record_id, level_id, activity_key, reported_count, recorded_count, verified, points,
       scene_ids, reported_sessions)
    values
      (rec.id, e.lvl, e.akey, cnt, rec_cnt, cnt <= rec_cnt, disp, ids,
       coalesce(sess, '{}'::integer[]))
    on conflict (record_id, level_id, activity_key) do update
      set reported_count    = excluded.reported_count,
          recorded_count    = excluded.recorded_count,
          verified          = excluded.verified,
          points            = excluded.points,
          scene_ids         = excluded.scene_ids,
          -- Overwritten with the empty array when a save carries no sessions, and that is the
          -- honest reading rather than a loss: a client that reported one figure has reported
          -- one figure, and a stale breakdown left standing beside it would add to a number
          -- nobody sent.
          reported_sessions = excluded.reported_sessions;

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
  'The one write path for a daily record (0034, reissued 0049): validates the window, clamps to '
  'the સંચાલક''s maximum, computes the points, reconciles the ledger with one compensating row '
  'and applies the milestones. Each entry may now carry a sessions array - the sittings behind '
  'the day''s figure - and when it does the sittings decide reported_count, exactly as sceneIds '
  'already did. No p_user, because a p_user is a value a browser chooses.';

-- ================================================================ who decides whether it asks

/*
  "આજે તમે શું કર્યું?" is now a decision the સંચાલક makes, and this is what makes the switch
  real rather than a control on a screen.

  **A disabled control is not a rule** — 0018 states it and every settings guard since has
  repeated it. `public.settings` is writable through PostgREST by anybody `settings.update`
  admits, with no obligation to go anywhere near admin/src, so a curl could otherwise put
  `{"dailyPrompt": {"enabled": false, "autoOpen": true}}` in this row and leave the panel
  showing a switch that means nothing.

  Mirrors `validateDailyPrompt()` in shared/domain/daily-prompt.js message for message and in
  the same order, so the wording a સંચાલક reads is the same whether the save was stopped by the
  panel or by the database.

  **`dailyPrompt` absent is legal and always will be.** The resolver's default is ON, so a
  project that never opens this card gets the prompt — which is the feature working rather than
  a configuration nobody made. The early return below is what keeps that true: this trigger has
  an opinion only about a `dailyPrompt` key that is actually being written.

  The sixth BEFORE trigger on `public.settings`, alongside settings_check_slideshow (0018),
  settings_check_mobile_nav (0019), settings_check_points (0021), settings_check_leaderboard
  (0023) and settings_check_pace (0035). Three of them now watch `key = 'levels'` and they stay
  independent because each early-returns on the sub-key it does not own — a save that rewrites
  `points` alone is never judged against this one's rules, and the reverse.
*/
create or replace function public.settings_check_daily_prompt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v jsonb;
begin
  if new.key <> 'levels' or not (new.value ? 'dailyPrompt') then
    return new;
  end if;

  v := new.value -> 'dailyPrompt';

  if jsonb_typeof(v) <> 'object' then
    raise exception 'The daily prompt setting is missing.' using errcode = 'check_violation';
  end if;

  -- Real booleans, not truthiness. The stored value is jsonb, so the STRING 'false' is a value
  -- JavaScript reads as true; a resolver that accepted it would report the prompt as on for a
  -- સંચાલક who had switched it off, and nothing on any screen would say so. Absent is refused
  -- as well, for the reason 0023 gives about its own switch: he is saving a daily-prompt
  -- configuration and has to have said which way it goes.
  if jsonb_typeof(v -> 'enabled') <> 'boolean' then
    raise exception 'Daily prompt: turn it on or off before saving.'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'autoOpen') <> 'boolean' then
    raise exception 'Daily prompt: choose whether it opens by itself.'
      using errcode = 'check_violation';
  end if;

  -- The asymmetry with the resolver, which reports this combination as fully off rather than
  -- throwing. A resolver reading a stored row has nobody to tell; a save is the one moment the
  -- contradiction can be explained to the person who can fix it, and accepting it would leave a
  -- switch on screen saying something the app does not do.
  if (v -> 'enabled') = 'false'::jsonb and (v -> 'autoOpen') = 'true'::jsonb then
    raise exception 'Daily prompt: it cannot open by itself while it is switched off.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_daily_prompt() from public;

drop trigger if exists settings_check_daily_prompt on public.settings;

-- BEFORE, so a refused write never reaches the row — and never reaches `audit_setting` either,
-- which would otherwise file an entry for a change that did not happen. Ordering against the
-- audit trigger does not arise: this one is BEFORE and that one is AFTER.
create trigger settings_check_daily_prompt
  before insert or update on public.settings
  for each row execute function public.settings_check_daily_prompt();

comment on function public.settings_check_daily_prompt() is
  'Refuses a settings[''levels''].value.dailyPrompt write that resolveDailyPrompt() would '
  'silently correct (0049). Mirrors validateDailyPrompt() in shared/domain/daily-prompt.js '
  'message for message. Both switches must be real jsonb booleans, and "off but opening by '
  'itself" is refused rather than narrowed. An absent dailyPrompt key is legal: the resolver '
  'defaults to on, so a project that never opens the card gets the prompt.';
