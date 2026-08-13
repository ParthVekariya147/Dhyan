-- વર્ણી ધ્યાન — SMK is no longer asked for at નોંધણી.
--
-- What changes, and why
-- --------------------
-- §4 listed SMK as the first field on the registration form and 0001_init.sql:21 made the
-- column `not null`. In practice a યુવક standing in front of the form very often does not
-- know his SMK — it is on a card he does not carry — and a required field he cannot answer
-- is a wall in front of the one screen the app cannot afford a wall in front of (§4: the
-- front door). The form now asks for નામ, મોબાઈલ, ઈમેલ, પાસવર્ડ, ઝોન and સબઝોન, and the
-- column becomes optional.
--
-- Only NOT NULL is dropped. Everything else about the column stays exactly as it was:
--
--   * UNIQUE stays. Postgres does not count NULLs as equal, so any number of profiles may
--     have no SMK while two profiles still cannot claim the same one.
--   * The CHECK stays. `null ~ '...'` evaluates to NULL, and a CHECK only fails on FALSE,
--     so a missing SMK passes it and a present one is still forced to PGV881 shape.
--   * Nothing that reads it changes: the panel already renders `u.smk || '-'` (UsersPage,
--     UserDetailPage, ProgressPage) and the exports already write '' for a missing value.
--     The leaderboard never carried it at all (0023).
--
-- The immutability guard is relaxed in exactly one direction
-- ----------------------------------------------------------
-- `profiles_guard_immutable()` (0001) raised on ANY change to `smk`. With the column
-- optional that rule turns into a trap: every profile registered from today has NULL there,
-- and the trigger — which applies to service_role too — would refuse to let anyone, panel
-- or migration or સંચાલક, ever fill it in. The row would be permanently incomplete with no
-- way to complete it.
--
-- So the guard now blocks only what it was written to block: changing an SMK that already
-- exists. NULL → 'PGV881' is allowed, once. 'PGV881' → anything else, and 'PGV881' → NULL,
-- still raise. The reason the column was made immutable in the first place — a member id
-- other records are matched against must not move under them — is untouched, because a row
-- that never had one has nothing matched against it yet.

alter table public.profiles alter column smk drop not null;

comment on column public.profiles.smk is
  'The યુવક''s member id (PGV881). Optional: નોંધણી does not ask for it, so it is NULL for '
  'anyone who registered without one. UNIQUE among the rows that have it, and write-once — '
  'see profiles_guard_immutable().';

create or replace function public.profiles_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.mobile is distinct from old.mobile then
    raise exception 'mobile cannot be changed after registration';
  end if;
  if new.email is distinct from old.email then
    raise exception 'email cannot be changed after registration';
  end if;
  -- Write-once rather than immutable-from-insert: a row that registered without an SMK may
  -- still be given one. `old.smk is not null` is the whole difference from 0001 — once the
  -- column holds a value, this is the same rule it always was, and that includes refusing
  -- to clear it back to NULL.
  if old.smk is not null and new.smk is distinct from old.smk then
    raise exception 'smk cannot be changed once it is set';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.profiles_guard_immutable() is
  'mobile, email and created_at never change after insert; smk is write-once (NULL until '
  'somebody supplies it, fixed thereafter). Applies to service_role too, which an RLS '
  'policy would not.';
