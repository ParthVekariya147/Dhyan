-- વર્ણી ધ્યાન - emergency grant repair.
--
-- Production answers the PUBLIC BROWSER KEY on functions that no migration ever granted to
-- any client role - verified live on point_rules(), point_rule_live(), point_value_for() and
-- point_settings(), each of which carries 'revoke all ... from public' and no grant. Something
-- outside these migrations issued a blanket grant, most likely
--   grant execute on all functions in schema public to anon, authenticated;
--
-- The list below is GENERATED from the migrations' own stated intent: every function that a
-- migration revoked from public and never granted to a client role. It includes award_points()
-- and point_award(), the two writers that create ledger rows - reachable from the browser they
-- would let anybody award any number of ગુણ to any યુવક.
--
-- Safe to run: it touches only functions the schema already says no client may call. Every RPC
-- the app and the panel actually use keeps its explicit grant.

begin;
revoke execute on function public.activity_attempts_level3_award()  from anon, authenticated;
revoke execute on function public.audit_point_bonus_rule() from anon, authenticated;
revoke execute on function public.award_points(uuid, date, integer, text, text, bigint, integer) from anon, authenticated;
revoke execute on function public.daily_activity_progress_recount(uuid, date, integer, text) from anon, authenticated;
revoke execute on function public.daily_record_config_guard() from anon, authenticated;
revoke execute on function public.daily_record_counts_guard() from anon, authenticated;
revoke execute on function public.daily_record_guard() from anon, authenticated;
revoke execute on function public.daily_record_points(uuid, integer, text, integer, date) from anon, authenticated;
revoke execute on function public.daily_record_recorded(uuid, date, integer, text, boolean) from anon, authenticated;
revoke execute on function public.daily_record_seal(uuid) from anon, authenticated;
revoke execute on function public.daily_record_snapshot(uuid, date) from anon, authenticated;
revoke execute on function public.has_earned_level4(uuid) from anon, authenticated;
revoke execute on function public.leaderboard_settings() from anon, authenticated;
revoke execute on function public.level3_commit(uuid, date, uuid) from anon, authenticated;
revoke execute on function public.level3_snapshot(uuid) from anon, authenticated;
revoke execute on function public.level4_activity_states(uuid, uuid) from anon, authenticated;
revoke execute on function public.level4_attempts_award() from anon, authenticated;
revoke execute on function public.level4_completed_activity_ids(uuid, uuid) from anon, authenticated;
revoke execute on function public.level4_covered_scene_ids(uuid) from anon, authenticated;
revoke execute on function public.level4_effective_items(uuid) from anon, authenticated;
revoke execute on function public.level4_gate_open(uuid) from anon, authenticated;
revoke execute on function public.level4_gate_open(uuid, uuid) from anon, authenticated;
revoke execute on function public.level4_replay(public.level4_attempts) from anon, authenticated;
revoke execute on function public.level4_required_count(uuid) from anon, authenticated;
revoke execute on function public.nav_config_error(jsonb) from anon, authenticated;
revoke execute on function public.nav_config_known(jsonb) from anon, authenticated;
revoke execute on function public.nav_icons() from anon, authenticated;
revoke execute on function public.nav_normalize_route(text) from anon, authenticated;
revoke execute on function public.nav_registry() from anon, authenticated;
revoke execute on function public.nav_routes() from anon, authenticated;
revoke execute on function public.point_award(uuid, date, integer, text, integer, text, text, bigint, integer, text, text, uuid) from anon, authenticated;
revoke execute on function public.point_bonus_apply(uuid, date, integer, text, text, bigint, integer)  from anon, authenticated;
revoke execute on function public.point_bonus_count(uuid, text, integer, text) from anon, authenticated;
revoke execute on function public.point_bonus_rules_touch() from anon, authenticated;
revoke execute on function public.point_config_document(integer) from anon, authenticated;
revoke execute on function public.point_config_snapshot() from anon, authenticated;
revoke execute on function public.point_rule_live(integer, text, date) from anon, authenticated;
revoke execute on function public.point_rules() from anon, authenticated;
revoke execute on function public.point_settings() from anon, authenticated;
revoke execute on function public.point_value_for(integer, text) from anon, authenticated;
revoke execute on function public.settings_check_leaderboard() from anon, authenticated;
revoke execute on function public.settings_check_mobile_nav() from anon, authenticated;
revoke execute on function public.settings_check_pace()  from anon, authenticated;
revoke execute on function public.settings_check_points() from anon, authenticated;
revoke execute on function public.settings_check_slideshow() from anon, authenticated;
revoke execute on function public.settings_mobile_nav() from anon, authenticated;
revoke execute on function public.settings_slideshow_seconds() from anon, authenticated;
commit;
