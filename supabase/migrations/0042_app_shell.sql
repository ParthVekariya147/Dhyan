-- વર્ણી ધ્યાન — the icon on the home screen, and how long a session lasts, both become the
-- સંચાલક's.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY THESE TWO ARE ONE MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- They are the same problem seen from two ends, and neither is any use without the other.
--
-- Everyone has installed the app to their home screen. An installed PWA is opened and closed
-- for weeks without ever being loaded: the service worker serves the precached shell, the
-- document survives in the background, and a phone that installed in June is still running
-- June's JavaScript in August. So:
--
--   * `appIcon` lets him change the mark - but a phone that never loads never learns of it.
--   * `session` gives a session a maximum age, after which the next time the app is brought
--     to the foreground it ends the session and loads itself again from the network.
--
-- The second is what delivers the first. Shipping the icon setting alone would produce a
-- panel that reports "Saved" while two thousand home screens keep the old mark for months,
-- which is worse than not having the setting at all - it would be a control that appears to
-- work.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHAT IS AND IS NOT REACHABLE, STATED HERE BECAUSE IT IS A PLATFORM LIMIT
-- ════════════════════════════════════════════════════════════════════════════
--
--   * A browser tab, and anyone not installed - next load.
--   * Any new install, any platform - immediately; the manifest is read at install time and
--     netlify/functions/manifest.js serves this row.
--   * Android, already installed - on its own within a day or two. Chrome re-fetches the
--     manifest roughly daily and mints an updated WebAPK when the icon differs. This is the
--     whole reason the manifest is served by a function instead of the static file
--     vite-plugin-pwa builds: a static manifest can never differ from itself.
--   * iPhone, already installed - NEVER, by any means. iOS copies apple-touch-icon into
--     SpringBoard at "Add to Home Screen" and never reads the page again. Remove and re-add
--     is the only route, which is why `version` below is a counter the app compares against
--     what the phone last saw, so the notice can be shown once per icon and not on every open.
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE SHAPE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Two fields in the existing settings['app'] row - no new table and no new key, so both ride
-- along on a read the યુવક app already performs on every visit (0007 makes the same argument
-- for the two ધૂન, and the mobile-data reasoning behind it is unchanged).
--
--   "appIcon": { "url": "https://…/app-icon/icon-1723…png", "path": "icon-1723….png",
--                "size": 41233, "version": 3, "updatedAt": "2026-08-15T…Z" }
--   "session": { "enabled": false, "hours": 24 }
--
-- Mirrors shared/domain/appicon.js and shared/domain/session.js field for field. The rules
-- below are the same rules those two modules' validators apply, for the reason 0018 gives:
-- `settings` is writable through PostgREST by anyone has_permission('settings.update') admits,
-- without going near admin/src.

-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE
-- ════════════════════════════════════════════════════════════════════════════

-- The third bucket, after `darshan` (0005) and `dhun` (0007).
--
-- `public => true` for the same reason those two are, and here it is not merely a preference:
-- the icon URL is fetched by Google's WebAPK minter, which runs on Google's servers with no
-- Supabase session of any kind. A signed URL would be unfetchable by the one consumer that
-- matters most for an already-installed Android phone, and the icon would silently never
-- update. There is nothing to protect - it is the mark the app shows the world.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-icon',
  'app-icon',
  true,
  524288, -- 512 KB. A 512x512 PNG of a flat mark is 20-60 KB, so this is generous on purpose:
          -- it refuses a photograph dropped in by mistake without making anybody think about
          -- bytes. APP_ICON_MAX_BYTES in shared/domain/appicon.js is the same number, checked
          -- in the panel first so he is told before the upload starts rather than after.
  array['image/png'] -- PNG only, and deliberately. SVG is refused because Android's WebAPK
                     -- minter and iOS's home-screen path both want a raster. JPEG is refused
                     -- because an app icon needs transparency and a JPEG cannot carry it - a
                     -- mark on a white square, on every phone, permanently. WebP is refused
                     -- because Safari's home-screen path has not reliably accepted it, and
                     -- iOS is the one platform that can never be corrected after the fact.
)
on conflict (id) do nothing;

-- Who may write. Identical in shape and in reasoning to the `dhun` policies in 0007: an
-- upload starts as a file on the સંચાલક's laptop, so there is no link to hand to a server and
-- relaying the bytes through a Netlify Function purely to have the secret key sign the PUT
-- would be more moving parts for an image that changes once a year.
--
-- Scoped as narrowly as the RBAC model can express: `has_permission('settings.update')`, held
-- by SUPER_ADMIN and ADMIN only. Every one of the ~2,000 signed-in યુવકો holds no such
-- permission and cannot put a byte in this bucket. The same predicate guards the settings row
-- itself (0004:649), so the person who may *choose* an icon is exactly the person who may
-- *upload* one; they cannot drift apart.
--
-- `to authenticated` on every policy, not `to public`: an anonymous request should not even
-- reach the has_permission() call.

