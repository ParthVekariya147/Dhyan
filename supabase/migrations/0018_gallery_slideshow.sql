-- વર્ણી ધ્યાન — the fullscreen દર્શન slideshow interval becomes a setting, with the bound
-- enforced where it cannot be walked around.
--
-- What this adds
-- --------------
-- `settings['app'].value.slideshow = {"seconds": <1..60>}` — how long લેવલ ૨'s fullscreen
-- viewer holds each દ્રશ્ય once a યુવક has started આપોઆપ himself. It was a constant in
-- src/modules/darshan/GalleryViewer.jsx (`AUTO_MS = 6000`); it is now the સંચાલક's, because
-- how long a દ્રશ્ય wants to be looked at is a judgement about યુવકો in a room and not a fact
-- about the code.
--
-- Why the bound is here and not only in the panel
-- -----------------------------------------------
-- The panel's field validates, and that validation is worth having — it is how a સંચાલક is
-- told the ceiling is 60 rather than left to discover it. But **a disabled control is not a
-- rule.** `settings` is writable by anyone `is_admin()` admits, through PostgREST, with no
-- obligation to go anywhere near admin/src: a curl with an ADMIN's token can put
-- `{"seconds": 0}` in this row, and every યુવક's phone would then run a slideshow with no
-- dwell at all — ૧૦૯ દ્રશ્યો flickering past — with nothing on any screen to say why.
--
-- So the range is a trigger on the table. Same reasoning as everywhere else in this schema:
-- the frontend check is the explanation, the database check is the guarantee.
--
-- What this does NOT change
-- -------------------------
-- * **Who may write.** Unchanged, and deliberately not widened: `settings writable by admin`
--   (0001) is still the only way in, and `audit_settings` (0004) still records the write.
--   This adds a constraint to an existing permission, it does not create a new one.
-- * **Who may read.** Unchanged. The row is already readable by `authenticated` because the
--   યુવક app reads it on every visit; the slideshow interval rides that existing request.
-- * **Any other key in the row.** The trigger looks at `slideshow` and nothing else. A write
--   that does not mention it is not examined, so nothing that saves today can start failing.
-- * **લેવલ ૨, ૩ or ૪.** Nothing here touches progress, scoring or unlocking. The gallery is a
--   viewing surface and records nothing at all.

-- ================================================================ the resolver

-- The interval as the settings row holds it right now.
--
-- Mirrors `resolveSlideshow()` in shared/domain/settings.js branch for branch, including
-- which way each malformed value falls: not-a-number → the default of 6, out of range →
-- clamped to the nearer bound, fractional → rounded. The trigger below means a value this
-- has to *correct* should never exist — but it is written to correct anyway, because a row
-- predating this migration can hold anything, and a function that raises inside a view is a
-- broken સંચાલક page rather than one wrong number.
--
-- `jsonb_typeof` before the cast is load-bearing, exactly as in `level4_gate_setting()`
-- (0014): `('"eight"'::jsonb ->> 'seconds')::numeric` raises. A string that happens to
-- contain digits is refused rather than coerced — the panel writes a JSON number, so a
-- string here means something else wrote it, and guessing at what it meant is how two
-- systems begin to disagree.
--
-- SECURITY DEFINER and revoked from public for the reason 0014 gives: it must answer
-- identically for every caller, and it returns one scalar about configuration and nothing
-- about any person.
create or replace function public.settings_slideshow_seconds()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select s.value -> 'slideshow' as v
    from public.settings s
    where s.key = 'app'
  )
  select coalesce(
    (
      -- Nested CASE, not `typeof = 'number' AND ...`: Postgres does not promise
      -- left-to-right evaluation of AND, so the cast in a second arm may run even when the
      -- first is false. An ordered CASE is the documented way to make a guard actually guard.
      select case
               when jsonb_typeof(v -> 'seconds') = 'number' then
                 least(60, greatest(1, round((v ->> 'seconds')::numeric)::integer))
             end
      from raw
    ),
    6
  );
$$;

revoke all on function public.settings_slideshow_seconds() from public;

comment on function public.settings_slideshow_seconds() is
  'The લેવલ ૨ fullscreen slideshow dwell in seconds, from settings[''app''].value.slideshow '
  '(0018). Mirrors resolveSlideshow() in shared/domain/settings.js, including how each '
  'malformed value falls. Defaults to 6 — the interval the viewer shipped with.';

-- ================================================================ the bound

-- Refuses what the resolver above would silently correct.
--
-- The same division of labour the shared module draws between `resolveSlideshow()` and
-- `validateSlideshow()`, and for the same reason: a stored row must always yield a running
-- slideshow, but a *write* that is out of range is a mistake and should be told so at the
-- moment it is made rather than quietly become something else.
--
-- Only `key = 'app'`, and only when `slideshow` is actually present in the incoming value.
-- `?` tests for the key rather than for a non-null value, so `{"slideshow": null}` is caught
-- as the malformed write it is instead of slipping through as "absent".
--
-- The messages name the bound. A constraint that says only "violates check constraint" is a
-- constraint the next person works around; `saveError()` in the panel surfaces this text.
create or replace function public.settings_check_slideshow()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v jsonb;
  n numeric;
begin
  if new.key <> 'app' or not (new.value ? 'slideshow') then
    return new;
  end if;

  v := new.value -> 'slideshow';

  if jsonb_typeof(v) <> 'object' then
    raise exception 'settings.slideshow must be an object like {"seconds": 8}'
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v -> 'seconds') <> 'number' then
    raise exception 'settings.slideshow.seconds must be a number of seconds'
      using errcode = 'check_violation';
  end if;

  n := (v ->> 'seconds')::numeric;

  -- Whole seconds only, matching validateSlideshow(). A fractional dwell is not a thing a
  -- સંચાલક means to ask for, and accepting 8.5 here while the resolver rounds it to 9 would
  -- put a number in the panel's field that is not the number any યુવક's phone is using.
  if n <> trunc(n) then
    raise exception 'settings.slideshow.seconds must be a whole number of seconds'
      using errcode = 'check_violation';
  end if;

  if n < 1 or n > 60 then
    raise exception 'settings.slideshow.seconds must be between 1 and 60 (got %)', n
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.settings_check_slideshow() from public;

drop trigger if exists settings_check_slideshow on public.settings;

-- BEFORE, so an out-of-range write never reaches the row — and never reaches
-- `audit_settings` either, which would otherwise file an entry for a change that was
-- rejected. Ordering between the two is by name at the same timing; this one is BEFORE and
-- the audit trigger is AFTER, so the question does not arise.
create trigger settings_check_slideshow
  before insert or update on public.settings
  for each row execute function public.settings_check_slideshow();

comment on function public.settings_check_slideshow() is
  'Enforces 1..60 whole seconds on settings[''app''].value.slideshow.seconds (0018). The '
  'panel validates the same rule for the message; this is the guarantee, because settings is '
  'writable through PostgREST by anyone is_admin() admits without going near admin/src.';
