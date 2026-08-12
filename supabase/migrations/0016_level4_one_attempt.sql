-- વર્ણી ધ્યાન — લેવલ ૪: one submission per કસોટી once it is passed, and a pass mark the
-- સંચાલક sets.
--
-- Two rules, and they belong together
-- -----------------------------------
--   1. **A કસોટી that has been passed cannot be sat again.** Not "cannot be opened" — the
--      દર્શન behind it stay open forever. What closes is the submission.
--   2. **Passing is a number the સંચાલક chooses**, per કસોટી, instead of always being every
--      દ્રશ્ય in it.
--
-- They arrive in one migration because either alone is a trap. A pass mark below 100% with
-- unlimited attempts is a કસોટી a યુવક can walk through by submitting repeatedly; a one-shot
-- submission at a fixed 100% is a કસોટી he fails forever by misremembering one દ્રશ્ય out of
-- twenty-seven. Together they are an exam: one attempt that counts, at a mark someone chose
-- deliberately.
--
-- What this reverses, and what of 0012 survives
-- ---------------------------------------------
-- 0012 made a completed કસોટી *always* attemptable. That is now the opposite: a completed
-- કસોટી is never attemptable. The reversal is deliberate and is the સંચાલક's decision.
--
-- The rest of 0012 stands, and it is what keeps this humane:
--
--   * COMPLETED is still derived before the gate and before the ક્રમ check, so neither a
--     raised `level4Gate.threshold` (0014) nor a reorder can un-pass a કસોટી. A passed
--     કસોટી is permanent in both directions now — it cannot be taken away, and it cannot be
--     taken again.
--   * A કસોટી that has NOT been passed is untouched: the gate applies, ક્રમ applies, and it
--     may be attempted as many times as it takes. **A failed attempt is not spent.** That is
--     the whole reason this is "one submission once passed" and not "one submission ever" —
--     the latter turns a single slip into a permanent dead end with no way forward, and
--     there is no સંચાલક reset in this system to rescue anyone from it.
--
-- So the shape is: attempt, attempt, attempt — pass — closed.

-- ================================================================ the pass mark

-- How many દ્રશ્યો of this કસોટી must be recalled to pass it.
--
-- NULL means "all of them", which is what every existing row means and what the column
-- defaults to — so this migration changes nothing for any કસોટી already composed. A number
-- means that many, out of however many the કસોટી effectively contains.
--
-- Deliberately a count and not a percentage. The સંચાલક composes a કસોટી by picking દ્રશ્યો,
-- so he is already thinking in items; a percentage would have to be resolved against a total
-- that moves when a દ્રશ્ય is withheld, and "૯૦%" of ૨૭ items is a number nobody typed.
alter table public.level4_activities
  add column if not exists required_count integer
    check (required_count is null or required_count >= 1);

comment on column public.level4_activities.required_count is
  'How many દ્રશ્યો must be ticked to pass this કસોટી. NULL = all of them, which is what '
  'every કસોટી meant before 0016. Clamped down to the effective item count at submit time, '
  'so withholding દ્રશ્યો can never make a કસોટી impossible to pass.';