drop policy if exists "app icon uploadable by settings admins" on storage.objects;
create policy "app icon uploadable by settings admins" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-icon' and public.has_permission('settings.update'));

-- The panel names each object with a fresh version and never overwrites, so this is not on the
-- normal path. It exists so that a retry after a half-failed upload is a retry and not a
-- permanent "The resource already exists".
drop policy if exists "app icon replaceable by settings admins" on storage.objects;
create policy "app icon replaceable by settings admins" on storage.objects
  for update to authenticated
  using (bucket_id = 'app-icon' and public.has_permission('settings.update'))
  with check (bucket_id = 'app-icon' and public.has_permission('settings.update'));

-- Choosing a new icon uploads the new object and then deletes the old one, so the bucket holds
-- the icon in force rather than a tail of every mark ever tried.
drop policy if exists "app icon removable by settings admins" on storage.objects;
create policy "app icon removable by settings admins" on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-icon' and public.has_permission('settings.update'));

-- Deliberately no SELECT policy, exactly as with `darshan` and `dhun`: `public => true` is what
-- makes the /object/public/app-icon/… URL readable and it bypasses RLS by design. A select
-- policy here would be dead code that reads like a security control.

-- ════════════════════════════════════════════════════════════════════════════
-- THE GUARDS
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------- the icon
--
-- Mirrors validateAppIcon() in shared/domain/appicon.js. Every branch below is a rule that
-- module states in JavaScript; this is the same rule where PostgREST cannot go around it.
--
-- **SECURITY INVOKER, and that is now a decision rather than a default.** 0041 documents what
-- happens when a settings guard calls a function no client role may execute: the trigger fires
-- as the caller, the call is denied, and every write of that key fails with 42501 for
-- everybody including a SUPER_ADMIN. This function therefore calls nothing at all - it reads
-- NEW and raises - which is what makes invoker safe here. scripts/test-nav-grants.mjs §F asks
-- that question of every trigger in the schema, so this claim is checked rather than asserted.
create or replace function public.settings_check_app_icon()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v      jsonb;
  u      text;
  n      numeric;
begin
  -- Only `key = 'app'`, and only when `appIcon` is actually present in the incoming value.
  -- `?` tests for the key rather than for a non-null value, so `{"appIcon": null}` is caught
  -- as the malformed write it is instead of slipping through as "absent" (0019 makes the same
  -- distinction and for the same reason).
  if new.key <> 'app' or not (new.value ? 'appIcon') then
    return new;
  end if;

  v := new.value -> 'appIcon';

  /*
    JSON null is the documented way to clear the icon, and it is NOT an error.

    A સંચાલક pressing "Use the built-in icon" writes null here; resolveAppIcon() maps it to the
    four files the build ships. Refusing it would leave him able to set a custom icon and never
    able to take it back, which is the shape of trap this project's §31 exists to forbid.
  */
  if jsonb_typeof(v) = 'null' then
    return new;
  end if;

  if jsonb_typeof(v) <> 'object' then
    raise exception 'settings.app: appIcon must be an object, or null to use the built-in icon'
      using errcode = 'check_violation';
  end if;

  u := v ->> 'url';
  if u is null or btrim(u) = '' then
    raise exception 'settings.app: appIcon needs a url'
      using errcode = 'check_violation';
  end if;

  /*
    https only, and this is the rule most worth enforcing in the database.

    An http: icon on an https page is blocked as mixed content by every browser - the manifest
    entry is dropped and Chrome treats the installed app as having no icon at all. A data: or
    blob: URL fails differently and worse: Google's WebAPK minter fetches the icon from its own
    servers, so a URL that only means something inside one phone's browser resolves to nothing.
    Both produce a home screen with a blank square on it and nothing anywhere saying why.
  */
  if u !~* '^https://' then
    raise exception 'settings.app: the appIcon url must start with https://'
      using errcode = 'check_violation';
  end if;

  n := case when jsonb_typeof(v -> 'size') = 'number' then (v ->> 'size')::numeric end;
  if n is not null and n > 524288 then
    raise exception 'settings.app: the app icon must be 512 KB or smaller'
      using errcode = 'check_violation';
  end if;

  /*
    The version counter, and the reason it is required rather than optional.

    It is what the phone compares against to decide whether it has already shown the iPhone
    reinstall notice for this icon, and it is what makes the URL new enough for Chrome's
    updater to re-fetch (Supabase serves public objects with an hour of cache). A row written
    without one - by a script, or by a hand-edited jsonb - would produce an icon that changes
    in the database and nowhere else, which is the exact failure this whole migration exists
    to prevent. So it is refused here rather than defaulted.
  */
  n := case when jsonb_typeof(v -> 'version') = 'number' then (v ->> 'version')::numeric end;
  if n is null or n < 1 or n <> floor(n) then
    raise exception 'settings.app: appIcon needs a whole version number of 1 or more'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_app_icon() from public;

