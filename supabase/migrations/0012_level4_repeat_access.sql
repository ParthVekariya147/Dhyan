-- વર્ણી ધ્યાન — લેવલ ૪: what is earned stays earned, and may be walked again.
--
-- The rule this migration makes true
-- ----------------------------------
-- There are two questions about a કસોટી and they had been answered by one test:
--
--   ACCESS      — may this યુવક open this કસોટી at all?
--   ATTEMPTS    — how many times may he answer it?
--
-- The second answer has always been "as many as he likes": `level4_submit` has never held a
-- cap, `level4_attempts` keeps every row, and 0010 step 7 is explicit that a COMPLETED row is
-- never demoted. Nothing about repetition changes here and nothing about progression does
-- either — ક્રમ still holds, and a કસોટી still opens only when the one before it is done.
--
-- What changes is the one place where the first answer could take back the second:
--
--   **An activity this યુવક has already completed is always attemptable.**
--
-- Two paths could previously refuse one, and both refuse it for a reason that is not his:
--
--   1. **The gate closed behind him.** `level4_gate_open()` is not a fact about the યુવક
--      alone — it reads `gate_threshold` off the *published configuration*, which decision #3
--      put in the સંચાલક's hands. Raise it from ૫૦ to ૯૦ and every યુવક between the two
--      numbers loses લેવલ ૪ entirely: the cards he passed in March read તાળું, and
--      `level4_submit` answers `level4_gate_closed` if he reaches one by URL. He did nothing;
--      a number moved.
--
--   2. **Something below him became unfinished.** `level4_activity_states()` already asked
--      COMPLETED before the position check, precisely so that a reorder could not re-lock a
--      passed કસોટી — but `level4_submit` asked the position check unconditionally. So the
--      card said પૂરું થયું and offered itself, and the submit behind it raised
--      `level4_locked`. The two disagreed, and the screen was the one that was wrong.
--
-- Neither path can now revoke a completion. What they still do — and must — is govern
-- ground he has *not* covered: an unfinished કસોટી behind a closed gate is LOCKED, an
-- unfinished કસોટી with an unfinished કસોટી before it is LOCKED, and `level4_submit` refuses
-- both. Sequential unlock is untouched. Nothing here opens a કસોટી that was not already
-- earned; it only stops one being taken away.
--
-- What is deliberately NOT changed
-- -------------------------------
-- * **Step 8, the day's score.** A repeated કસોટી goes on counting toward `level4_score` for
--   the day it is repeated — it is a ધ્યાન he actually did, and `greatest()` still means a
--   banked score is never lowered.
-- * **`completed_at`.** Still the first pass, still coalesced. The moment a કસોટી was
--   completed does not move because he practised it again.
-- * **The gate itself.** `level4_gate_open()` is unchanged, and so is 0011's
--   `profiles_level4.level4_gate_open` — "has this યુવક reached લેવલ ૪ *now*" is still the
--   same question with the same answer, and the સંચાલક's report of it does not change
--   because a completed કસોટી remains open.

-- ================================================================ the derivation

-- 0010's function, with one branch moved.
--
-- COMPLETED is now asked before the gate as well as before the position check. The rest of
-- the ordering is 0010's and is unchanged, and the reason it cannot be reshuffled further is
-- the same: each branch below the first is only correct because the ones above it have
-- already been ruled out.
--
--   COMPLETED  first  — earned is earned. Nothing after this can lower it (§1 rule 4).
--   gate       next   — a યુવક who has not reached લેવલ ૪ sees a wholly locked page, except
--                       for whatever he had already earned before the number moved.
--   position   next   — ક્રમ, for everything still ahead of him (§1 rule 2).
--   explicit   next   — REVISION_REQUIRED / IN_PROGRESS, what his own row says.
--   AVAILABLE  last   — nothing stands in the way.
--
-- A closed gate with completions behind it is a real state and the client renders it: the
-- passed કસોટીઓ read પૂરું થયું and stay open, the rest read તાળું with the gate's own
-- invitation above them. See withStatuses() in src/lib/level4.js, which mirrors this order.
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
           when act.is_done                    then 'COMPLETED'
           when not (select is_open from gate) then 'LOCKED'
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

comment on function public.level4_activity_states(uuid, uuid) is
  'Every કસોટી of a configuration with this યુવક''s status, in ક્રમ. COMPLETED is asked '
  'first — before the gate and before the position check — so that neither a raised '
  'gate_threshold nor a reorder can take back a કસોટી he has passed (0012). Mirrored by '
  'withStatuses() in src/lib/level4.js and deriveStatuses() in shared/domain/level4.js.';

-- ================================================================ the write

