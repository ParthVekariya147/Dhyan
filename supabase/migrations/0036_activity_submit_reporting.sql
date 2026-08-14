-- વર્ણી ધ્યાન — what a submission REPORTS it earned, made equal to what it was actually paid.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE REISSUES `activity_submit()` WHEN 0031, 0033, 0034 AND 0035 ALL REFUSED TO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Four migrations in a row have said, in almost the same words, that they do **not** reissue
-- `activity_submit()` (0031:53, 0033:36, 0034:94, 0035:105). The reason each gave is still the
-- right one: that function is 0021's statement of what an attempt *is* — the IST business day,
-- the server-computed attempt number, the token replay, the day recounted and never
-- incremented — and every one of those decisions is argued in place. Reissuing it to change the
-- award engine underneath it would have restated a rule none of those files had an opinion
-- about, and the next reader following `git log` would have had to open a points migration to
-- find out whether the definition of an attempt had moved.
--
-- This file is the exception, and only because the two defects are **inside** the function.
-- Nothing else in the schema can see them: the ledger is right in both cases, every reader over
-- `point_transactions` is right, and the two totals in step 10 are right. The single wrong
-- number is `pointsAwarded` — the one figure the યુવક is shown for the act he just performed.
--
-- ── defect 1: a replayed submission under-reports ──────────────────────────
--
-- 0021's replay branch reads the ledger back with a bare `select ... into` (0021:980-983):
--
--     select t.points into awarded
--     from public.point_transactions t
--     where t.source = 'ACTIVITY_ATTEMPT' and t.source_id = att.id;
--
-- `select ... into` over several matching rows takes **one of them, arbitrarily**, and does not
-- complain. When 0021 was written that was safe, because one attempt wrote at most one ledger
-- row. Since 0033 it does not: `award_points()` returns `written + point_bonus_apply(...)`
-- (0033:1149-1150), so an attempt that crosses a મુકામ writes a base row and a BONUS row, both
-- carrying `source_id = att.id`. The original call added the two and reported ૫૦૦; the retry -
-- the phone re-sending a submission whose response was lost, which is the ordinary case §31
-- exists for - read one of them and reported ૨૦૦. The same act, two numbers, and the smaller
-- one arrives second, so it reads on screen as points being taken away.
--
-- ── defect 2: a partial લેવલ ૩ પુનરાવર્તન reports 0 while being paid ────────
--
-- Step 9 calls `award_points()` only `if att.status = 'COMPLETED'`, so a ૫૦/૧૦૮ પુનરાવર્તન
-- leaves `awarded` at its declared 0. That was true and complete until 0035, which pays exactly
-- those attempts under a તિક rule — from an AFTER INSERT trigger on `activity_attempts`
-- (`activity_attempts_level3_award`, 0035:838-855), writing `source = 'ACTIVITY_ATTEMPT'` and
-- `source_id = new.id`. 0035 put the award there on purpose and said why: overlapping it with
-- step 9 would have made a keyed second award an idempotent no-op and left `pointsAwarded`
-- reading 0 for everybody. But the trigger fires **during the INSERT in step 6/7**, so by the
-- time step 9 is reached the ledger row already exists and `activity_submit()` simply never
-- looks at it. The યુવક ticks ૫૦ દ્રશ્યો, is told he earned nothing, and is then quietly
-- credited ૫૦ — which reads as points appearing from nowhere, or, on the next screen that
-- disagrees, as points disappearing.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX — ONE COMPUTATION, REPLACING BOTH BRANCHES
-- ════════════════════════════════════════════════════════════════════════════
--
-- Both defects are the same mistake made twice: `awarded` was derived from **what one call
-- returned** rather than from **what the attempt was paid**. So stop asking the caller and ask
-- the ledger:
--
--     if att.status = 'COMPLETED' then
--       perform public.award_points(...);
--     end if;
--
--     select coalesce(sum(t.points), 0) into awarded
--     from public.point_transactions t
--     where t.source = 'ACTIVITY_ATTEMPT' and t.source_id = att.id;
--
-- One computation instead of two branches, correct for every case there is: a normal COMPLETED
-- submit (base plus any મુકામ), a partial પુનરાવર્તન paid by 0035's trigger, a replay that
-- wrote nothing at all, a second COMPLETED attempt on a day already paid under DAY_FIRST (no
-- row, so 0), a REVISION_REQUIRED attempt under no તિક rule (no row, so 0) — and any future
-- writer that attributes a row to the attempt, which is the property that would have stopped
-- 0033 and 0035 from introducing these defects in the first place.
--
-- It is also the doctrine step 10 of this same function has followed since 0021: "both totals
-- come from the ledger, already summed". `pointsAwarded` is now the third such sum, over one
-- attempt instead of over a day or a lifetime, and the three can no longer disagree.
--
-- ── why the `source` filter is load-bearing ────────────────────────────────
--
-- `source_id` alone would be wrong, and silently. `activity_attempts.id` and
-- `level4_attempts.id` are **independent bigserial sequences and overlap freely** — 0031:92
-- says so where it documents `attempt_id` — so attempt #7 of a પુનરાવર્તન and કસોટી attempt #7
-- share a `source_id` and differ only by `source`. 0034 added a fourth source value,
-- `DAILY_RECORD`, whose rows carry `source_id = 0` and award kind DAILY_ADJUST (0034:159,
-- 0034:2265); without the filter every submission by a યુવક whose attempt happened to be id 0
-- - and, more to the point, any future source reusing small ids - would fold somebody else's
-- ગુણ into this answer. `attempt_id` is not used instead because it is NULL on every row
-- written before 0031 (0031:92-95) and this sum must be able to see them.
--
-- ── why `perform` and not an assignment ────────────────────────────────────
--
-- `award_points()`'s return value is unused in this path now. It is discarded with `perform`
-- rather than assigned and then overwritten, so that `awarded` has exactly **one** assignment
-- in the whole function and a reader cannot mistake the call's answer for the reported figure.
-- An assignment followed by an overwrite would leave the old, wrong idea visible in the code
-- and one deleted line away from coming back. The return value has not become useless — the
-- `level4_attempts_award` trigger and `point_bonus_apply()` still use it, and 0033's promise
-- that it includes any bonus still holds; this one caller no longer needs it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS NOT CHANGED
-- ════════════════════════════════════════════════════════════════════════════
--
-- **No awarding behaviour whatsoever.** Not one ledger row that would have been written before
-- this file is written differently, and not one that would not have been written is. Step 9
-- still calls `award_points()` for a COMPLETED attempt and only for one; 0035's trigger still
-- pays the partials and only under `tick.mode` TICK or REVISION; `point_transactions_day_unique`
-- and `point_transactions_idem_idx` are still what make at-most-once a guarantee. Every figure
-- in the ledger before this migration is the figure after it. This is a reporting fix.
--
-- Every other line of the function below is 0021's, transcribed verbatim: the retry loop and its
-- five tries, the token handling and both meanings of a unique violation, step 8's full recount
-- of the day, step 10's two ledger sums, the returned jsonb and its eight keys, and all of the
-- comments that argue for them. The signature is unchanged, so no caller moves.

