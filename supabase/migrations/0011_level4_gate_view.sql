-- વર્ણી ધ્યાન — the સંચાલક panel asks the same લેવલ ૪ question the યુવક app asks.
--
-- What was wrong
-- --------------
-- `profiles.level4_unlocked` is set by 0008's AFTER trigger at a threshold that function
-- hard-codes: `level4_unlock_threshold()` returns 80, always. That was the whole rule when
-- it was written, and 0010 ended it — LEVEL4.md decision #3 moved the gate onto the
-- published configuration (`require_gate`, `gate_threshold`), which a સંચાલક may set to
-- ૭૫, to ૫૦, or turn off entirely.
--
-- So there are now two answers to "has this યુવક reached લેવલ ૪?" and they disagree
-- wherever the સંચાલક has moved the number. The યુવક app was corrected to read the real
-- gate; the panel was not, and it is the panel that is *reporting* on the change. With a
-- threshold of ૫૦, a યુવક at ૬૦ has લેવલ ૪ genuinely open in front of him and appears in
-- the Users list as "Not yet" — the dashboard contradicting the app, about a rule the
-- person reading the dashboard set himself.
--
-- Why a view, and not a column
-- ----------------------------
-- The obvious repair is a second boolean on `profiles`, maintained by a trigger like
-- 0008's. It cannot work: the threshold is configuration, so publishing a new value would
-- have to rewrite the flag on every one of ~2,000 rows, and a threshold that moves down
-- would have to re-derive rows the trigger never saw. A stored answer to a question whose
-- rule changes is a cache with no invalidation.
--
-- Derived on read, there is nothing to keep in step: the view asks the published
-- configuration what the threshold is *now* and `progress` whether this યુવક ever met it.
-- Publishing a new configuration changes every answer at once, which is the correct
-- behaviour and costs nothing.
--
-- It is a view rather than an RPC because the panel filters and counts on it —
-- `countUsers()` is a `head: true` exact count and the list pages with `.range()`. Those
-- are PostgREST doing the work in Postgres, and a function returning a set would drag
-- every row into the browser to filter it there (§15: the rows are never transferred).
--
-- Why not reuse `level4_gate_open(uuid, uuid)`
-- -------------------------------------------
-- 0010 defines exactly this predicate, and it is deliberately `revoke`d from `public` and
-- never granted to `authenticated`: it takes any uuid and answers about that person, so a
-- grant would let one યુવક ask about another (§13, the same reasoning 0008 applies to
-- `has_earned_level4`). A `security_invoker` view calling it would need that grant.
--
-- The predicate is therefore inlined below, which is duplication and is the lesser cost —
-- and the duplication is not silent: if the two ever disagree, the panel and the યુવક app
-- disagree, which is the visible symptom this migration exists to remove. Keep them in
-- step with 0010's `level4_gate_open`.

-- ================================================================ the view

-- `security_invoker = on` is the load-bearing option (PostgreSQL 15+, which Supabase is).
--
-- Without it a view runs with its *owner's* rights, and this one selects from `profiles`
-- and `progress` — every yuvak's row, for anybody permitted to select from the view. That
-- would be a hole straight through §13, opened by a reporting convenience. With it, the
-- underlying policies apply to whoever is asking, so this view can grant nobody anything
-- they could not already read:
--
--   * a યુવક selecting from it sees his own row and his own progress — his own true gate;
--   * a સંચાલક sees everyone's, because `has_permission('users.read')` and
--     `has_permission('progress.read')` already say so;
--   * every role that can open the Users section holds both permissions, so the column is
--     never silently false for a role that can see the rows around it. A role holding
--     `users.read` but not `progress.read` would read `false` for everyone — no such role
--     exists in `permissions_for()` today, and this comment is the note for the day one is
--     added.
--
-- `level4_configs` needs no such care: 0010's read policy is `has_permission('settings.read')
-- OR the config is PUBLISHED`, and this only ever reads the published one.
create or replace view public.profiles_level4
with (security_invoker = on) as
select
  p.*,
  -- The same three cases as `level4_gate_open()`, in the same order:
  --   no published configuration  -> false  (there is no લેવલ ૪ to have reached)
  --   the gate is switched off    -> true   (open to everyone, decision #3)
  --   otherwise                   -> did any single day reach the threshold
  --
  -- "any single day", not a sum: `progress`'s primary key is (user_id, date), so a row is
  -- a day, and ૪૦ on Monday with ૪૦ on Tuesday is not ૮૦. That is the same sentence 0008
  -- wrote about `has_earned_level4`, and it is still the rule.
  coalesce(
    (
      select (not c.require_gate)
          or exists (
               select 1
                 from public.progress g
                where g.user_id = p.id
                  and g.level3_score >= c.gate_threshold
             )
        from public.level4_configs c
       where c.status = 'PUBLISHED'
       -- `level4_one_published` (0010) is a partial unique index that already guarantees
       -- at most one such row. The limit is belt-and-braces so this view degrades to a
       -- wrong-but-single answer rather than a "more than one row returned" error if that
       -- index is ever dropped.
       limit 1
    ),
    false
  ) as level4_gate_open
from public.profiles p;

comment on view public.profiles_level4 is
  'profiles, plus the લેવલ ૪ gate as the published configuration defines it right now '
  '(0010). Read-only and derived — see level4_gate_open(). The panel reads this instead of '
  'profiles.level4_unlocked, which answers 0008''s fixed threshold of 80 and no longer '
  'matches the rule when a સંચાલક has changed it.';

-- No `insert`/`update`/`delete`. The panel is read-only over people (§19) and this view is
-- not the way that would change if it ever did — `profiles` is.
grant select on public.profiles_level4 to authenticated;

-- ================================================================ the old flag

-- Left exactly as it is, and still written by 0008's trigger.
--
-- It is not renamed and not dropped, for two reasons. It is the answer to a real question —
-- "did this યુવક ever reach ૮૦ in a day at લેવલ ૩?" — which is worth keeping whatever the
-- current gate is set to. And dropping a column that `src/lib/progress.js` reads on every
-- load, mid-flight, would break the running app for the sake of tidiness.
--
-- What changes is only who trusts it for what: nothing decides access from it any more.
comment on column public.profiles.level4_unlocked is
  'Earned, never granted (§7): set by progress_unlock_level4() when a day''s level3_score '
  'reaches level4_unlock_threshold() — a FIXED 80. Since 0010 this is no longer the લેવલ ૪ '
  'gate; the gate is require_gate/gate_threshold on the published configuration, exposed as '
  'profiles_level4.level4_gate_open. This column remains a true record of the 80 rule and '
  'is what src/lib/progress.js reads to decide when to re-read the profile.';