drop trigger if exists settings_check_app_icon on public.settings;

-- BEFORE, so a refused write never reaches the row and never reaches `audit_setting` either,
-- which would otherwise file an entry for a change that did not happen. It sits alongside
-- settings_check_slideshow (0018) and the rest rather than replacing any of them; they examine
-- different keys and all of them run.
create trigger settings_check_app_icon
  before insert or update on public.settings
  for each row execute function public.settings_check_app_icon();

comment on function public.settings_check_app_icon() is
  'Refuses a settings[''app''].value.appIcon write that shared/domain/appicon.js '
  'validateAppIcon() would refuse (0042): an https url, 512 KB or less, and a whole version '
  'number of 1 or more. JSON null is accepted and means "use the built-in icon". Calls no '
  'other function, deliberately - see 0041 for what happens to a settings guard that does.';

-- ---------------------------------------------------------------- the session
--
-- Mirrors validateSessionPolicy() in shared/domain/session.js.
create or replace function public.settings_check_session()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v jsonb;
  n numeric;
begin
  if new.key <> 'app' or not (new.value ? 'session') then
    return new;
  end if;

  v := new.value -> 'session';

  if jsonb_typeof(v) = 'null' then
    return new;
  end if;

  if jsonb_typeof(v) <> 'object' then
    raise exception 'settings.app: session must be an object'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'enabled') <> 'boolean' then
    raise exception 'settings.app: session.enabled must be true or false'
      using errcode = 'check_violation';
  end if;

  /*
    The hours are validated even when the policy is switched off.

    A row holding 0 or 100000 with `enabled: false` looks harmless and is not: it is a value
    that comes into force the instant somebody flips the switch, from a screen that will show
    him the number he is enabling but not tell him it is out of range. The panel's field and
    this bound refuse the same numbers at the same moment.
  */
  n := case when jsonb_typeof(v -> 'hours') = 'number' then (v ->> 'hours')::numeric end;
  if n is null or n <> floor(n) then
    raise exception 'settings.app: session.hours must be a whole number of hours'
      using errcode = 'check_violation';
  end if;

  /*
    1 to 720, and both ends are meant.

    The floor is 1 and not 0 because zero is not a short session, it is a login screen that
    reappears on every foreground - indistinguishable from a broken app, reachable by mistyping,
    and felt by two thousand people at once. The ceiling is 720 hours (thirty days) because past
    a month the setting has stopped meaning anything, and because it bounds the mistake: a
    mistyped 99999 is refused here rather than quietly becoming "never".
  */
  if n < 1 or n > 720 then
    raise exception 'settings.app: session.hours must be between 1 and 720 (thirty days)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_session() from public;

drop trigger if exists settings_check_session on public.settings;

create trigger settings_check_session
  before insert or update on public.settings
  for each row execute function public.settings_check_session();

comment on function public.settings_check_session() is
  'Refuses a settings[''app''].value.session write that shared/domain/session.js '
  'validateSessionPolicy() would refuse (0042): enabled as a boolean, and hours as a whole '
  'number between 1 and 720. The hours are checked even when enabled is false, because that '
  'is the value that comes into force the moment somebody flips the switch.';

-- ================================================================ notes for the next reader
--
-- **Nothing here reads the row.** No RPC and no view is added, deliberately. Both fields are
-- consumed by three readers that all already have the row in hand: src/lib/useSettings.js,
-- which fetches settings['app'] on every visit; the panel, through settingsService.js; and
-- netlify/functions/manifest.js, which reads it with the secret key because `settings` is
-- readable by `authenticated` only (0001:245) and Chrome's manifest fetch carries no session.
-- A `settings_app_icon()` RPC would be a fourth answer to a question three callers can already
-- answer from data they are holding.
--
-- **The audit trail needs nothing either.** The auditable act is the સંચાલક choosing an icon or
-- a session length, and that is the settings['app'] write, already caught by the audit_settings
-- trigger (0004:460) which stores the whole before/after value. The storage PUT a moment
-- earlier is how the bytes got there, not a second decision by a person - 0005 and 0007 make
-- the same argument.
--
-- **Both guards are SECURITY INVOKER and both call nothing.** That is the property 0041 was
-- written about and it is checked rather than claimed: scripts/test-nav-grants.mjs §F walks
-- pg_trigger and requires that no invoker trigger function anywhere in the schema names a
-- function `authenticated` may not execute. A future edit that makes either of these call a
-- helper turns that test red on the same day rather than producing a 403 nobody can explain.
