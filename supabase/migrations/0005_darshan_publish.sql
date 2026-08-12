-- ================================================================================
-- Publishing a દર્શન image from Google Drive, without a rebuild.
--
-- Until now the only way to change a દ્રશ્ય's artwork was to drop a file into the
-- સંચાલક's Drive folder and re-run the whole pipeline locally: `npm run masters &&
-- npm run optimize`, ~50 minutes for 109 images, then a deploy. The panel offered a
-- "New image URL" box, but it demanded a URL that only that pipeline could produce, so
-- in practice there was nothing a સંચાલક could paste into it. This migration is the
-- state that lets him paste a Drive link instead and have the work happen server-side.
--
-- The rule the panel has always enforced does not change: **a Drive link is an input,
-- never what a યુવક's browser fetches.** Drive's per-file download quota is sized for
-- collaborators, not ~2,000 daily યુવકો, and a quota-blocked file answers with an HTML
-- interstitial rather than an error — every card would blank at once with nothing in the
-- app able to explain why. So the link is recorded here, the bytes are fetched once by
-- netlify/functions/publish-drive-image-background.js, and what the app serves is the
-- encoded, content-hashed result in Supabase Storage.
-- ================================================================================

-- ---------------------------------------------------------------- scenes columns

alter table public.scenes
  -- The published ladder: { avif:[{w,url}], webp:[…], jpeg:[…], full:{…}, w, h }.
  -- `image_url` alone loses the responsive srcset and the reserved width/height that
  -- hold CLS at zero, so a replacement that went through the encoder keeps its variants
  -- here and the card renders it exactly like a pipeline-built scene.
  add column if not exists image_variants jsonb,
  -- What the સંચાલક pasted. Kept so a failed publish can be retried without him having
  -- to find the link again, and so the trail can show where an image came from.
  add column if not exists source_drive_url text,
  add column if not exists publish_status text,
  add column if not exists publish_error text,
  add column if not exists published_at timestamptz;

-- A background function cannot return anything to the browser — it answers 202 the
-- instant it is invoked — so the row is the only channel back. The panel writes QUEUED,
-- the function moves it to WORKING and then DONE or FAILED, and the page polls until it
-- settles. Any other value would leave the panel spinning forever, hence the constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scenes_publish_status_check'
  ) then
    alter table public.scenes
      add constraint scenes_publish_status_check
      check (publish_status is null or publish_status in ('QUEUED', 'WORKING', 'DONE', 'FAILED'));
  end if;
end $$;

-- ---------------------------------------------------------------- storage

-- The first bucket in the project. `public => true` is what makes the object URLs
-- readable without a token, which is required: these are served to signed-out visitors
-- and cached by the CDN. Nothing sensitive lives here — it is finished artwork that is
-- already public on the site.
--
-- Writes are not covered by any policy on purpose. The publish function holds the secret
-- key and bypasses RLS; no browser session, સંચાલક included, can put an object into this
-- bucket, so a stolen panel session cannot host arbitrary files on the project's domain.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'darshan',
  'darshan',
  true,
  26214400, -- 25 MB: the largest 3840px AVIF the pipeline has produced is far under this
  array['image/avif', 'image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- audit: nothing to do
--
-- Deliberately no change to audit_scene(). The publish function writes with the secret
-- key, so `auth.uid()` is null inside its statement — and 0004_rbac.sql's version already
-- opens with `if actor is null or not public.is_admin() then return new; end if`, so the
-- machine write is skipped without a null ever reaching audit_logs.actor_id's NOT NULL.
--
-- That is also the correct outcome, not merely a safe one. The auditable act is the
-- સંચાલક pressing "Publish from Drive", and the panel's own QUEUED write — one statement
-- earlier, carrying his uid and the Drive URL — is what records it. The encoder finishing
-- some seconds later is a consequence, not a second decision by a person.
