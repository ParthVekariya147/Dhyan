-- વર્ણી ધ્યાન — the app's mark, readable before anybody signs in.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE BUG THIS FIXES
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0042 made the icon a setting, and src/lib/useAppShell.js rewrites `<link rel="icon">` from
-- it on every load. src/App.jsx mounts that hook ABOVE <AuthProvider>, and its comment says
-- exactly why: inside the shell "the tab icon would never be corrected on લોગિન, which is the
-- first screen most visitors ever see".
--
-- It never was corrected there, because of one word in 0001:
--
--   create policy "settings readable by signed-in" on public.settings
--     for select to authenticated using (true);
--
-- `to authenticated`. A visitor on /login is `anon`, the read returns nothing, resolveAppIcon()
-- reads that as "no custom icon" — correctly, since it cannot tell a forbidden read from an
-- empty one — and the tab keeps the built-in mark. And because the row is memoised at module
-- scope for the life of the document, signing in does not correct it either: only a full page
-- load made while already signed in ever shows the સંચાલક's icon.
--
-- So the setting worked, the panel worked, the storage bucket worked, and the one surface a
-- યુવક actually looks at showed the old mark with nothing anywhere reporting a failure.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY A FUNCTION AND NOT A POLICY
-- ════════════════════════════════════════════════════════════════════════════
--
-- The obvious fix is to let `anon` select from `settings`. It is refused here, and not out of
-- caution: `settings['app']` is one jsonb row that also carries the ધૂન URLs, the slideshow
-- interval and — since 0042 — the session policy, which is operational configuration about how
-- long a યુવક stays signed in. None of that is secret, and none of it is any of an anonymous
-- visitor's business either. More to the point, `settings` is the row every future setting will
-- be added to, so a policy opening it to `anon` today is a policy that silently publishes
-- whatever is put there next year, decided by nobody.
--
-- This returns ONE field instead, and that field is already public by every other route: the
-- bytes sit in a `public => true` bucket (0042), and netlify/functions/manifest.js serves the
-- same URL to Google's WebAPK minter with no session at all. Publishing it here adds no
-- exposure that the manifest has not had since the day it was written.
--
-- SECURITY DEFINER because the caller is `anon` and the point is to read past the policy above.
-- `stable` because it reads and does not write; `set search_path = public` so the body cannot
-- be redirected by a caller's search_path, which is the standard trap with definer functions.
create or replace function public.app_icon()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value -> 'appIcon' from public.settings where key = 'app';
$$;

-- `revoke from public` first, then grant deliberately. A definer function is executable by
-- PUBLIC the moment it is created, and PUBLIC includes roles that have nothing to do with this
-- application; naming the two client roles is the difference between a decision and a default.
revoke all on function public.app_icon() from public;
grant execute on function public.app_icon() to anon, authenticated;

comment on function public.app_icon() is
  'settings[''app''].value.appIcon, and nothing else in that row (0047). SECURITY DEFINER and '
  'executable by anon, so the tab icon and the install sheet show the સંચાલક''s mark on લોગિન '
  'and નોંધણી, where there is no session and the settings policy in 0001 refuses the read. '
  'Returns null when no icon has been chosen, which resolveAppIcon() reads as the built-in mark.';

-- ================================================================ notes for the next reader
--
-- **Nothing else moves to this function.** useSessionExpiry() goes on reading the settings row
-- through the ordinary policy, and that is correct rather than an oversight: a session policy
-- only means anything once there IS a session, so the one caller that needs it is always
-- authenticated by the time it asks.
--
-- **It returns the raw jsonb, not a resolved shape.** resolveAppIcon() in
-- shared/domain/appicon.js is the single place that decides what a damaged or absent value
-- means, and it is shared by the app, the panel and the manifest function. A second opinion
-- expressed in SQL is exactly the drift that file's header warns about.