-- 0010's function, with steps 2 and 3 made conditional and nothing else touched.
--
-- The completed set is now fetched *before* the gate rather than between the gate and the
-- lock, because both tests now need it. It costs nothing extra — 0010 already computed it
-- exactly once for step 3, and this is the same single call moved three lines up.
--
-- The two refusals it guards are unchanged in every other respect, including their
-- identifiers: `level4_gate_closed` and `level4_locked` still mean exactly what
-- src/lib/level4.js's L4_ERRORS says they mean, so no Gujarati sentence moves.
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

  -- 0. The account is still ACTIVE. SECURITY DEFINER bypasses RLS, so the lifecycle every
  --    other write is subject to has to be asked for here or not at all.
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

  -- 1b. Has he already passed this one?
  --
  --     Read once, and read *before* the two access tests, because it is what excuses him
  --     from both. `level4_completed_activity_ids()` is STABLE and the planner may fold it,
  --     but "may" is not a promise and it walks every item of every activity each time it
  --     runs — so it is fetched into a variable and not called inside an EXISTS.
  --
  --     Note which set this is: an explicit COMPLETED row **or** coverage by other કસોટીઓ he
  --     has passed (decision #4). Both are completions and neither is re-derived here, so a
  --     યુવક credited through a republication is as free to repeat as one who sat the
  --     original — which is the point of crediting him at all.
  done_ids     := public.level4_completed_activity_ids(uid, cfg.id);
  already_done := act.id = any(done_ids);

  if not already_done then
    -- 2. The gate. Asked only of ground not yet covered: a raised gate_threshold governs
    --    what is still ahead of him and never reaches back for what he has already done.
    if not public.level4_gate_open(uid, cfg.id) then
      raise exception 'level4_gate_closed';
    end if;

    -- 3. Everything below this activity is finished.
    --
    --    The last condition is the one to read twice: an activity whose every દ્રશ્ય has
    --    been withheld asks for nothing, so it cannot be passed and therefore must not be
    --    allowed to block. Without it, withholding a handful of images would shut every
    --    યુવક out of the rest of લેવલ ૪ with no way forward.
    --
    --    Skipped for a કસોટી already passed, which is what makes this function agree with
    --    the card in front of it: `level4_activity_states()` has always returned COMPLETED
    --    ahead of the position check, so a reorder that put something unfinished in front
    --    of a passed કસોટી used to leave the screen offering what the server would refuse.
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

  -- 4. required := what the activity effectively contains. selected := what was ticked,
  --    distinct, intersected with required. Duplicates and unknown ids are dropped rather
  --    than rejected: a client that sends them is buggy, not malicious, and failing the
  --    યુવક for it would break §1 rule 4 over something he did not do.
  required_ids := public.level4_effective_items(act.id);

  select coalesce(array_agg(distinct sel.scene_id), '{}'::text[])
    into selected_ids
  from unnest(coalesce(p_selected, '{}'::text[])) as sel(scene_id)
  where sel.scene_id = any(required_ids);

  required_n := coalesce(array_length(required_ids, 1), 0);
  selected_n := coalesce(array_length(selected_ids, 1), 0);

  -- 5. Passing is covering all of it. There is no correctness comparison anywhere in
  --    લેવલ ૪ — only ground covered and ground not yet covered.
  did_pass := (selected_n = required_n and required_n > 0);

  -- 6. The attempt, always recorded, passed or not. Including the partial ones the કસોટી
  --    screen now lets him send: an attempt that fell short is a real event of his સાધના
  --    and belongs in the history beside the ones that did not.
  insert into public.level4_attempts
    (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count, passed)
  values
    (uid, act.id, act.config_id, selected_ids, selected_n, required_n, did_pass);

  -- 7. The progress row. A COMPLETED row is never demoted — a યુવક who passed ૪.૨ in March
  --    and reopens it in June to practise has not un-passed it by ticking eleven of twelve.
  --    `completed_at` is coalesced for the same reason: the first pass is the one that
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

  -- 8. The day's score (decision #2), unchanged by 0012.
  --
  --    Counted from the attempts themselves rather than incremented, so a retry, a double
  --    submit or a lost response cannot inflate it — the answer is a property of the day's
  --    rows, not of how many times this function ran. A repeated કસોટી therefore counts
  --    toward the day it is repeated, which is the intended reading: he did sit and recall
  --    those દ્રશ્યો today. `greatest` on the way in because `progress` is also written by
  --    તબક્કો ૩ and by future levels; a banked score is never lowered by anything here.
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
  --    after this attempt. Null when everything is done, and null when this pass was a
  --    repetition that finished nothing new — there is nothing to send him onward to, and
  --    the screen says so instead of pushing him.
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
  'The only way a લેવલ ૪ attempt exists. Verifies the account, the publication, the gate and '
  'the ક્રમ before it writes anything (§37). There is no attempt limit and never has been: a '
  'કસોટી once passed may be answered again as often as the યુવક likes, and neither a raised '
  'gate_threshold nor a reorder can take that back (0012). Passing is covering every દ્રશ્ય '
  'of the કસોટી — nothing here compares answers.';
