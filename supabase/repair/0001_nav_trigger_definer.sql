-- વર્ણી ધ્યાન - repair follow-up to 0000_revoke_blanket_grants.sql.
--
-- 0000 revoked EXECUTE on the nav helpers from anon and authenticated, which is right: no
-- client has any business calling nav_config_error() or nav_registry() as an RPC. But it also
-- broke every write to settings['nav'].
--
-- `settings_check_mobile_nav()` (0019:370) is the BEFORE trigger that validates the bar. It is
-- SECURITY INVOKER. Postgres does not check EXECUTE on a trigger function when the trigger
-- fires, so the trigger still runs - but its BODY runs as the caller, `authenticated`, and its
-- one statement calls public.nav_config_error(). After 0000 that call is denied, so a સંચાલક
-- saving the bottom bar gets
--
--   42501  permission denied for function nav_config_error
--
-- as a 403 from PostgREST, no matter what permissions the panel says he holds. The grant is on
-- the Postgres role, and every signed-in user is `authenticated`; being super admin is not
-- something the grant system can see.
--
-- Granting nav_config_error() back would undo 0000 and would not even be sufficient on its own:
-- the function calls nav_registry(), nav_routes(), nav_normalize_route() and nav_icons(), all
-- revoked by the same script. So the trigger becomes SECURITY DEFINER instead - the whole
-- validation runs as the function's owner, which owns the helpers, and the helpers stay closed
-- to clients.
--
-- Safe as a definer function: it reads NEW, calls one pure validator, and either returns NEW or
-- raises. It reads no table, writes nothing, and takes no argument from the caller other than
-- the row already being written. `search_path` is pinned by the function definition (0019:373),
-- which is the part that actually matters for a definer function.
--
-- Only the nav trigger needs this. settings_check_slideshow(), settings_check_points(),
-- settings_check_leaderboard() and settings_check_pace() are self-contained and call nothing
-- 0000 touched; the trigger functions that do call revoked helpers - level4_attempts_award(),
-- activity_attempts_level3_award(), audit_point_bonus_rule() - are already SECURITY DEFINER.

begin;

alter function public.settings_check_mobile_nav() security definer;

commit;

-- Verify:
--   select proname, prosecdef from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'settings_check_mobile_nav';
--   -- prosecdef must be t
