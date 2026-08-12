/**
 * Google Drive links — the only image source this project has.
 *
 * A દ્રશ્ય is three things: a Drive link, a વર્ણન, and a number. Nothing is downloaded,
 * re-encoded or committed; the યુવક's browser fetches the artwork straight from Google.
 * This module is the whole of the "link" half — parsing what a સંચાલક pastes, and turning
 * it into a URL an `<img>` can render.
 *
 * Pure and dependency-free on purpose: the same functions run in the panel (to reject a
 * bad link before it is saved), in the build script, and in the Netlify function that
 * lists a folder — which must never trust a value that arrived over the wire.
 */

/**
 * Drive ids are URL-safe base64-ish and have been 28, 33 and 44 characters at various
 * points in Drive's history. The lower bound is deliberately loose and the character class
 * strict — a wrong id fails with a visibly broken image, whereas a too-clever pattern
 * silently rejects a link that would have worked.
 */
const ID = '[A-Za-z0-9_-]{20,}';

const FILE_PATTERNS = [
  // https://drive.google.com/file/d/<id>/view    (the "share" link, by far the commonest)
  new RegExp(`/file/d/(${ID})`),
  // https://docs.google.com/…/d/<id>/…           (Docs-style, same id shape)
  new RegExp(`/d/(${ID})`),
  // https://drive.google.com/open?id=<id> · /uc?export=download&id=<id>
  new RegExp(`[?&]id=(${ID})`),
];

const FOLDER_PATTERN = new RegExp(`/folders/(${ID})`);

/**
 * The folder the collection lives in today — "Papubhai finalise images".
 *
 * A default, not a hard-coding: the સંચાલક sets his own in પેનલ → સેટિંગ્સ, the build
 * script takes `--folder`, and both fall back here so the ordinary case needs no input.
 * When he moves to a second folder that is a settings change, never a code change.
 */
export const DEFAULT_DRIVE_FOLDER_ID = '1qwZibCk9IaU_fmVi8hDJ4hfmCkY3UGfw';

/** Bare-id shape, used to validate a folder id before it is interpolated into a URL. */
export const isDriveId = (s) => new RegExp(`^${ID}$`).test(String(s || '').trim());

/**
 * @param {string} input a Drive file URL, or a bare file id
 * @returns {{ ok: true, id: string } | { ok: false, gu: string }}
 *   `gu` is the message shown to the સંચાલક.
 */
export function parseDriveLink(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, gu: 'Paste the Google Drive link.' };

  if (FOLDER_PATTERN.test(s)) {
    return {
      ok: false,
      gu: 'That is a link to a Drive folder, not to one image. Open the image in Drive and copy the link from there — the folder itself goes in Settings.',
    };
  }

  for (const re of FILE_PATTERNS) {
    const m = s.match(re);
    if (m) return { ok: true, id: m[1] };
  }

  // A bare id, which is what someone pastes after copying it out of a longer URL.
  if (isDriveId(s)) return { ok: true, id: s };

  if (/drive\.google\.com|docs\.google\.com/i.test(s)) {
    return { ok: false, gu: 'That is a Google Drive link, but there is no file id in it. Use Share → Copy link on the image itself.' };
  }

  return { ok: false, gu: 'That does not look like a Google Drive link.' };
}

/**
 * @param {string} input a Drive folder URL, or a bare folder id
 * @returns {{ ok: true, id: string } | { ok: false, gu: string }}
 */
export function parseDriveFolderLink(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, gu: 'Paste the Google Drive folder link.' };

  const m = s.match(FOLDER_PATTERN);
  if (m) return { ok: true, id: m[1] };

  if (isDriveId(s)) return { ok: true, id: s };

  if (/\/file\/d\//.test(s)) {
    return { ok: false, gu: 'That is a link to one image, not to the folder. Open the folder in Drive and copy the link from the address bar.' };
  }

  return { ok: false, gu: 'That does not look like a Google Drive folder link.' };
}

/**
 * The same Drive file, as a URL a browser can actually render in an `<img>`.
 *
 * `lh3.googleusercontent.com/d/<id>` is Google's image CDN — the same infrastructure that
 * serves Drive's own previews. `uc?export=download` is the wrong endpoint for display: it
 * is a *download* route, it answers large files with an HTML confirmation page instead of
 * bytes, and it is the one metered by Drive's per-file download quota. Point a card at it
 * and the દર્શન eventually turns into a broken frame for everybody at once.
 *
 * The suffix after the id is Google's image-processing spec, and each part earns its place —
 * measured against દ્રશ્ય ૧, whose master is a 3840×2160 PNG:
 *
 *   `w1600`  scale to fit 1600px wide. The feed is capped at 1100 CSS px, so 1600 covers a
 *            desktop and a phone at DPR 2 alike without shipping a 4K file.
 *   `rj`     re-encode to JPEG. Without it Drive returns the master's own format — PNG, at
 *            1606 KB for that one image. JPEG brings it to 249 KB.
 *   `v1`     Google's stronger encoder profile: 132 KB for the same image, no visible loss
 *            on this artwork.
 *
 * 1606 KB → 132 KB, twelve times smaller, by asking for it in the URL. That is the entire
 * replacement for the local encoder, and it costs one string.
 *
 * JPEG rather than WebP (`rw`, which is smaller again at 95 KB) on purpose: one `<img src>`
 * has no format negotiation, so the single URL has to be one every browser can decode.
 */
export const driveImageUrl = (id, width = 1600) => `https://lh3.googleusercontent.com/d/${id}=w${width}-rj-v1`;

/** The listing URL for a folder. `embeddedfolderview` renders every entry as static HTML;
 *  the ordinary folder page server-renders only its first ~50 and fetches the rest by
 *  script, which would silently truncate a 109-file folder to 50. */
export const driveFolderListingUrl = (folderId) =>
  `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;

/** Hosts whose URLs a browser can render directly, used to accept a pasted URL in the panel. */
export const isGoogleImageCdn = (url) => /^https:\/\/lh\d+\.googleusercontent\.com\//i.test(String(url || ''));

/**
 * Any URL the panel will accept as a દ્રશ્ય's image: a Drive link (converted), or a URL
 * that already points at something renderable.
 *
 * @returns {{ ok: true, url: string, driveId: string } | { ok: false, gu: string }}
 */
export function resolveImageInput(input, width) {
  const s = String(input || '').trim();
  if (!s) return { ok: false, gu: 'Paste the Google Drive link.' };

  const drive = parseDriveLink(s);
  if (drive.ok) return { ok: true, url: driveImageUrl(drive.id, width), driveId: drive.id };

  // A Drive URL that parseDriveLink refused stays refused, and this order is the whole
  // point of the check. A folder link *is* a well-formed https URL, so the generic branch
  // below would have accepted it and set a folder's viewer page as a દ્રશ્ય's image — a
  // broken frame, with a plausible-looking URL in the panel to explain it away.
  if (/drive\.google\.com|docs\.google\.com/i.test(s)) return drive;

  // Already a direct image URL — the lh3 CDN, or any https image the સંચાલક hosts himself.
  if (isGoogleImageCdn(s) || /^https:\/\/\S+$/i.test(s)) return { ok: true, url: s, driveId: '' };

  return drive;
}

/**
 * Why a folder listing failed, in words a સંચાલક can act on. Drive's own messages are HTML
 * pages aimed at a person in a browser, so there is nothing to forward.
 */
export const DRIVE_NOT_SHARED =
  'Drive would not give the folder. Open it in Drive → Share → General access → "Anyone with the link", then try again.';
