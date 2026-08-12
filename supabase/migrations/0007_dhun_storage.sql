-- ================================================================================
-- ધૂન — where the two dhun/kirtan MP3s live (§8).
--
-- §8 asks for **exactly two** dhun, uploaded *and named* by the સંચાલક from the panel,
-- stored server-side so swapping a track is a two-minute job for him and not a redeploy
-- for an engineer. PLAN.md §12 still lists "બે ધૂન / કીર્તનની MP3 ફાઈલો" as pending from
-- the સંચાલક; this migration is the state that lets him supply them himself the day they
-- exist.
--
-- What is *recorded* is not stored here. The two entries live in the existing
-- settings['app'] row, in the `"dhun": []` field 0001_init.sql:263 already seeds and
-- which nothing has read or written until now (src/lib/useSettings.js:8 describes that
-- row as "the two dhun and the YouTube video link" — this is the half of the sentence
-- that was never built). Shape, one object per slot:
--
--   [{ "id": "dhun-1-m5k2p", "name": "…", "url": "https://…/dhun/dhun-1-m5k2p.mp3",
--      "path": "dhun-1-m5k2p.mp3", "size": 2874112, "updatedAt": "2026-08-11T…Z" }]
--
-- No new settings key, and no new table: the યુવક app already fetches that one row on
-- every visit, so the dhun ride along on a read that is happening anyway (§12's read
-- budget reasoning survives the move to Postgres as a mobile-data argument).
--
-- Nothing about the *yuvak's* preference is stored anywhere on the server. Which dhun,
-- on or off, and at what volume is localStorage on his phone and only there — PLAN.md §6
-- is explicit ("music choice and scroll speed live only on the phone"), and §13 says to
-- collect only what is needed. What he listens to while meditating is not needed.
-- ================================================================================

-- ---------------------------------------------------------------- storage

-- The second bucket in the project, after `darshan` (0005_darshan_publish.sql).
--
-- `public => true`, for the same reason that one is: the object URL has to be fetchable
-- by a plain <audio src>, cached by the CDN, and re-fetched from that cache by the next
-- 1,999 yuvaks. A signed URL would add a round trip before the first note and would
-- defeat the CDN entirely — a per-user URL is a per-user cache miss. There is nothing to
-- protect: it is devotional kirtan that the whole સંઘ is meant to hear.
--
-- Serving from Supabase Storage rather than from the site also keeps the MP3s off
-- Netlify's 100 GB/month budget (PLAN.md §2.2), which is sized for images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dhun',
  'dhun',
  true,
  8388608, -- 8 MB. §8 says "MP3, kept small"; a 6-minute kirtan at 96 kbps is ~4 MB, so
           -- this passes a real dhun and refuses somebody's 40 MB WAV-in-an-MP3-suit.
           -- admin/src/features/settings/services/dhunService.js checks the same number
           -- before the upload starts, so the સંચાલક is told why rather than watching an
           -- 8 MB request die at the end.
  array['audio/mpeg'] -- The panel normalises every upload to audio/mpeg, so one entry is
                      -- enough. It also settles the "what if someone uploads HTML named
                      -- .mp3" question: whatever the bytes are, this bucket can only ever
                      -- serve them as audio/mpeg, which no browser will render as a page.
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- who may write
--
-- **This is the one deliberate difference from `darshan`, and it needs justifying.**
--
-- 0005 gave the `darshan` bucket no write policy at all: the bytes arrive from Google
-- Drive, fetched by netlify/functions/publish-drive-image-background.js holding the
-- secret key, so *no* browser session — સંચાલક included — can put an object on the
-- project's domain. That is the stronger arrangement and it was free there, because a
-- pasted Drive link is all the browser ever had to send.
--
-- It is not free here. An MP3 upload starts as a file on the સંચાલક's phone or laptop;
-- there is no link to hand to a server. Keeping browsers out would mean relaying 8 MB of
-- multipart body through a Netlify Function (10 s / 6 MB request limits) purely to have
-- the secret key sign the final PUT — more moving parts, a new failure mode, and a new
-- place the service key is handled. For two files that change perhaps twice a year, that
-- trade is not worth it.
--
-- So authenticated writes are allowed, and scoped as narrowly as the RBAC model can
-- express it: `has_permission('settings.update')` (0004_rbac.sql:142), held by
-- SUPER_ADMIN and ADMIN only. A CONTENT_MANAGER, a COORDINATOR, a VIEWER and — the case
-- that actually matters — every one of the ~2,000 signed-in યુવકો hold no such
-- permission and cannot put a byte in this bucket. The same predicate already guards the
-- settings row itself (0004_rbac.sql:649), so the person who may *name* a dhun is exactly
-- the person who may *upload* one; they cannot drift apart.
--
-- The residual risk is a stolen ADMIN session hosting a small audio file on the project's
-- domain. It is bounded by the bucket's own limits above — 8 MB, audio/mpeg, nothing
-- executable, nothing renderable — and it is visible: every save writes settings['app'],
-- and the audit_settings trigger (0004_rbac.sql:460) records SETTINGS_UPDATED with the
-- before/after row, so the change has a name and a timestamp against it.
--
-- `to authenticated` on every policy, not `to public`: an anonymous request should not
-- even reach the has_permission() call.

drop policy if exists "dhun uploadable by settings admins" on storage.objects;
create policy "dhun uploadable by settings admins" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dhun' and public.has_permission('settings.update'));

-- The panel names each object with a fresh timestamp and never overwrites, so this is not
-- on the normal path. It exists so that a retry after a half-failed upload is a retry and
-- not a permanent "The resource already exists".
drop policy if exists "dhun replaceable by settings admins" on storage.objects;
create policy "dhun replaceable by settings admins" on storage.objects
  for update to authenticated
  using (bucket_id = 'dhun' and public.has_permission('settings.update'))
  with check (bucket_id = 'dhun' and public.has_permission('settings.update'));

-- Replacing a dhun uploads the new object and then deletes the old one, so that two
-- files stay two files rather than growing a tail of every track ever chosen.
drop policy if exists "dhun removable by settings admins" on storage.objects;
create policy "dhun removable by settings admins" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dhun' and public.has_permission('settings.update'));

-- Deliberately no SELECT policy, exactly as with `darshan`: `public => true` is what makes
-- the /object/public/dhun/… URL readable, and it bypasses RLS by design. A select policy
-- here would be dead code that reads like a security control.

-- ---------------------------------------------------------------- audit: nothing to do
--
-- No trigger is added. The auditable act is the સંચાલક choosing which two dhun the સંઘ
-- hears, and that is the settings['app'] write — already caught by the existing
-- audit_settings trigger, which stores the whole before/after value, so the old and new
-- dhun names and URLs are both in the trail. The storage PUT a moment earlier is how the
-- bytes got there, not a second decision by a person (0005 makes the same argument).
