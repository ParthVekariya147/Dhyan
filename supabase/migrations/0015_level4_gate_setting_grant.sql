-- વર્ણી ધ્યાન — the grant 0014 should have carried.
--
-- What is broken without this
-- ---------------------------
-- 0014 rebuilt `public.profiles_level4` to read the gate from `level4_gate_setting()`, and
-- revoked that function from `public` without granting it to `authenticated` — the pattern
-- every other helper in 0010 follows, and the wrong one here.
--
-- The other helpers are only ever called from inside SECURITY DEFINER functions, where
-- permission checks run as the function's owner and no grant is needed. `profiles_level4` is
-- not that: it is `security_invoker = on`, so it runs with the privileges of whoever is
-- selecting from it. And a function's EXECUTE privilege is checked against the **invoking**
-- user in either case — `GetUserId()` does not change when a query passes through a view,
-- invoker or not. Only SECURITY DEFINER changes it.
--
-- So every select from the view raised:
--
--   permission denied for function level4_gate_setting
--
-- which is the સંચાલક's Users list and the dashboard — the two things 0011 built the view for.
--
-- This is the same trap 0011 named and stepped around. Its comment explains that it inlines
-- `level4_gate_open(uuid, uuid)` rather than calling it, because "a security_invoker view
-- calling it would need that grant". 0014 inlined the *predicate* faithfully and then called
-- a function for the *setting*, which walks into the same wall one layer down.
--
-- Why a grant, and not more inlining
-- ----------------------------------
-- The alternative is to inline the settings read into the view as well — a `select value ->
-- 'level4Gate' from public.settings where key = 'levels'` with the jsonb defaulting written
-- out a second time. That is the option 0011 took for its predicate, and it was right there
-- because the thing being inlined was three lines that read `progress`.
--
-- Here it is wrong. The defaulting is not three lines: it is a nested CASE, a `jsonb_typeof`
-- guard that exists because Postgres does not promise left-to-right AND, and two fallbacks
-- whose direction is a decision (absent `require` means required; a bad threshold means ૮૦,
-- never 0). Copying that into the view would put the rule in two places where it is already
-- in two languages, and a copy that drifts *is* the bug 0011 and 0014 both exist to remove.
--
-- Granting costs nothing that is not already given away. `level4_gate_setting()` takes no
-- argument, touches no personal row, and returns two scalars of configuration: whether the
-- gate is on, and the number. A યુવક can already read `public.settings` — src/lib/useSettings.js
-- reads the 'app' row on every visit through the same RLS policy that covers 'levels' — so
-- this exposes nothing he could not select for himself, in a shape he cannot misread.
--
-- What it deliberately does NOT grant
-- ----------------------------------
-- `level4_gate_open(uuid)` and `level4_gate_open(uuid, uuid)` stay revoked. They take a uuid
-- and answer about *that person*, so a grant would let one યુવક ask whether another has
-- reached લેવલ ૪ — §13, and the same reasoning 0008 applies to `has_earned_level4()`. The
-- view does not need them: it inlines the predicate, which is precisely why 0011 wrote it
-- that way.
grant execute on function public.level4_gate_setting() to authenticated;

comment on function public.level4_gate_setting() is
  'What opens લેવલ ૪, from settings[''levels''].value.level4Gate — the single answer since '
  '0014. Mirrors resolveLevel4Gate() in shared/domain/settings.js, including how each '
  'malformed value falls. EXECUTE is granted to authenticated (0015) because '
  'profiles_level4 is a security_invoker view and calls it; it returns configuration only, '
  'never a fact about a person. level4_configs.require_gate/gate_threshold are not read.';