-- ================================================================ the read this fix depends on

-- `(source, source_id)`, because the fix makes it a per-submission lookup.
--
-- The predicate is not new — 0021's replay branch already ran it — but it ran only on a replay,
-- which is rare. It now runs on **every** submission, against an append-only table that grows
-- for as long as the project does, and `point_transactions_attempt_idx` does not serve it
-- (that one is on `attempt_id`, which is NULL on every pre-0031 row this sum must still see).
-- Without this, `activity_submit()` acquires a sequential scan of the whole ledger per નોંધાવો.
create index if not exists point_transactions_source_idx
  on public.point_transactions (source, source_id);

comment on index public.point_transactions_source_idx is
  'What one event was paid, in total (0036). activity_submit() reads it once per submission to '
  'report pointsAwarded as the sum of the attempt''s ledger rows, and the source column is part '
  'of the key because activity_attempts.id and level4_attempts.id are independent sequences '
  'that overlap.';

-- ================================================================ the only writer of an attempt

-- લેવલ ૧, ૨ or ૩ was practised. Record it, recount the day, pay it if it finished.
--
-- The only way an `activity_attempts` row ever exists. The table has a read policy and no
-- insert, update or delete policy for any client role, so — exactly as 0010 §37 argued for
-- `level4_attempts` — a યુવક cannot PATCH himself a COMPLETED row, because there is no write
-- path to take. This is that whole guarantee.
--
-- Errors are raised as bare identifiers (`activity_unknown`, …) in the shape level4_submit()
-- established, so the client maps them to Gujarati wording in one place rather than parsing
-- prose out of a Postgres message.
--
-- 0021's definition, reissued once in 0036 and changed in exactly one place: how `awarded` is
-- computed. See the header of that file for why the four migrations before it did not reissue
-- this function and why this one had to.
create or replace function public.activity_submit(
  p_level    integer,
  p_activity text,
  p_selected text[],
  p_total    integer,
  p_token    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid          uuid := auth.uid();
  today        date;
  att          public.activity_attempts%rowtype;
  replayed     boolean := false;
  sel          text[];
  completed_n  integer;
  total_n      integer;
  new_status   text;
  awarded      integer := 0;
  tries        integer := 0;
  today_points bigint;
  total_points bigint;
begin
  -- 0. Who, and whether he may write anything at all.
  --
  --    `is_active_user()` is asked here rather than left to a policy because this function is
  --    SECURITY DEFINER and therefore not subject to RLS: a SUSPENDED account can still sign
  --    in and read its own history (0004), and this is what stops it recording anything new.
  if uid is null then
    raise exception 'activity_not_signed_in';
  end if;

  if not public.is_active_user() then
    raise exception 'activity_not_active';
  end if;

  -- 1. The level and the activity agree. Each of the three levels has exactly one activity,
  --    and the pair is what the ledger's day-key is built from — a submission claiming લેવલ ૩
  --    did a 'video' would be priced by `point_value_for(3, ...)` and filed under a key no
  --    screen can render. `activity_attempts_level_key_agree` is the floor under this; this
  --    is the message.
  if p_level is null or p_activity is null
     or not ((p_level = 1 and p_activity = 'video')
          or (p_level = 2 and p_activity = 'darshan')
          or (p_level = 3 and p_activity = 'revision')) then
    raise exception 'activity_unknown';
  end if;

  -- 2. The business day is the **server's**, in IST, and is never accepted from the caller
  --    (§4, §30). A date parameter would be a parameter: a phone with its clock set to
  --    yesterday would be paid again for yesterday, every day, and the ledger's at-most-once
  --    constraint would be enforcing the rule perfectly over a day the yuvak chose. The same
  --    expression appears in `level4_attempts_award()` and in the views below; if the project
  --    ever leaves Asia/Kolkata, those are the four places.
  today := timezone('Asia/Kolkata', now())::date;

  -- 3. Idempotency, before anything is written (§31).
  --
  --    A submit whose response was lost is retried by the phone with the same token. Without
  --    this the retry is a second attempt: `attempt_count` reads 2 for one practice, the day's
  --    recount is honest but describes something that did not happen, and the history screen
  --    shows a repetition the યુવક never made. The token index is what makes this a guarantee
  --    rather than a race — see the exception handler in step 6, which is where a retry that
  --    arrives *while* the first is still running lands.
  if p_token is not null then
    select * into att
    from public.activity_attempts a
    where a.user_id = uid
      and a.client_token = p_token;

    replayed := found;
  end if;

  if not replayed then
    -- 4. What was ticked: distinct, with nulls and blanks dropped. A client that sends
    --    duplicates or an empty string is buggy, not malicious, and failing the યુવક for it
    --    would break §1 rule 4 over something he did not do.
    --
    --    Unlike level4_submit() this does **not** intersect with a required list, because
    --    લેવલ ૩ has no fixed list to intersect with — the collection is the whole of દર્શન and
    --    `p_total` is what the client says was on the screen.
    select coalesce(array_agg(distinct s.scene_id), '{}'::text[])
      into sel
    from unnest(coalesce(p_selected, '{}'::text[])) as s(scene_id)
    where s.scene_id is not null
      and length(btrim(s.scene_id)) > 0;

    completed_n := coalesce(array_length(sel, 1), 0);

    -- `greatest`, so a client that under-reports the total cannot make a partial day read as
    -- complete: ticking ૮૨ while claiming a total of ૧૦ records a total of ૮૨, not ૧૦.
    total_n := greatest(coalesce(p_total, 0), completed_n, 0);

    -- 5. What it came to.
    --
    --    લેવલ ૧ and લેવલ ૨ carry no items at all — there is nothing to be part-way through a
    --    વિડિયો or a દર્શન, and the act *is* the completion. Giving them
    --    REVISION_REQUIRED because `total_items` is 0 would mark a યુવક as unfinished for
    --    having done exactly what was asked, which §1 rule 4 refuses and which would also
    --    mean neither level could ever be paid.
    if p_level in (1, 2) then
      new_status := 'COMPLETED';
    elsif total_n > 0 and completed_n >= total_n then
      new_status := 'COMPLETED';
    else
      new_status := 'REVISION_REQUIRED';
    end if;

    -- 6 & 7. The attempt number, and the attempt.
    --
    --    Computed inside the INSERT rather than read into a variable first, so it is the
    --    server's answer and not something a caller can supply (§10, §30). One statement is
    --    still not atomic against a concurrent submit — Postgres reads the row's snapshot at
    --    statement start, so two submits arriving together can both see the same `max()` — and
    --    `activity_attempts_number_unique` is what turns that into a refusal instead of two
    --    rows both calling themselves attempt #3. The retry then reads the number again.
    --
    --    Five tries, because the loop only spins while another submit for the *same* યુવક,
    --    level, activity and day is committing, which is a queue of a phone against itself.
    --    A sixth collision means something is wrong that retrying will not fix, so the
    --    exception is re-raised rather than swallowed into a silent no-op.
    loop
      tries := tries + 1;

      begin
        insert into public.activity_attempts
          (user_id, level_id, activity_key, activity_date, attempt_number,
           selected_scene_ids, total_items, completed_items, status, client_token, submitted_at)
        select
          uid, p_level, p_activity, today,
          coalesce(max(a.attempt_number), 0) + 1,
          sel, total_n, completed_n, new_status, p_token, now()
        from public.activity_attempts a
        where a.user_id = uid
          and a.level_id = p_level
          and a.activity_key = p_activity
          and a.activity_date = today
        returning * into att;

        exit;

      exception when unique_violation then
        -- Two different collisions arrive here and they mean opposite things.
        --
        -- The token index means the retry raced the original and the original won: the
        -- attempt exists, this call is a duplicate, and the correct answer is the one already
        -- recorded. That is §31 holding at the one moment a check in step 3 could not.
        if p_token is not null then
          select * into att
          from public.activity_attempts a
          where a.user_id = uid
            and a.client_token = p_token;

          if found then
            replayed := true;
            exit;
          end if;
        end if;

        -- Otherwise it is the attempt-number index and the answer is to count again.
        if tries >= 5 then
          raise;
        end if;
      end;
    end loop;
  end if;

  if not replayed then
    -- 8. The day's row, **recounted in full from the day's attempts and never incremented**.
    --
    --    0017:177-181's rule, and its reasoning verbatim: counted from the attempts themselves
    --    rather than incremented, so a retry, a double submit or a lost response cannot
    --    inflate it — the answer is a property of the day's rows, not of how many times this
    --    function ran. It is also self-repairing: a row that somehow drifted is corrected by
    --    the next submit, because nothing here reads the row's old values.
    --
    --    `completed_scene_ids` is the union across the day, not the last attempt's list: a
    --    યુવક who covers ૪૦ this morning and a different ૪૦ this afternoon has covered ૮૦
    --    today. `status` is bool_or over an append-only set, so it structurally cannot demote.
    --    `completed_at` is coalesced and therefore never moved — the first completion is the
    --    one that happened.
    with day as (
      select a.*
      from public.activity_attempts a
      where a.user_id = uid
        and a.activity_date = today
        and a.level_id = p_level
        and a.activity_key = p_activity
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
      uid, today, p_level, p_activity,
      coalesce(max(d.total_items), 0),
      /*
        The union's size, and NOT `max(completed_items)`.

        The two disagree exactly when they matter. A યુવક who submits ૪૦ this morning and a
        *different* ૪૦ this afternoon has brought ૮૦ દ્રશ્યો to mind today: `max()` reports
        ૪૦ and would leave this row saying ૪૦ while holding ૮૦ ids in the column beside it —
        a row that contradicts itself, and a history screen reading ૪૦/૧૦૮ off a day that
        covered ૮૦.

        Counted from the same `ids` CTE the array is built from, so the number and the list
        are two renderings of one fact and cannot drift. This is also precisely what
        `level4_submit` does for the day's લેવલ ૪ score — `count(distinct ticked.scene_id)`
        over the day's attempts (0017:182-187) — so both ladders answer "how much of the
        collection did he cover today" the same way.

        લેવલ ૧ and લેવલ ૨ carry no ids, so this is 0 for them, which is what `max()` gave
        too. Neither renders a coverage: `summariseRow()` sends a row with no items down its
        repetition branch and prints '૫ વાર'.
      */
      (select count(*) from ids i)::integer,
      coalesce((select array_agg(i.scene_id order by i.scene_id) from ids i), '{}'::text[]),
      count(*)::integer,
      case when bool_or(d.status = 'COMPLETED') then 'COMPLETED' else 'REVISION_REQUIRED' end,
      coalesce(min(d.submitted_at), now()),
      min(d.submitted_at) filter (where d.status = 'COMPLETED'),
      now()
    from day d
    on conflict (user_id, activity_date, level_id, activity_key) do update
      set total_items         = excluded.total_items,
          completed_items     = excluded.completed_items,
          completed_scene_ids = excluded.completed_scene_ids,
          attempt_count       = excluded.attempt_count,
          status              = excluded.status,
          started_at          = least(daily_activity_progress.started_at, excluded.started_at),
          completed_at        = coalesce(daily_activity_progress.completed_at, excluded.completed_at),
          updated_at          = now();

    -- 9. The award, only for a finished attempt.
    --
    --    A REVISION_REQUIRED attempt earns nothing **and consumes nothing**, because
    --    award_points() is not called at all: §23's worked example, where the morning's
    --    ૯૬/૧૦૮ leaves the afternoon's ૧૦૮/૧૦૮ free to be paid. A second COMPLETED attempt
    --    calls it and gets 0 back, which is the day already paid and is not a failure.
    --
    --    0036: `perform`, not an assignment. What this call returned is no longer how the
    --    reported figure is computed — see step 9b — and discarding it here means `awarded`
    --    has exactly one assignment in this function.
    if att.status = 'COMPLETED' then
      perform public.award_points(
        uid, att.activity_date, att.level_id, att.activity_key,
        'ACTIVITY_ATTEMPT', att.id, att.attempt_number
      );
    end if;
  end if;

  -- 9b. What this submission earned: **everything this attempt was paid, by whoever paid it**
  --     (0036). Not what the call above returned, and not one row of what it wrote.
  --
  --     Read back from the ledger rather than recomputed, which was already 0021's rule for a
  --     replay and its reason: the configured value may have changed since, and the honest
  --     answer to "what did this submission earn" is the number in the rows it wrote.
  --
  --     Summed, because since 0033 one attempt can write more than one row — a base award and
  --     a મુકામ — and a bare `select ... into` over both of them takes one arbitrarily.
  --     Unconditional, because since 0035 an attempt step 9 skips can still have been paid: a
  --     partial પુનરાવર્તન under a તિક rule is paid by the `activity_attempts_level3_award`
  --     trigger during the INSERT above, so the row exists here even though the branch above
  --     never ran. Both are cases of the same question, and this is the one place it is asked.
  --
  --     `source` is part of the predicate and is load-bearing: `activity_attempts.id` and
  --     `level4_attempts.id` are independent sequences that overlap (0031:92), and 0034's
  --     DAILY_ADJUST rows carry `source = 'DAILY_RECORD'`. `attempt_id` would read the same for
  --     every row written since 0031 but is NULL on every row written before it.
  --
  --     0 when nothing was paid, which is a real and ordinary answer: a second COMPLETED
  --     attempt on a day already paid under DAY_FIRST, a REVISION_REQUIRED attempt with no તિક
  --     rule in force, and a level whose configured value is 0 all land here honestly.
  select coalesce(sum(t.points), 0) into awarded
  from public.point_transactions t
  where t.source = 'ACTIVITY_ATTEMPT'
    and t.source_id = att.id;

  -- 10. Both totals come from the ledger, already summed. §20 forbids deriving the lifetime
  --     figure by walking the day's UI events, and handing back a sum is what makes doing so
  --     unnecessary. `today` here is the current business day even on a replay whose attempt
  --     belongs to an earlier one — the question "how many points do I have today" is about
  --     now, while `activityDate` below is about the attempt.
  select
    coalesce(sum(t.points) filter (where t.activity_date = today), 0),
    coalesce(sum(t.points), 0)
  into today_points, total_points
  from public.point_transactions t
  where t.user_id = uid;

  return jsonb_build_object(
    'attemptNumber',  att.attempt_number,
    'activityDate',   att.activity_date,
    'completedItems', att.completed_items,
    'totalItems',     att.total_items,
    'status',         att.status,
    'pointsAwarded',  awarded,
    'todayPoints',    today_points,
    'totalPoints',    total_points
  );
end;
$$;

revoke all on function public.activity_submit(integer, text, text[], integer, uuid) from public;
grant execute on function public.activity_submit(integer, text, text[], integer, uuid) to authenticated;

comment on function public.activity_submit(integer, text, text[], integer, uuid) is
  'The only way a લેવલ ૧-૩ attempt exists (0021, reissued 0036 for reporting only). Records the '
  'attempt, recounts the day from the day''s attempts (never increments), and awards points only '
  'for a COMPLETED one. The business date is the server''s IST date, never the caller''s (§4, '
  '§30); the attempt number is computed in the insert, never supplied (§10); and a repeat call '
  'carrying the same p_token returns the original attempt unchanged instead of creating a second '
  '(§31). Neither activity_attempts nor daily_activity_progress has an insert or update policy '
  'for any client role, so there is no second path to keep in step with this one (§37). 0036 '
  'changes no awarding behaviour at all: pointsAwarded is now sum(point_transactions.points) '
  'over the attempt''s own rows instead of the value one award_points() call returned, so a '
  'replay of a submission that crossed a મુકામ reports both rows rather than one of them, and a '
  'partial પુનરાવર્તન paid by 0035''s trigger reports what it was paid instead of 0.';

-- ================================================================ notes for the next reader
--
-- **This changed one number on one screen.** `pointsAwarded` in the answer to a નોંધાવો. The
-- ledger, `daily_activity_progress`, `my_point_totals()`, `my_point_history()`, the board and
-- every સંચાલક reader were all already correct and are all untouched — which is why the figures
-- scripts/test-scoring-scenarios.mjs pins (300, 800, 71/81/131, 540, 1200/2400, 1771) are the
-- same before and after this file.
--
-- **The property to hold on to.** `pointsAwarded` is the sum of that attempt's ledger rows. Any
-- future writer that attributes a row to an `activity_attempts` id — a new bonus kind, a new
-- trigger, a correction path — is reported to the યુવક automatically, and does not need this
-- function reissued a third time. That is the whole point of reading the ledger instead of a
-- return value, and it is the same rule step 10 has always followed for the two totals.
--
-- **What was deliberately left alone.** `award_points()` and its return value (still used by
-- `level4_attempts_award()` and still promising to include any bonus, 0033); 0035's
-- `activity_attempts_level3_award` trigger and its WHEN clause, which is still the only thing
-- that pays a partial; `level4_submit()`; and every row already in `point_transactions`.
