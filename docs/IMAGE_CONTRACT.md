# Image contract — FROZEN (already implemented)

This describes the pipeline **as it exists today**. No agent in this work builds it, replaces
it, or adds a second one. It is written down so the Excel and title work cannot contradict it.

> **CORRECTION (2026-08-12).** The first draft of this file described the 0005 encoder —
> a background function that downloaded Drive bytes, encoded six widths × three formats and
> re-hosted them in Supabase Storage, tracked by `publish_status`. **All of that was deleted
> by `0009_darshan_drive_direct.sql`.** The draft was written from a stale read of the
> migrations. The columns `image_variants`, `publish_status`, `publish_error` and
> `published_at` are **dropped**; the permission `darshan.publish` is **gone**; there is no
> publish queue and no polling. Sections 1 and 2 below are rewritten to match reality.

## 1. The rule

> **`drive.google.com/uc?export=download` is never what a browser fetches.
> `lh3.googleusercontent.com/d/<id>` is — deliberately.**

The distinction is the whole point of 0009 and it is easy to get backwards:

- **Refused:** `drive.google.com` / `docs.google.com` share and download links. `uc?export=download`
  is quota-metered, sized for collaborators rather than ~2,000 daily યુવકો, and answers a
  blocked file with an **HTML interstitial instead of an error** — every card would blank at
  once with nothing in the app able to explain why.
- **Served:** `lh3.googleusercontent.com/d/<id>=w1600-rj-v1`. This is Google's image CDN, the
  same infrastructure Drive's own previews use. It is not quota-metered and it **re-encodes
  and resizes on request** — `=w1600-rj-v1` turns a 1606 KB PNG master into a 132 KB JPEG.
  That is the encoder, run by Google, addressed by a string.

This replaced a local pipeline whose last full run reported ~13 hours remaining and was killed
after 12 images — which is why the app was showing 12 દર્શન out of 109.

Enforced by:
- `resolveImageInput()` / `parseDriveLink()` in `shared/domain/drive.js` — converts whatever
  the સંચાલક pastes into an lh3 URL, and is the single conversion point.
- `validateImageUrl()` in `admin/src/features/darshan/services/darshanService.js`.
- `netlify/functions/list-drive-folder.js` — a browser cannot reach Drive at all (no CORS
  header on any Drive endpoint), so folder listing is server-side by necessity.

## 2. What is stored

| Column                    | Meaning |
| ------------------------- | ------- |
| `scenes.drive_id`         | the Drive file id (0009). Lets the lightbox ask the CDN for a wider encode (`=w2560`) of the same file rather than stretching the feed's copy. Null is ordinary — a hand-typed URL has no id |
| `scenes.source_drive_url` | what the સંચાલક actually pasted, shown back to him in the link box |
| `scenes.image_url`        | the lh3 URL actually served |

There is no fourth column and no job state. Setting the link **is** the edit: it completes
within the one `saveScene` write, audited by `audit_scene()` like any other field.

## 3. Quality — non-negotiable

- The original in the સંચાલક's Drive folder is **never modified**.
- No aggressive recompression, no resolution reduction for the sake of speed. These images
  carry Gujarati text and fine detail that must stay legible.
- Delivery is Google's CDN at an explicit width (`=w1600-rj-v1` for the feed, `=w2560-rj-v1`
  for the lightbox), so the panel's grid asks for a narrow encode (`=w400`) without ever
  showing a યુવક a blurry thumbnail as the final image.
- Speed comes from lazy loading, prefetching the next image, explicit dimensions (CLS = 0)
  and cache headers — never from degrading the picture.

## 4. What this work may and may not do

**May:** read `driveId` / `imageUrl` for export; accept `Google Drive File ID` and
`Google Drive URL` on import, writing `drive_id` and `source_drive_url`; derive `image_url`
**only** by passing the input through `resolveImageInput()`; report image health counts.

**May not:** re-encode anything; write a raw `drive.google.com` URL into `image_url`; build an
lh3 URL by string concatenation instead of calling `driveImageUrl()`; add a second Drive
helper — `shared/domain/drive.js` already owns `parseDriveLink()`, `resolveImageInput()`,
`driveImageUrl()`, `isGoogleImageCdn()` and `DEFAULT_DRIVE_FOLDER_ID`, and it is the single
conversion point.

## 5. Health counts

The તપાસ page reports over real records, never against a hardcoded 109:

```
Total: <items.length>   Valid: X   Missing image: X   Invalid: X   Duplicate: X
Missing title: X        Missing description: X
```

`validateDarshanItems()` in `shared/domain/darshan.js` is the single source of these numbers.
