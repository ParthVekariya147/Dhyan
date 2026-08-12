-- વર્ણી ધ્યાન — લેવલ ૪: a passed કસોટી may be sat again, after all.
--
-- The decision, and its history
-- ----------------------------
-- This rule has now been set three times, and it is worth recording plainly so that the next
-- person to read `level4_submit` does not think one of the migrations was a mistake:
--
--   0012  unlimited attempts. Any unlocked કસોટી, any number of times, a pass never revoked.
--   0016  one submission, spent by passing. A failed attempt could be retried; a passed one
--         refused further submissions with `level4_already_passed`.
--   0017  unlimited attempts again. **This is the current rule.**
--
-- The સંચાલક saw 0016 in front of him — "આ કસોટી હવે કાયમ પૂરી ગણાશે — ફરી આપવાની નથી" — and
-- decided it was not what he wanted for this સાધના. That is his call to make: whether a યુવક
-- may sit a કસોટી he has already passed is a question about the practice, not about the
-- software.
--
-- What comes back
-- ---------------
-- Exactly 0012's rule, restored:
--
--   * `level4_already_passed` is gone. A COMPLETED કસોટી accepts submissions again.
--   * The gate and the ક્રમ check are **skipped** for a કસોટી already passed, so a raised
--     લેવલ ૪ gate (0014) or a reorder can neither lock it nor refuse it. What was earned
--     stays reachable in every sense — openable *and* attemptable.
--   * A COMPLETED row is still never demoted (step 8), so an attempt that falls short on a
--     કસોટી already passed does not un-pass it, and `completed_at` still records the first
--     pass rather than the latest one.
--
-- What 0016 keeps
-- ---------------
-- **The pass mark stays.** `level4_activities.required_count` and `level4_required_count()`
-- are untouched and still decide `passed`. That half of 0016 was never in dispute — it is
-- how many દ્રશ્યો a કસોટી asks for, which is a separate question from how many times it may
-- be answered. Nothing about this migration changes a single configured mark.
--
-- Note for whoever changes this next
-- ----------------------------------
-- The attempt policy is one `if` in this function and about six lines of wording on three
-- screens. It is not structural and it is not expensive to flip. If it is asked for again,
-- the honest options are the two that have been tried — and the third that has not: a
-- સંચાલક-facing setting beside `level4Gate` in settings['levels'], so the question stops
-- being a migration at all. That was not built because a rule that has been reversed twice
-- may settle, and a setting nobody ever changes is its own kind of debt.

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
  already_done boolean;
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

  -- 2. Has he already passed this one?
  --
  --    Read once, before the two access tests, because it excuses him from both. The set is
  --    an explicit COMPLETED row **or** coverage credited from other કસોટીઓ he has passed
  --    (decision #4) — both are passes, and a યુવક credited through a republication is as
  --    free to sit the કસોટી as one who took the original.
  done_ids     := public.level4_completed_activity_ids(uid, cfg.id);
  already_done := act.id = any(done_ids);

  if not already_done then
    -- 3. The gate. Asked only of ground not yet covered: a raised threshold governs what is
    --    still ahead and never reaches back for what he has already done.
    if not public.level4_gate_open(uid) then
      raise exception 'level4_gate_closed';
    end if;

    -- 4. Everything below this કસોટી is finished.
    --
    --    The last condition keeps a કસોટી whose every દ્રશ્ય has been withheld from blocking
    --    the ones after it: it asks for nothing, so it cannot be passed, so it must not be
    --    allowed to stand in the way.
    --
    --    Skipped for a કસોટી already passed, which is what makes this function agree with
    --    the card in front of it — `level4_activity_states()` returns COMPLETED ahead of the
    --    position check, so without this a reorder would leave the screen offering what the
    --    server refuses.
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
  end if;

  -- 5. What was ticked, distinct, intersected with what the કસોટી effectively contains.
  effective := public.level4_effective_items(act.id);

  select coalesce(array_agg(distinct sel.scene_id), '{}'::text[])
    into selected_ids
  from unnest(coalesce(p_selected, '{}'::text[])) as sel(scene_id)
  where sel.scene_id = any(effective);

  item_n     := coalesce(array_length(effective, 1), 0);
  selected_n := coalesce(array_length(selected_ids, 1), 0);
  -- 0016's mark, unchanged: the number the સંચાલક set, clamped to what the કસોટી holds.
  required_n := coalesce(public.level4_required_count(act.id), item_n);

  -- 6. Passing is reaching the mark.
  did_pass := (selected_n >= required_n and required_n > 0);

  -- 7. The attempt, always recorded, passed or not — and now including every repetition of
  --    a કસોટી already passed. `required_count` stores the mark in force at the moment of
  --    the attempt, so a disputed result is checkable against the rule it was judged by.
  insert into public.level4_attempts
    (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed)
  values
    (uid, act.id, act.config_id, selected_ids, selected_n, required_n, did_pass);

  -- 8. The progress row. A COMPLETED row is never demoted: a યુવક who passed ૪.૨ in March
  --    and reopens it in June to practise has not un-passed it by ticking eleven of twelve.
  --    `completed_at` is coalesced for the same reason — the first pass is the one that
  --    happened.
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
  --    a double submit or a lost response cannot inflate it. A repeated કસોટી counts toward
  --    the day it is repeated — he did sit and recall those દ્રશ્યો today. `greatest` on the
  --    way in, because `progress` is also written by લેવલ ૩ and a banked score is never
  --    lowered by anything here.
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
  --     everything is done, and null when this pass was a repetition that finished nothing
  --     new — there is nothing to send him onward to, and the screen says so instead of
  --     pushing him.
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
  'The only way a લેવલ ૪ attempt exists. There is no attempt limit (0017, restoring 0012): '
  'an unlocked કસોટી may be answered as often as the યુવક likes, a pass is never revoked, '
  'and neither a raised gate nor a reorder can withdraw one. Passing is reaching '
  'level4_required_count() — the સંચાલક''s per-કસોટી mark from 0016, which this migration '
  'leaves untouched. Nothing here compares answers.';