-- What it actually takes to pass this કસોટી, right now.
--
-- One function because three places need the same answer and must not each compute it:
-- `level4_submit` decides `passed` with it, `level4_published_config()` reports it so the
-- કસોટી screen knows when to offer the button, and the panel prints it.
--
-- `least(...)` is the load-bearing part. `required_count` is a number the સંચાલક typed when
-- the કસોટી held twenty-seven દ્રશ્યો; if he later withholds three, the કસોટી effectively
-- holds twenty-four and a requirement of twenty-seven can never be met — the exact trap
-- `level4_effective_items()` was written to close, reopened one level up. Clamping means the
-- requirement can only ever be as large as the કસોટી, so it is always satisfiable by
-- ticking everything on screen.
--
-- Zero items answers 0, and `level4_submit` refuses to pass anything at 0 — an empty કસોટી
-- is not passed by submitting nothing.
create or replace function public.level4_required_count(p_activity_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select least(
           coalesce(a.required_count, cardinality(public.level4_effective_items(a.id))),
           cardinality(public.level4_effective_items(a.id))
         )
  from public.level4_activities a
  where a.id = p_activity_id;
$$;

revoke all on function public.level4_required_count(uuid) from public;

-- ================================================================ the submission

-- 0012's function, with the attempt policy reversed and the pass mark made configurable.
--
-- The order of the checks is unchanged except for one new refusal, placed first among the
-- state checks because it is the one that is *not* an obstacle: `level4_already_passed` is
-- not "you may not yet", it is "you already did". A યુવક meeting it has done nothing wrong
-- and has lost nothing, and src/lib/level4.js says so in those words.
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
  effective    text[];
  selected_ids text[];
  required_n   integer;
  selected_n   integer;
  item_n       integer;
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

  if not public.is_active_user() then
    raise exception 'level4_not_active';
  end if;

  -- 1. The activity exists, is active, and belongs to the PUBLISHED configuration.
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

  done_ids := public.level4_completed_activity_ids(uid, cfg.id);

  -- 2. Already passed — the one submission this કસોટી gets has been made (0016).
  --
  --    Asked before the gate and before ક્રમ, because it is not a refusal of the same kind:
  --    those two say "not yet", this one says "already done, and it still counts". Answering
  --    `level4_gate_closed` to a યુવક reopening a કસોટી he passed in March would be both
  --    wrong and unkind.
  --
  --    Note which set this tests: an explicit COMPLETED row **or** coverage credited from
  --    other કસોટીઓ he has passed (decision #4). Both are passes. A કસોટી whose દ્રશ્યો he
  --    has already covered elsewhere is one he has already demonstrated, and asking him to
  --    sit it would be asking twice for the same ધ્યાન.
  if act.id = any(done_ids) then
    raise exception 'level4_already_passed';
  end if;

  -- 3. The gate.
  if not public.level4_gate_open(uid) then
    raise exception 'level4_gate_closed';
  end if;

  -- 4. Everything below this કસોટી is finished. The last condition keeps a કસોટી whose every
  --    દ્રશ્ય has been withheld from blocking the ones after it — it asks for nothing, so it
  --    cannot be passed, so it must not be allowed to stand in the way.
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

  -- 5. What was ticked, distinct, intersected with what the કસોટી effectively contains.
  --    Duplicates and unknown ids are dropped rather than rejected: a client that sends them
  --    is buggy, not malicious, and failing the યુવક for it would punish him for something
  --    he did not do.
  effective := public.level4_effective_items(act.id);

  select coalesce(array_agg(distinct sel.scene_id), '{}'::text[])
    into selected_ids
  from unnest(coalesce(p_selected, '{}'::text[])) as sel(scene_id)
  where sel.scene_id = any(effective);

  item_n     := coalesce(array_length(effective, 1), 0);
  selected_n := coalesce(array_length(selected_ids, 1), 0);
  required_n := coalesce(public.level4_required_count(act.id), item_n);

  -- 6. Passing is reaching the mark — `>=`, not `=`, because the mark may be below the
  --    કસોટી's size now. `required_n > 0` keeps an empty કસોટી from being passed by
  --    submitting nothing; such a કસોટી is not offered on the page at all, so this is the
  --    floor under that rather than something a યુવક meets.
  did_pass := (selected_n >= required_n and required_n > 0);

  -- 7. The attempt, always recorded, passed or not — including the ones that fell short.
  --    `required_count` stores the mark that was in force at the moment of the attempt, not
  --    the item count: a disputed result has to be checkable against the rule it was judged
  --    by, and the સંચાલક may move that rule afterwards.
  insert into public.level4_attempts
    (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed)
  values
    (uid, act.id, act.config_id, selected_ids, selected_n, required_n, did_pass);

  -- 8. The progress row. COMPLETED is still never demoted — and after 0016 it is also never
  --    reached twice, because step 2 refuses the submission that would do it.
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

  -- 9. The day's score. Counted from the day's attempts rather than incremented, so a retry,
  --    a double submit or a lost response cannot inflate it. `greatest` on the way in
  --    because `progress` is also written by લેવલ ૩: a banked score is never lowered here.
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

  -- 10. Where to go next: the lowest-positioned active કસોટી still unfinished. Null when
  --     everything is done — the screen shows the completion state rather than pushing him on.
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
    'itemCount',      item_n,
    'status',         new_status,
    'attemptCount',   attempts,
    'nextActivityId', next_id
  );
end;
$$;

revoke all on function public.level4_submit(uuid, text[]) from public;
grant execute on function public.level4_submit(uuid, text[]) to authenticated;

comment on function public.level4_submit(uuid, text[]) is
  'The only way a લેવલ ૪ attempt exists. Since 0016 a કસોટી gets one submission that counts: '
  'a failed attempt may be retried as often as needed, and a PASSED કસોટી refuses further '
  'submissions with level4_already_passed. Passing is reaching level4_required_count(), '
  'which the સંચાલક sets per કસોટી and which is clamped to what the કસોટી actually holds. '
  'Nothing here compares answers — there is no wrong દ્રશ્ય, only ground not yet covered.';

-- ================================================================ what the app is told

-- The published configuration, now carrying each કસોટી's pass mark.
--
-- The કસોટી screen needs it for one reason: 'પૂરું કરો' appears when the mark is reached, and
-- a screen that did not know the mark would have to guess — either offering the button too
-- early, which the server would refuse, or too late, which would hide a pass the યુવક had
-- already earned.
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
                 'sceneIds',      to_jsonb(public.level4_effective_items(a.id)),
                 -- The mark as it stands now, already clamped — never the raw column, so
                 -- the screen and the server cannot disagree about what passing means.
                 'requiredCount', public.level4_required_count(a.id)
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
