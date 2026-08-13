-- વર્ણી ધ્યાન — one logical submission, one attempt row.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `level4_submit()` (0017) records the attempt unconditionally:
--
--     insert into public.level4_attempts (…) values (…);
--
-- There is nothing that could recognise the same submission arriving twice. Five ordinary
-- things send it twice:
--
--   * a double tap on a phone, where the second lands before React has re-rendered
--   * the browser's own retry of a POST whose response was lost on a weak signal
--   * `fetch` retried by a service worker or by supabase-js
--   * the same કસોટી open in two tabs, submitted from both
--   * a refresh mid-submit, then submitting again
--
-- Two things are already safe and are worth stating so the fix is not over-scoped. The day's
-- score is **counted, not incremented** (0017 step 9: `count(distinct ticked.scene_id)` over
-- the day's attempts), so a duplicate cannot inflate it. And the ledger's
-- `point_transactions_day_unique` (0021) pays a (યુવક, IST day, level, activity) at most once,
-- so a duplicate cannot pay twice. That is why this was never visible as a wrong number.
--
-- What is not safe is the record itself. Two rows land in `level4_attempts` for one sitting,
-- and `level4_activity_progress.attempt_count` is incremented twice by the `on conflict do
-- update` in step 8. The યુવક's history then says he sat ૪.૧ twice when he sat it once, the
-- ledger row records an `attempt_number` that does not correspond to anything he did, and
-- there is no way after the fact to tell a duplicate from a real repetition — which matters
-- precisely because 0017 made real repetitions legal.
--
-- `disabled={sending}` in the React page is not a fix for any of the five cases above except
-- the first, and not reliably even for that one. The guarantee has to be in the database.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- An idempotency key, supplied by the caller, unique per (યુવક, key), and the function
-- **replays** rather than refuses when it sees one it has already recorded.
--
-- Replay and not refuse, because a refusal is indistinguishable from a failure at the one
-- moment the client cannot tell the difference: it retried because it never saw the first
-- answer. Answering with the original result is the only outcome that makes a retry safe —
-- the client gets the same `passed`, the same counts and the same `nextActivityId` it would
-- have got had the first response arrived.
--
-- ── What this must not break ────────────────────────────────────────────────
--
-- **Repeat access (0017) is untouched.** A યુવક may sit an unlocked કસોટી as often as he
-- likes, and each *deliberate* sitting is a new key, so each records its own attempt. The key
-- is minted when he presses the button, not when the page loads — see `src/lib/level4.js`.
-- Nothing here compares selections, and nothing here has an opinion about how many times a
-- કસોટી may be answered.
--
-- **Sequential unlock is untouched.** Steps 1-4 are 0017's, character for character.
--
-- ── Why a client key and not a time window ──────────────────────────────────
--
-- "Ignore an identical submission within N seconds" needs no client change and is wrong in
-- both directions: it collapses two genuine attempts that happen to agree (a યુવક who ticks
-- the same twelve દ્રશ્યો twice in a minute — the ordinary shape of practice), and it misses a
-- retry that arrives after N. An explicit key says what only the caller knows: whether this is
-- the same submission or another one.
--
-- ── Callers that send no key ────────────────────────────────────────────────
--
-- `p_token` defaults to NULL and NULL rows are exempt from the unique index, so an old
-- client — or a stale bundle a યુવક has cached — behaves exactly as it does today: recorded,
-- not deduplicated. This migration cannot break a client that has not been updated, and the
-- deployment order does not matter.

-- ================================================================ the key

alter table public.level4_attempts
  add column if not exists client_token uuid;

comment on column public.level4_attempts.client_token is
  'The caller''s idempotency key for one logical submission (0025). NULL for attempts recorded '
  'before this migration and by any client that sends none. Never generated server-side: a key '
  'the server invents is a new key on every retry, which is the thing it exists to prevent.';

-- Partial, so the column stays nullable and the history written before 0025 is untouched.
-- This index — not the check inside the function — is what actually decides a race between
-- two identical requests landing in the same millisecond.
create unique index if not exists level4_attempts_token_idx
  on public.level4_attempts (user_id, client_token)
  where client_token is not null;

-- ================================================================ the replay

-- The original answer, rebuilt from what was recorded.
--
-- A separate function so that the two places level4_submit() returns it cannot drift into two
-- slightly different shapes — the retry path is the one nobody looks at, and a field missing
-- from it would surface as a blank result screen on a bad connection and nowhere else.
--
-- Everything comes from the stored row except `itemCount` and `nextActivityId`, which are
-- recomputed because they are statements about the configuration as it is now rather than
-- about the attempt. That is what the original call returned too — it computed them at the
-- moment it answered.
--
-- SECURITY DEFINER with no grant, exactly like the other helpers in 0010: it takes a row that
-- names a user, so an execute grant would be a way to read another યુવક's attempt.
create or replace function public.level4_replay(att public.level4_attempts)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  act     public.level4_activities%rowtype;
  prog    public.level4_activity_progress%rowtype;
  next_id uuid;
begin
  select a.* into act
  from public.level4_activities a
  where a.id = att.activity_id;

  select p.* into prog
  from public.level4_activity_progress p
  where p.user_id = att.user_id
    and p.activity_id = att.activity_id;

  if att.passed and act.id is not null then
    select nx.id into next_id
    from public.level4_activities nx
    where nx.config_id = act.config_id
      and nx.active
      and nx.position > act.position
      and not (nx.id = any(public.level4_completed_activity_ids(att.user_id, act.config_id)))
    order by nx.position
    limit 1;
  end if;

  return jsonb_build_object(
    'passed',         att.passed,
    'selectedCount',  att.selected_count,
    'requiredCount',  att.required_count,
    'itemCount',      coalesce(cardinality(public.level4_effective_items(att.activity_id)), 0),
    'status',         prog.status,
    'attemptCount',   prog.attempt_count,
    'nextActivityId', next_id,
    -- The one field that differs from a first answer, and it is advisory only: no screen
    -- branches on it. It exists so that a duplicate is visible in a network log when somebody
    -- is working out why a યુવક saw the result twice.
    'replayed',       true
  );
end;
$$;

revoke all on function public.level4_replay(public.level4_attempts) from public;

comment on function public.level4_replay(public.level4_attempts) is
  'Rebuilds level4_submit()''s answer for a submission already recorded (0025). Returned to a '
  'retry so that a lost response is safe to re-send: same passed, same counts, same next '
  'કસોટી, and no second attempt row.';

-- ================================================================ the function

-- The 2-argument signature is dropped rather than left standing beside the new one: with
-- both present, PostgREST resolving a `{p_activity_id, p_selected}` body would find two
-- candidates and answer PGRST203 rather than picking one. Dropping it costs nothing, because
-- the replacement takes the same two arguments and defaults the third — every existing caller
-- keeps working, unchanged, through the same URL and the same body.
drop function if exists public.level4_submit(uuid, text[]);

create or replace function public.level4_submit(
  p_activity_id uuid,
  p_selected    text[],
  p_token  uuid default null
)
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
  prior        public.level4_attempts%rowtype;
begin
  if uid is null then
    raise exception 'level4_not_signed_in';
  end if;

  if not public.is_active_user() then
    raise exception 'level4_not_active';
  end if;

  -- 0. Have we already recorded this exact submission?
  --
  --    Asked before anything else, and deliberately before the access tests: a retry of a
  --    submission that was accepted must not be re-judged. The gate may have moved and the
  --    સંચાલક may have reordered the કસોટીઓ in the seconds since; re-running steps 3 and 4
  --    could then answer `level4_locked` to a retry of something that already happened, which
  --    would reach the યુવક as his completed કસોટી being taken away.
  if p_token is not null then
    select * into prior
    from public.level4_attempts
    where user_id = uid and client_token = p_token;

    if found then
      return public.level4_replay(prior);
    end if;
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

  -- 2. Has he already passed this one? (0017 — unchanged.)
  done_ids     := public.level4_completed_activity_ids(uid, cfg.id);
  already_done := act.id = any(done_ids);

  if not already_done then
    -- 3. The gate. (0017 — unchanged.)
    if not public.level4_gate_open(uid) then
      raise exception 'level4_gate_closed';
    end if;

    -- 4. Everything below this કસોટી is finished. (0017 — unchanged.)
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
  required_n := coalesce(public.level4_required_count(act.id), item_n);

  -- 6. Passing is reaching the mark.
  did_pass := (selected_n >= required_n and required_n > 0);

  -- 7. The attempt, always recorded — now carrying the key.
  --
  --    The exception handler is not belt-and-braces around the check at step 0: it is the
  --    part that actually holds. Two identical requests can both pass step 0 (neither has
  --    committed yet, so neither sees the other's row) and only the unique index can separate
  --    them. The loser reads the winner's row and replays it, so both callers get the same
  --    answer and exactly one attempt exists — which is the whole promise of this migration.
  begin
    insert into public.level4_attempts
      (user_id, activity_id, config_id, selected_scene_ids, selected_count, required_count,
       passed, client_token)
    values
      (uid, act.id, act.config_id, selected_ids, selected_n, required_n, did_pass, p_token);
  exception
    when unique_violation then
      select * into prior
      from public.level4_attempts
      where user_id = uid and client_token = p_token;
      -- A unique_violation with no row behind it is not this index and must not be swallowed.
      if not found then
        raise;
      end if;
      return public.level4_replay(prior);
  end;

  -- 8. The progress row. A COMPLETED row is never demoted. (0017 — unchanged.)
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

  -- 9. The day's score, counted rather than incremented. (0017 — unchanged.)
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

  -- 10. Where to go next. (0017 — unchanged.)
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
    'nextActivityId', next_id,
    'replayed',       false
  );
end;
$$;

revoke all on function public.level4_submit(uuid, text[], uuid) from public;
grant execute on function public.level4_submit(uuid, text[], uuid) to authenticated;

comment on function public.level4_submit(uuid, text[], uuid) is
  'The only way a લેવલ ૪ attempt exists (0010/0012/0016/0017), plus 0025''s idempotency key. '
  'Repeat access and sequential unlock are 0017''s and unchanged: an unlocked કસોટી may be '
  'answered as often as the યુવક likes. What p_token adds is that one *logical* '
  'submission — retried, double-tapped, or sent from two tabs — records one attempt and '
  'answers the same result every time.';

