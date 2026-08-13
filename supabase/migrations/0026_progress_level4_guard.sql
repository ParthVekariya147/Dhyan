-- વર્ણી ધ્યાન — a second tab may not un-do લેવલ ૪.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `public.progress` has two writers with two different ideas of who owns `level4_score`.
--
-- The server writes it in `level4_submit()`, counted from the day's attempts and merged with
-- `greatest(...)` so it can only rise (0017 step 9, kept by 0025).
--
-- The browser writes it too. `src/lib/progress.js` upserts the whole row —
-- `(user_id, date, level3_score, level4_score, updated_at)` — through PostgREST with
-- `Prefer: resolution=merge-duplicates`, which is an UPDATE of every column in the payload.
-- The `level4_score` in that payload is `scoreOf(day.l4, baseline.l4)`, and both halves of it
-- are stale by construction:
--
--   * `day.l4` is the set of લેવલ ૪ ticks made **in this tab**, and since લેવલ ૪ became
--     કસોટીઓ answered through `level4_submit()` nothing calls `toggle(4, …)` at all. It is
--     always empty.
--   * `baseline.l4` is read from `progress` **once, when the hook mounts**, and deliberately
--     never re-read (see scoreOf()'s note on latching the floor).
--
-- So the value the browser sends is whatever લેવલ ૪ stood at when that tab was opened. The
-- sequence in the audit is ordinary and costs a યુવક his afternoon:
--
--     09:00  tab A opens લેવલ ૩            baseline.l4 := 0
--     10:00  tab B passes ૪.૨              progress.level4_score := 40   (server)
--     10:05  tab A ticks one દ્રશ્ય, flushes  upsert level4_score = 0     ← 40 is gone
--
-- The same shape reaches the same end without two tabs: one tab left open across a લેવલ ૪
-- sitting on the phone, or a flush from a tab that was open before the attempt. The `greatest`
-- inside `level4_submit()` does not help — it guards that function's own write, and this write
-- does not go through that function.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ════════════════════════════════════════════════════════════════════════════
--
-- `level4_score` becomes server-owned at the table, not by convention.
--
-- The column is a count of the distinct દ્રશ્યો ticked across the day's `level4_attempts`
-- (0017 step 9). Attempts are only ever inserted, never deleted, so that count is
-- **monotonically non-decreasing within an IST day** — which means pinning the column to
-- `greatest(new, old)` cannot discard a legitimate value. There is no writer anywhere in this
-- repository, client or server, whose correct behaviour is to lower it.
--
-- A trigger and not an RLS policy, for the reason 0017_profiles_guard_status.sql gives about
-- `profiles.status`: a policy sees the new row and not the old one, so it cannot express
-- "not lower than what is there", and a policy does not apply to service_role while a trigger
-- does.
--
-- Pinned rather than raised, also for that migration's reason. The flush in `progress.js` is
-- an ordinary લેવલ ૩ save carrying a column it should not have carried; raising would fail
-- that save, lose the લેવલ ૩ ticks it was actually about, and reach the યુવક as a Gujarati
-- error about something he did not do. Pinning lets the write land, keeps the લેવલ ૩ score it
-- came for, and simply refuses the part that was stale.
--
-- `src/lib/progress.js` stops sending the column in the same change, which is the real
-- correction — this trigger is what makes it a guarantee rather than a convention, and what
-- protects the યુવક running a bundle he cached before the fix.
--
-- ── What is deliberately NOT changed ────────────────────────────────────────
--
-- `level3_score` keeps its present behaviour and may still be lowered. That is not an
-- oversight. લેવલ ૩ ticks are the યુવક's own and un-ticking a mis-tick has to work; the same
-- `greatest` applied there would make a wrong tick permanent. The consequence is that two
-- tabs ticking લેવલ ૩ on the same day can still lose the smaller write — see REMAINING RISKS
-- in the audit report. It is a narrower window than the લેવલ ૪ one this migration closes
-- (both tabs must be ticking લેવલ ૩, on the same day, on the same account) and it cannot be
-- fixed by a rule about the column, because the correct value genuinely depends on which
-- writer is right.

create or replace function public.progress_guard_level4_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Not `is distinct from` and then an assignment: `greatest` is the whole rule, and it is a
  -- no-op in the ordinary case where the two agree.
  new.level4_score := greatest(coalesce(new.level4_score, 0), coalesce(old.level4_score, 0));
  return new;
end;
$$;

comment on function public.progress_guard_level4_score() is
  'Holds progress.level4_score to the highest value it has reached today. The column is '
  'server-owned — level4_submit() counts it from the day''s attempts — but src/lib/progress.js '
  'upserts the whole row and would otherwise write back the value its tab loaded with (0026). '
  'Pins rather than raises, so the લેવલ ૩ save it rides on still lands.';

-- BEFORE UPDATE only. An INSERT has no previous value to protect, and the first row of the
-- day is written by whichever of the two writers gets there first with the value it holds.
--
-- Named to sort after nothing in particular: `progress` has no other BEFORE ROW trigger, so
-- there is no ordering to preserve. If one is added later, note that this one only reads and
-- writes its own column.
drop trigger if exists progress_guard_level4_score on public.progress;

create trigger progress_guard_level4_score
  before update on public.progress
  for each row execute function public.progress_guard_level4_score();

comment on column public.progress.level4_score is
  'How many દ્રશ્યો this યુવક ticked across today''s લેવલ ૪ attempts. Server-owned: written by '
  'level4_submit() and held against lowering by progress_guard_level4_score() (0026). A client '
  'that includes it in a progress upsert cannot move it down.';
