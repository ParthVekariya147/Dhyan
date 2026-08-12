-- વર્ણી ધ્યાન — લેવલ ૪ નું તાળું ખૂલવાનો નિયમ (§7).
--
-- What was wrong
-- --------------
-- `profiles.level4_unlocked` has existed since 0001_init.sql:36 with `default false`, and
-- **nothing in the repository ever set it to true** — no trigger, no function, no client
-- write. src/pages/Home.jsx locks લેવલ ૪ on that flag, so for every યુવક the last stage of
-- the સાધના — ફક્ત નંબર — was unreachable by construction. The lock was not strict; it was
-- permanent. This migration is the rule that opens it.
--
-- The rule, from §7 / PLAN.md §4:
--
--   લેવલ ૪ opens when a યુવક ticks **૮૦ or more દ્રશ્યો in a single day at લેવલ ૩**.
--   Once opened it stays open **forever** — the midnight reset (§9) clears the day's
--   ticks, never the level.
--
-- Where the enforcement belongs, and why it is here
-- ------------------------------------------------
-- Three places were possible. Two of them are not honest:
--
--   1. **In the browser** — src/lib/*.js writing `profiles.level4_unlocked = true` after
--      counting its own ticks. The profiles RLS policy ("own profile updatable",
--      0004_rbac.sql:594) lets a યુવક update his own row, so this is one line in the
--      console away from being self-granted. Worse, it is *silently* forgeable: the
--      dashboard would show લેવલ ૪ unlocked next to a day's score of ૧૨, and nothing in
--      the data would say which of the two was the lie.
--
--   2. **In an RLS policy on profiles** — a WITH CHECK that only permits the flag to go
--      true when the day's score qualifies. Closer, but a policy governs *permission to
--      write*, not *the act of writing*: the flag would still only move if some client
--      remembered to send it, so a યુવક who earned લેવલ ૪ on a phone that lost signal at
--      the wrong moment would simply not get it.
--
--   3. **A trigger on `public.progress` — chosen.** `progress` is the table that records
--      the day's score (0001_init.sql:46-60), one row per યુવક per date. Deriving the
--      unlock there means it is computed from the same statement that records the score,
--      inside the same transaction, from data the client cannot supply independently of
--      the score itself. A યુવક can still write `level3_score = 108` by hand — RLS lets
--      him own his row — but then he has forged **the score the સંચાલક reads on the
--      dashboard**, which is a visible, attributable claim, not an invisible privilege.
--      That is the property worth having: not "unforgeable", which nothing client-owned
--      is, but "not forgeable without forging the record that is already being watched".
--
-- Why `public.progress` and not `learning_state`
-- ----------------------------------------------
-- `progress` has had no reader and no writer since 0001 created it, which invites the
-- assumption that it is dead and that the journey's `learning_state` should carry this
-- instead. It is not dead — it is *early*. The four levels (§7) and the guided journey
-- (§15-§20) are two different things: the journey's ઓળખ stage shows the ચિત્ર, its વર્ણન
-- **and** a tick box, while લેવલ ૩ shows the વર્ણન with no image at all. Crediting an
-- image-assisted tick as a લેવલ ૩ tick would hand out લેવલ ૪ for an easier task and record
-- a score that means something other than what the column is named. `progress` is where
-- તબક્કો ૩ writes the day's લેવલ ૩/૪ scores, and this trigger is waiting for it there.
--
-- ================================================================ the threshold

-- ૮૦ is a product constant from §7, not a count of content, so it is a literal here and a
-- literal in shared/domain/constants.js (LEVEL4_UNLOCK_THRESHOLD) — the two must agree.
-- It is a function rather than a bare 80 in the trigger body for exactly that reason: one
-- definition on this side, named, so a future change is one edit and `grep` finds it.
--
-- §62's rule ("no total is ever a literal") is about *totals* — how many દ્રશ્યો there are —
-- and is untouched: nothing below counts scenes or divides by a collection size.
create or replace function public.level4_unlock_threshold()
returns integer
language sql
immutable
as $$
  select 80;
$$;

comment on function public.level4_unlock_threshold() is
  'Ticks at લેવલ ૩ in one day that open લેવલ ૪ (§7). Mirrors LEVEL4_UNLOCK_THRESHOLD in '
  'shared/domain/constants.js — keep the two in step.';

-- Has this યુવક ever had a qualifying day?
--
-- "ever", deliberately: the question is not "did he qualify today" but "did he qualify on
-- any single day", because §7 says the level stays open once opened. The per-day shape of
-- `progress` is what makes "in a single day" expressible at all — scores are never summed
-- across dates, so ૪૦ on Monday and ૪૦ on Tuesday is not ૮૦.
--
-- SECURITY DEFINER because the callers below run in contexts where the caller's own RLS
-- view of `progress` is the wrong lens: the profiles guard has to answer this while a
-- સંચાલક is updating someone else's row, and a trigger that answered "no" for lack of
-- read permission would silently strip a level the યુવક had earned.
create or replace function public.has_earned_level4(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.progress
    where user_id = uid
      and level3_score >= public.level4_unlock_threshold()
  );
$$;

-- Not granted to `authenticated`, and that is the point of writing the revoke out.
--
-- It takes any uuid and answers about that person, and it is SECURITY DEFINER, so an
-- execute grant would be a way to ask "has *this other* યુવક unlocked લેવલ ૪?" — a question
-- the profiles RLS policy refuses (§13: a યુવક reads only his own data). The only callers
-- that need it are the triggers below, which run as the owner and so do not need a grant.
revoke all on function public.has_earned_level4(uuid) from public;

-- The threshold itself is public knowledge — the home page prints it to every યુવક — so
-- the app may ask the database for it rather than trusting only its own copy.
grant execute on function public.level4_unlock_threshold() to authenticated;

-- ================================================================ the unlock

-- Fires on the row that records the day's score, and does one thing: opens the level.
--
-- Three properties are load-bearing, and each is enforced by a specific line rather than
-- by care:
--
--   * **monotonic.** The statement is `set level4_unlocked = true`. There is no branch in
--     this function that writes false, so no sequence of progress writes — a corrected
--     score, a lower score the next day, the midnight reset clearing the ticks — can take
--     the level away. §7: "once opened it stays open forever".
--
--   * **લેવલ ૩ only.** The WHEN clause names `level3_score` and nothing else, and the
--     UPDATE trigger is `of level3_score`. A યુવક who ticks ૧૦૦ at લેવલ ૪ (which he can
--     only do once already unlocked) cannot re-derive his own unlock from it.
--
--   * **quiet when there is nothing to do.** `and not level4_unlocked` in the WHERE means
--     an already-unlocked યુવક's daily writes update zero rows — no profiles UPDATE, so
--     no `audit_profile` trigger, no `profiles_guard_immutable` pass, and no `updated_at`
--     churn on ~2,000 profile rows every evening.
--
-- SECURITY DEFINER: the profiles policy would in fact allow a યુવક to update his own row,
-- but not a સંચાલક-written or service-role-written progress row for someone else, and the
-- unlock must not depend on who happened to record the score.
create or replace function public.progress_unlock_level4()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set level4_unlocked = true
   where id = new.user_id
     and not level4_unlocked;

  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

comment on function public.progress_unlock_level4() is
  '§7 — opens લેવલ ૪ the moment a day''s લેવલ ૩ score reaches the threshold. Never closes it.';

drop trigger if exists progress_unlock_level4     on public.progress;
drop trigger if exists progress_unlock_level4_upd on public.progress;

-- Two separate trigger definitions rather than one `insert or update`, because the UPDATE
-- half carries `of level3_score`: a write that touches only `level4_score` should not even
-- evaluate the condition. (`of` fires on the column being *named* by the statement, not on
-- its value changing, so an upsert that sets both columns is still covered — the WHEN
-- clause is what decides.)
create trigger progress_unlock_level4
  after insert on public.progress
  for each row
  when (new.level3_score >= public.level4_unlock_threshold())
  execute function public.progress_unlock_level4();

create trigger progress_unlock_level4_upd
  after update of level3_score on public.progress
  for each row
  when (new.level3_score >= public.level4_unlock_threshold())
  execute function public.progress_unlock_level4();

-- ================================================================ the flag cannot lie

-- Everything above decides when the level opens. This decides that nothing else can.
--
-- Without it the flag is still exactly as forgeable as it was: the "own profile updatable"
-- policy lets a યુવક PATCH `level4_unlocked` to true directly, and — the case that would
-- actually bite — some future daily-reset job or a careless `update profiles set ...`
-- could set it back to false and take the level away from someone who earned it months
-- ago. So the column is guarded on both edges:
--
--   true → false   is refused always. §7 is unconditional about this.
--   false → true   is refused unless has_earned_level4() agrees.
--
-- It **corrects** rather than raising, and that is a product decision, not a shortcut.
-- This trigger sits on the same UPDATE path as `saveGateAnswers()` in src/lib/auth.jsx; an
-- exception here would fail an unrelated, legitimate write and reach the યુવક as a
-- Gujarati error message about something he did not do — §1 rule 4 (ફક્ત આનંદ, નિરાશા નહીં)
-- rules that out. The write succeeds, the flag stays true to the record, and nothing in
-- the UI ever accuses anybody.
--
-- It also means the સંચાલક panel cannot grant the level by hand, which is what
-- admin/src/features/levels/pages/LevelsPage.jsx already tells its reader: લેવલ ૪ is
-- earned per-યુવક and the panel decides only whether a level is *offered*.
create or replace function public.profiles_guard_level4()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.level4_unlocked and not new.level4_unlocked then
    -- Never re-lock. Includes the midnight reset (§9), which clears the day's ticks and
    -- must leave the level alone.
    new.level4_unlocked := true;
  elsif new.level4_unlocked and not old.level4_unlocked then
    -- Claimed, not recorded. The unlock is derived from `progress`, so a claim that the
    -- score does not support is simply not true yet.
    new.level4_unlocked := public.has_earned_level4(new.id);
  end if;

  return new;
end;
$$;

-- Named to sort after `profiles_guard_immutable`, which is not decorative: Postgres fires
-- BEFORE ROW triggers in name order, and the immutability guard is the one that must see
-- the row first (it is what stamps `updated_at`).
drop trigger if exists profiles_guard_level4 on public.profiles;

create trigger profiles_guard_level4
  before update on public.profiles
  for each row execute function public.profiles_guard_level4();

-- ================================================================ existing days

-- Every day already recorded is re-judged by the rule now that the rule exists.
--
-- `progress` is empty today — તબક્કો ૩ has not shipped — so this changes nothing on the
-- live project. It is here because a migration that only governs the future would quietly
-- disagree with its own comment the first time it is replayed onto a restored dump.
update public.profiles p
   set level4_unlocked = true
 where not p.level4_unlocked
   and public.has_earned_level4(p.id);

comment on column public.profiles.level4_unlocked is
  'Earned, never granted (§7): set by progress_unlock_level4() when a day''s level3_score '
  'reaches level4_unlock_threshold(), and held true by profiles_guard_level4(). No client '
  'write to this column has any effect.';
