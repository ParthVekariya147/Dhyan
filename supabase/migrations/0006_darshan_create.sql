-- ================================================================================
-- Adding a દ્રશ્ય from the panel.
--
-- Until now `public.scenes` was purely an *overlay*: every row it held corresponded to an
-- entry that `npm run content` had already written into content/darshan.json, and both
-- the panel and the યુવક app iterated the manifest, looking a row up per entry. A row with
-- no manifest entry was therefore invisible — not rejected, just never read — which is why
-- the panel had no "add" control to begin with. There was nowhere for a new દ્રશ્ય to go.
--
-- shared/domain/darshan.js now synthesises a manifest entry for any row the manifest does
-- not claim, so such a row renders like any other દ્રશ્ય. This migration is the database
-- half of that: a permission for the act, and an INSERT policy that names it.
--
-- What has NOT changed
-- -------------------
-- The sheet is still the source of truth for a *batch* (§34). A hundred દ્રશ્યો arrive by
-- `npm run content && npm run optimize`, not by typing. What this adds is the single
-- દ્રશ્ય the સંચાલક needs today, without a build and a deploy standing in the way — the
-- same gap 0005 closed for artwork, closed here for the record itself.
--
-- A દ્રશ્ય created this way carries no image. It is a placeholder until the સંચાલક
-- publishes one through 0005's Drive path, and until then the તપાસ page reports it as
-- `missing-image` and no યુવક is shown it. That is deliberate: §1 says never hand a યુવક a
-- dead end, and an entry with no artwork is exactly that.
-- ================================================================================

-- ---------------------------------------------------------------- the permission
--
-- Mirrors shared/domain/permissions.js, which holds the UI's copy of this matrix. The two
-- are kept in step by hand and `scripts/seed-admin-supabase.mjs` reports any drift — see
-- 0004_rbac.sql's "Why functions and not tables" for why this is a function and not a
-- table the panel could edit.
--
-- `darshan.create` is separate from `darshan.update` rather than folded into it. Editing a
-- દ્રશ્ય that exists and calling a new one into existence are different acts: the second
-- can renumber the collection, and keeping it distinct is what lets audit_logs say which
-- of the two a સંચાલક performed. COORDINATOR and VIEWER hold neither, as before.
create or replace function public.permissions_for(r public.admin_role)
returns text[]
language sql
immutable
as $$
  select case r
    when 'SUPER_ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read', 'admins.create', 'admins.update', 'admins.disable', 'roles.assign',
      'audit.read'
    ]
    when 'ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read',
      'audit.read'
    ]
    when 'CONTENT_MANAGER' then array[
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.publish', 'darshan.disable',
      'settings.read'
    ]
    when 'COORDINATOR' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read'
    ]
    when 'VIEWER' then array[
      'users.read', 'progress.read', 'sessions.read', 'darshan.read', 'settings.read'
    ]
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------- the policies
--
-- 0004's "scenes writable by permission" was a single `for all` policy checking
-- `darshan.update`. Under `for all`, an INSERT is authorised by the WITH CHECK arm alone,
-- so leaving it in place would mean the new permission gated nothing: anyone who could
-- edit a વર્ણન could conjure દ્રશ્યો. It is replaced by one policy per command so that each
-- names the permission that actually belongs to it.
--
-- SELECT is untouched — "scenes readable by signed-in" from 0001_init.sql still governs
-- reads, and it must, because every યુવક reads this table to pick up the સંચાલક's edits.
drop policy if exists "scenes writable by permission" on public.scenes;

create policy "scenes insertable by permission" on public.scenes
  for insert with check (public.has_permission('darshan.create'));

create policy "scenes updatable by permission" on public.scenes
  for update using (public.has_permission('darshan.update'))
  with check (public.has_permission('darshan.update'));

-- Kept because `for all` granted it, not because the panel offers it: nothing in
-- admin/src deletes a scene, and §28's argument against destroying assets applies here
-- too — withholding a દ્રશ્ય is `status`/`active`, which is reversible and leaves an audit
-- row behind. Removing the capability outright is a separate decision from this migration.
create policy "scenes deletable by permission" on public.scenes
  for delete using (public.has_permission('darshan.update'));

-- ---------------------------------------------------------------- triggers: nothing to do
--
-- Both triggers 0004 attached to this table already fire `before insert or update` and
-- `after insert or update` respectively, so a row created from the panel gets its derived
-- `active` from scenes_sync_status() and its audit row from audit_scene() with no change
-- here. The audit row will carry action 'INSERT', which is precisely the distinction the
-- separate permission above exists to make legible.
