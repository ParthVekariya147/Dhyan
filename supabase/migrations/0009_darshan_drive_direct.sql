-- ================================================================================
-- દર્શન images come straight from Google Drive.
--
-- What this replaces
-- ------------------
-- 0005 recorded a Drive link, then had a background function download the bytes, encode
-- them into six widths × three formats, and store the result in Supabase Storage. The
-- local equivalent (`npm run masters && npm run optimize`) did the same work offline. Both
-- shared one assumption — that a Drive link must never be what a browser fetches, because
-- `uc?export=download` is quota-metered and answers a blocked file with an HTML page.
--
-- That assumption was right about `uc?export=download` and wrong about Drive. Google serves
-- Drive images from its own image CDN at `lh3.googleusercontent.com/d/<id>`, which is what
-- Drive's own previews use: not quota-metered, and it resizes and re-encodes on request —
-- `=w1600-rj-v1` turns a 1606 KB PNG master into a 132 KB JPEG. That is the encoder, run by
-- Google, addressed by a string.
--
-- So the whole apparatus goes. A દ્રશ્ય is now three things: a **link**, a **વર્ણન** and a
-- **number**. The cost of the old path was not theoretical — the last full encode reported
-- ~13 hours remaining and was killed after 12 images, which is why the app has been showing
-- 12 દ્રશ્યો out of 109.
--
-- Nothing is destroyed here that holds data a યુવક can still reach: `image_url` keeps
-- working exactly as before and now holds an lh3 URL. The dropped columns are the ones only
-- the encoder ever wrote.
-- ================================================================================

-- ---------------------------------------------------------------- scenes columns

alter table public.scenes
  -- The Drive file behind `image_url`. Kept so the enlarged view can ask the CDN for a
  -- wider encode of the same image (`=w2560`) rather than stretching the feed's copy, and
  -- so the panel can show the સંચાલક which file in his folder a દ્રશ્ય points at.
  -- Null is ordinary: a URL typed in by hand has no Drive id, and the lightbox then simply
  -- reuses the one URL it has.
  add column if not exists drive_id text;

-- Written only by the encoder that no longer exists. `image_variants` held the ladder;
-- the other four tracked a background job whose function is deleted in this same change.
-- Dropped rather than left in place: a nullable column nothing writes is indistinguishable
-- from one whose writer is broken, and the next person to read this table would have to
-- work out which.
alter table public.scenes
  drop column if exists image_variants,
  drop column if exists publish_status,
  drop column if exists publish_error,
  drop column if exists published_at;

-- `source_drive_url` is KEPT and now earns its place properly: it is what the સંચાલક
-- actually pasted, and with no publish step in between it is the record of his input next
-- to `image_url`'s derived form. The panel shows it back to him in the link box.

-- The status constraint referenced a column that no longer exists.
alter table public.scenes drop constraint if exists scenes_publish_status_check;

-- ---------------------------------------------------------------- permissions
--
-- `darshan.publish` named the act of pushing a Drive file through the encoder. There is no
-- such act now — setting the link IS the edit — so the permission is folded into
-- `darshan.update` rather than left granting something that cannot happen. Every role that
-- held `darshan.publish` already held `darshan.update`, so no role loses or gains anything.
-- shared/domain/permissions.js carries the UI's copy of this matrix and changes with it;
-- scripts/seed-admin-supabase.mjs reports any drift between the two.
create or replace function public.permissions_for(r public.admin_role)
returns text[]
language sql
immutable
as $$
  select case r
    when 'SUPER_ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read', 'admins.create', 'admins.update', 'admins.disable', 'roles.assign',
      'audit.read'
    ]
    when 'ADMIN' then array[
      'users.read', 'users.update', 'users.disable',
      'progress.read', 'sessions.read',
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
      'settings.read', 'settings.update',
      'admins.read',
      'audit.read'
    ]
    when 'CONTENT_MANAGER' then array[
      'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
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

-- ---------------------------------------------------------------- storage
--
-- The `darshan` bucket 0005 created is now unreferenced: nothing writes to it and no URL in
-- the app points at it. It is deliberately NOT dropped here. Dropping a bucket destroys the
-- objects inside it, and a migration that silently deletes files is the wrong instrument for
-- a decision that is reversible only by re-encoding. Remove it by hand from the Supabase
-- dashboard once you are satisfied nothing needs it (§28: withhold, do not destroy).
