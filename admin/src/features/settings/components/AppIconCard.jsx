import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APP_ICON_IDEAL_PX,
  APP_ICON_KEY,
  APP_ICON_MAX_BYTES,
  APP_ICON_MIN_PX,
  APP_ICON_SOURCE_MAX_BYTES,
  APP_ICON_ZOOM_MAX,
  APP_ICON_ZOOM_MIN,
  BUILT_IN_ICON,
  centredIconPlacement,
  clampIconPlacement,
  iconCoverBox,
  resolveAppIcon,
  validateAppIcon,
  validateAppIconFile,
  validateAppIconSource,
  withVersion,
  zoomIconPlacement,
} from '../../../../../shared/domain/appicon.js';
import { removeAppIcon, readImageSize, renderAppIconPng, uploadAppIcon } from '../services/appIconService';
import { updateAppSettings } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { saveError } from '../../../lib/errors';
import { bytes, dateTimeGu } from '../../../lib/format';

/**
 * The mark on two thousand home screens, chosen here instead of committed to the repo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this card is mostly prose
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The control is one file picker and one button. Everything else on the card exists because
 * this is the one setting in the panel whose effect a સંચાલક **cannot verify by looking**: he
 * saves, his own phone keeps the old icon for another day, and there is no screen anywhere that
 * can tell him whether that is the feature working or the feature broken. A card that said only
 * "Saved" would produce a bug report every time it was used, and the bug would be the platform.
 *
 * So the four platform cases are written out on the card in the plainest words available, and
 * the iPhone one is not softened. shared/domain/appicon.js and 0042_app_shell.sql carry the same
 * four cases in more detail; this is the version for the person pressing the button.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The crop stage is the point of this card
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Android crops a maskable icon to whatever shape the launcher uses — a circle, a squircle, a
 * rounded square, a teardrop, depending on the phone. Only the central 80% circle is guaranteed
 * to survive; the corners are the launcher's to take. A સંચાલક uploading a square મૂર્તિ with
 * writing across the bottom has no way to know that until somebody shows him a phone.
 *
 * So the safe zone is drawn over his own image before he saves. That much was always here.
 *
 * What was here too, and was wrong, is that the card then made him do something about it
 * somewhere else. It demanded a square PNG of at least 192px and refused everything else, which
 * meant a photograph off a phone — the thing anybody actually has — bounced with a red line
 * telling him to go and find a program that can square a JPEG. The old note in this file argued
 * that shrinking somebody's મૂર્તિ into the middle is a decision about how the mark should look
 * and therefore his to make. That was right, and the mistake was in the next step: it concluded
 * that the panel should not offer him anywhere to make it.
 *
 * It does now. He picks any image, of any shape, in any format the browser can decode, and
 * drags and zooms it inside the square with the safe circle drawn on top and the round launcher
 * preview updating beside it. Nothing is decided for him — zoom 1 is the whole picture filling
 * the square and every pixel after that is his hand. The panel only cuts what he lined up, and
 * re-encodes it as the same square PNG the bucket and 0042 have always required, so nothing
 * downstream of the Save button knows this changed.
 *
 * The geometry is not in this file. shared/domain/appicon.js holds it as four pure functions in
 * fractions-of-the-square, tested in scripts/test-app-shell.mjs, and the same numbers drive the
 * dragged <img>, the round preview and the exported canvas — so what he was looking at and what
 * was cut cannot come apart.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The version counter, and what breaks if it stops moving
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every save writes `version: previous + 1`. Three separate things depend on it and all three
 * fail silently if it ever stands still:
 *
 *   * The database refuses the write outright — 0042 requires a whole number of 1 or more.
 *   * The `?v=N` on the URL is what makes Chrome's WebAPK updater, Supabase's CDN and the
 *     phone's own cache fetch bytes they have not seen. A URL that has not changed is a fetch
 *     that does not happen, and an icon that does not change.
 *   * The app compares it against what this phone last saw, to show an iPhone user the
 *     "remove and re-add" notice once per icon rather than on every open.
 *
 * It is taken from `resolveAppIcon(appIcon).version`, never from local state, so two સંચાલક
 * saving from two laptops cannot both write version 4 from a stale form.
 */
export default function AppIconCard({ appIcon, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * Same split as the rest of this page: `settings.read` opens the card, `settings.update`
   * moves the icon. Disabled rather than hidden — which mark is in force is the useful fact on
   * this card, and a VIEWER asked "why does my home screen say that?" should be able to read
   * the answer. The check that matters is the RLS policy on `settings` and the storage policies
   * in 0042; this is only where they become visible.
   */
  const mayEdit = can('settings.update');

  /*
    Through the same resolver the યુવક app and netlify/functions/manifest.js use, never a looser
    read of this panel's own. The card has to show what is actually in force — including when
    the stored row is one this panel would not have written, which is exactly when the
    difference matters.
  */
  const inUse = resolveAppIcon(appIcon);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [dims, setDims] = useState(null);
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(null); // null | 'save' | 'revert'
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);

  /*
    Where his image sits inside the square, in fractions of it — see the units note in
    shared/domain/appicon.js. Three numbers and no more: a zoom, and the top-left corner.

    One piece of state for three views. The dragged <img>, the round launcher preview and the
    canvas the save draws are all built from this, which is what makes "what he saw is what was
    cut" true by construction rather than by two pieces of code agreeing.

    It is only meaningful while `dims` is set. Before a file is picked there is nothing to place,
    and the previews fall back to the icon in force.
  */
  const [place, setPlace] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  /** What the save produced, so the hint can say 512 x 512 - 34 KB rather than nothing at all. */
  const [rendered, setRendered] = useState(null);
  // The rule is shown as a hint before the first pick and as an error only after one. A field
  // that is red the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  const input = useRef(null);

  /*
    The live blob: URL, held in a ref as well as in state.

    A blob URL pins the whole file in memory until it is revoked or the tab closes, and this is
    a card where somebody tries four images before settling on one. The ref exists because the
    obvious cleanup — `useEffect(() => () => URL.revokeObjectURL(preview), [preview])` — is
    wrong under StrictMode, which admin/src/main.jsx turns on: React runs the effect, its
    cleanup, then the effect again, and the second run has nothing to re-create the URL it just
    revoked, so the preview would be a broken image in development only. Revoking the previous
    URL at the moment a new one is made has no such hazard.
  */
  const previewRef = useRef('');

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

  /*
    A fresh row from the parent clears the pending pick.

    Keyed on the icon actually in force rather than on the `appIcon` prop, which is a new object
    on every read of the settings row and would fight the સંચાલક for his own file picker.

    `msg` is deliberately NOT cleared here, and this is the one place this card departs from
    GalleryCard. There, a successful save changes the value, the parent re-reads, this effect
    runs and the "Saved" line disappears — acceptable for a number he can see in the field. Here
    the confirmation carries the part that matters, that Android will take a day or two and that
    iPhone users are being asked to reinstall, and wiping it a few hundred milliseconds after it
    appears would delete the answer to the question the save raises.
  */
  useEffect(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    setPreview('');
    setFile(null);
    setDims(null);
    setFileError('');
    setRendered(null);
    setTouched(false);
    if (input.current) input.current.value = '';
  }, [inUse.url, inUse.version]);

  /*
    Picks are numbered so a slow decode cannot overwrite a newer one.

    readImageSize() is asynchronous, and a 500 KB PNG on a tired laptop takes long enough for
    somebody to change his mind and pick a second file. Without this the first decode would
    finish last and stamp its dimensions — and therefore its verdict — onto the second image.
  */
  const pickSeq = useRef(0);

  async function pick(chosen) {
    const seq = ++pickSeq.current;

    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    setPreview('');
    setDims(null);
    setFileError('');
    setRendered(null);
    setMsg(null);
    setFile(chosen || null);
    setTouched(true);

    if (!chosen) return;

    // Shown immediately, from the file itself — the preview must not wait on a decode. If the
    // bytes turn out not to be an image the <img> simply fails to paint and the message below
    // says why.
    const url = URL.createObjectURL(chosen);
    previewRef.current = url;
    setPreview(url);

    let size = null;
    try {
      size = await readImageSize(chosen);
    } catch {
      // A decode failure is the honest test that this is an image at all, whatever the OS called
      // the file. validateAppIconSource() has no branch for "could not be read" without
      // dimensions to hand it, so the verdict is spelled here in its words.
      if (seq !== pickSeq.current) return;
      setDims(null);
      setFileError('That file could not be read as an image. Choose a JPG, PNG or WebP.');
      return;
    }
    if (seq !== pickSeq.current) return;

    setDims(size);
    /*
      The rule for a **picked** file, which is the short one: an image, not enormous, and not so
      small that a square cut from it would be upscaled. Shape and format are not asked about
      here, because the crop below answers both.

      validateAppIconFile() — square, PNG, 512 KB — is not gone and is not relaxed. It runs in
      save(), against the PNG this card produces, which is the file that actually reaches the
      bucket. Two rules for two different files, and the shared module owns both.
    */
    const v = validateAppIconSource({
      type: chosen.type,
      size: chosen.size,
      width: size.width,
      height: size.height,
    });
    setFileError(v.ok ? '' : v.gu);
    // Filling the square, centred. The whole picture is inside the frame at zoom 1, so the
    // opening state is "nothing cropped yet" and every pixel lost after this is his own doing.
    if (v.ok) setPlace(centredIconPlacement({ width: size.width, height: size.height }));
  }

  // Nothing to save without a picked file that passed. There is no "re-save the same icon"
  // state to guard against the way GalleryCard's number has one: a save requires a new file,
  // so it always writes something that differs from what is stored (§41).
  const changed = Boolean(file) && !fileError && Boolean(dims);
  const error = touched ? fileError : '';

  /**
   * Is there something to place?
   *
   * All three conditions are needed and each rules out a different half-state: `preview` is the
   * blob URL, `dims` arrives one decode later and the geometry is meaningless without it, and a
   * `fileError` means the picked file was refused — a 60px thumbnail must not be draggable, or
   * he would spend a minute composing a crop that cannot be saved.
   *
   * Declared up here rather than beside the previews it governs, because the wheel effect below
   * lists it as a dependency: a `const` read above its own declaration is a ReferenceError, and
   * a dependency array is evaluated during the render rather than when the effect runs.
   */
  const editing = Boolean(preview && dims && !fileError);

  /* ------------------------------------------------------------------ the crop stage

     Everything from here to save() is the placement, and all of it is arithmetic on three
     numbers. The heavy lifting — clamping, and holding a point still through a zoom — is in
     shared/domain/appicon.js; these are the event handlers that feed it.
  */

  /** The image's size inside the square at the current zoom, as CSS percentages. */
  const box = useMemo(
    () => iconCoverBox(dims?.width ?? 0, dims?.height ?? 0),
    [dims?.width, dims?.height]
  );

  const stage = useRef(null);
  /** The pointer that is currently dragging, and where the image was when it went down. */
  const drag = useRef(null);

  const move = useCallback(
    (offsetX, offsetY) => {
      if (!dims) return;
      setPlace((p) =>
        clampIconPlacement({ width: dims.width, height: dims.height, zoom: p.zoom, offsetX, offsetY })
      );
    },
    [dims]
  );

  /**
   * A new zoom, with one point of the square held still.
   *
   * `focus` is the middle for the slider and the buttons, and the pointer for a wheel. Without
   * it the image grows from its top-left corner: he lines the મૂર્તિ's face up in the circle,
   * reaches for the slider, and the face walks out of it.
   */
  const zoomTo = useCallback(
    (next, focusX = 0.5, focusY = 0.5) => {
      if (!dims) return;
      setPlace((p) =>
        zoomIconPlacement({
          width: dims.width,
          height: dims.height,
          zoom: p.zoom,
          offsetX: p.offsetX,
          offsetY: p.offsetY,
          next,
          focusX,
          focusY,
        })
      );
    },
    [dims]
  );

  function onPointerDown(e) {
    if (!dims || !mayEdit || busy) return;
    // Captured, so a drag that leaves the card — which is most of them, the frame is 168px —
    // keeps sending moves here instead of being swallowed by whatever is underneath.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: place };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const rect = stage.current?.getBoundingClientRect();
    if (!rect?.width) return;
    // Pixels dragged → fractions of the square. Dividing by the live rect rather than by a
    // constant is what keeps the drag tracking the cursor exactly at any card width.
    move(d.from.offsetX + (e.clientX - d.x) / rect.width, d.from.offsetY + (e.clientY - d.y) / rect.height);
  }

  function onPointerUp(e) {
    if (drag.current?.id !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }

  /*
    The wheel, as a native listener rather than an `onWheel` prop, and this is not a style
    choice — the prop does not work.

    React attaches `wheel` at the root as a **passive** listener, which is the right default for
    a scrolling page and means `preventDefault()` inside an `onWheel` handler is ignored (and
    logs a warning saying so). The page would scroll and the icon would zoom at the same time,
    which is worse than either.

    `{ passive: false }` on the element itself is the only way to claim the gesture. The
    placement is read through a ref so this listener does not have to be torn down and rebuilt on
    every frame of a drag.
  */
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    const el = stage.current;
    if (!el || !editing || !mayEdit || busy) return undefined;

    const onWheel = (e) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      e.preventDefault();
      // Multiplicative, so one notch of the wheel is the same visual step at every zoom — an
      // additive step is imperceptible at 6x and a lurch at 0.25x.
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomTo(
        placeRef.current.zoom * factor,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height
      );
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editing, mayEdit, busy, zoomTo]);

  /**
   * Arrows nudge, +/- zoom, 0 resets.
   *
   * Not decoration: a drag surface with no keyboard route is unusable for anyone who does not
   * use a mouse, and this is the one control on the card that decides what the icon looks like.
   * The step is 2% of the square, which is a visible movement and still fine enough to line
   * something up.
   */
  function onKeyDown(e) {
    if (!dims || !mayEdit || busy) return;
    const step = e.shiftKey ? 0.005 : 0.02;
    const keys = {
      ArrowLeft: () => move(place.offsetX - step, place.offsetY),
      ArrowRight: () => move(place.offsetX + step, place.offsetY),
      ArrowUp: () => move(place.offsetX, place.offsetY - step),
      ArrowDown: () => move(place.offsetX, place.offsetY + step),
      '+': () => zoomTo(place.zoom * 1.12),
      '=': () => zoomTo(place.zoom * 1.12),
      '-': () => zoomTo(place.zoom / 1.12),
      _: () => zoomTo(place.zoom / 1.12),
      0: () => setPlace(centredIconPlacement({ width: dims.width, height: dims.height })),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  }

  async function save() {
    if (!file || !dims) {
      setTouched(true);
      setMsg({ tone: 'danger', text: 'Choose an image first.' });
      return;
    }

    setBusy('save');
    setMsg(null);
    try {
      /*
        The crop, cut and encoded here — before anything leaves the browser.

        This is the step that lets the picker accept a 2560 x 1440 JPEG: what goes to Storage is
        never the file he chose, it is the square PNG this produces from the placement he
        dragged. It can come back smaller than 512 x 512 when a photograph will not encode under
        the ceiling; renderAppIconPng() explains why, and the confirmation below says which size
        it landed on rather than leaving him to wonder.
      */
      const cut = await renderAppIconPng({
        file,
        zoom: place.zoom,
        offsetX: place.offsetX,
        offsetY: place.offsetY,
      });
      setRendered(cut);

      /*
        The shared rule — square, PNG, at least 192, under 512 KB — run against the file that is
        actually being uploaded. Unchanged from before this card could crop, and deliberately so:
        the same module is read by the trigger in 0042 and by the manifest function, and what
        reaches the bucket has to satisfy it whatever route it took to get there. If this ever
        fails it is a bug in the crop, not something he did, so it is worth the four lines.
      */
      const vFile = validateAppIconFile({
        type: cut.file.type,
        size: cut.size,
        width: cut.px,
        height: cut.px,
      });
      if (!vFile.ok) {
        setMsg({ tone: 'danger', text: vFile.gu });
        return;
      }

      // Bytes first. If the upload fails, settings['app'] is untouched and the mark two
      // thousand phones are showing keeps showing — the failure costs nothing.
      const up = await uploadAppIcon(cut.file);

      /*
        The counter, read from the row rather than from anything this component is holding.

        Local state would go stale the moment a second સંચાલક saved from another laptop, and two
        writes of version 4 would leave the app unable to tell the two icons apart: the `?v=`
        would repeat, so caches would keep serving the first one, and any phone that had already
        seen the iPhone notice for version 4 would never be shown it for the new icon.
      */
      const entry = {
        url: up.url,
        path: up.path,
        size: up.size,
        version: inUse.version + 1,
        updatedAt: new Date().toISOString(),
      };

      /*
        Validated after the upload because the URL does not exist before it, and before the row
        is written because the trigger in 0042 would refuse the same thing a moment later with a
        message written for a developer. If it fails, the object just uploaded is swept up: the
        row was never written, so nothing points at it and nothing ever will.
      */
      const vRow = validateAppIcon(entry);
      if (!vRow.ok) {
        await removeAppIcon(up.path);
        setMsg({ tone: 'danger', text: vRow.gu });
        return;
      }

      await updateAppSettings({ [APP_ICON_KEY]: entry });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.

      /*
        Only after the row points at the new object. Reversing these two would, on a failed
        save, delete the file the settings row still names — a blank square on every home
        screen, from a save that reported a failure.

        And only the *previous* object, never the one just written. A failure on the line above
        leaves the new object orphaned and it is deliberately left there: a save that failed
        after the write reached Postgres but before the response came back is indistinguishable
        from one that failed before, and deleting the bytes on a maybe-success would turn an
        ambiguous failure into a certain broken icon. An orphaned 40 KB PNG is the cheaper of
        the two mistakes.
      */
      if (inUse.path && inUse.path !== entry.path) await removeAppIcon(inUse.path);

      setFile(null);
      setDims(null);
      if (input.current) input.current.value = '';
      setMsg({
        tone: 'ok',
        text: `Saved as a ${cut.px} x ${cut.px} PNG. Browser tabs and new installs get it right away. Android phones that already have the app update on their own within a day or two, and iPhones that already have it are being asked in the app to remove and re-add it.`,
      });
      onSaved?.();
    } catch (e) {
      /*
        §31 — a failed save leaves the chosen file and his crop exactly where they are and offers
        the button again. A failure must never cost him the placement he just spent a minute on.

        The two the crop raises are named, because saveError() would render them as their own
        identifiers and neither is a database refusal or a network problem: one is a picture too
        detailed to encode small enough even at 192px, and the other is a browser that would not
        give us a canvas at all. Everything else goes to saveError(), which surfaces the trigger's
        own words so a write blocked by 0042 explains itself.
      */
      const kind = String(e?.message || '');
      setMsg({
        tone: 'danger',
        text:
          kind === 'icon-too-detailed'
            ? `That crop will not fit in ${Math.round(APP_ICON_MAX_BYTES / 1024)} KB even at ${APP_ICON_MIN_PX} x ${APP_ICON_MIN_PX}. A photograph with a lot of fine detail does this - zoom in on the murti, or use a simpler image.`
            : kind === 'icon-canvas-unavailable'
              ? 'This browser would not let the panel prepare the image. Try another browser, or upload a square PNG.'
              : saveError(e),
      });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  /**
   * Back to the four files the build ships.
   *
   * `null`, not an empty object and not a deleted key. 0042 accepts JSON null for this field
   * specifically and documents it as the way to clear the icon; `{}` would be refused as an
   * object with no url, and omitting the key from the patch would do nothing at all, because
   * settingsService merges rather than replaces. A સંચાલક who could set a custom icon and never
   * take it back is the shape of trap §31 exists to forbid.
   */
  async function revert() {
    setBusy('revert');
    setMsg(null);
    try {
      await updateAppSettings({ [APP_ICON_KEY]: null });
      // Row first, bytes second — same ordering and the same reason as in save().
      await removeAppIcon(inUse.path);
      setMsg({
        tone: 'ok',
        text: 'The built-in icon is back. It reaches phones exactly the way a new icon does.',
      });
      onSaved?.();
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  /** What the preview is showing: his pick if he has made one, otherwise what is in force. */
  const shown = preview || (inUse.custom ? withVersion(inUse.url, inUse.version) : BUILT_IN_ICON.any512);

  /**
   * The placement, as CSS.
   *
   * Percentages of the frame, straight from the same three numbers the canvas will use. This is
   * why the units in shared/domain/appicon.js are fractions of the square: `offsetX` of 0.25 is
   * `left: 25%` with no conversion, in a box whose pixel width nobody has had to measure, and it
   * stays correct when the card is resized under him.
   *
   * `maxWidth: none` overrides admin.css's global `img { max-width: 100% }`, which is right for
   * every other image in the panel and is exactly wrong for a zoomed crop — it would silently
   * refuse to let the image be bigger than its frame, which is the entire mechanism here.
   */
  const placedImg = {
    position: 'absolute',
    left: `${place.offsetX * 100}%`,
    top: `${place.offsetY * 100}%`,
    width: `${box.width * place.zoom * 100}%`,
    height: `${box.height * place.zoom * 100}%`,
    maxWidth: 'none',
    display: 'block',
    userSelect: 'none',
    // The frame handles the pointer, not the image. Otherwise the first move of a drag is
    // delivered to the <img>, which the browser then tries to drag as a file.
    pointerEvents: 'none',
  };

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>App icon</h2>
        {/* Which of the two it is, in a word: his mark, or the one the build ships. */}
        <StatusBadge tone={inUse.custom ? 'info' : 'off'}>
          {inUse.custom ? 'Custom' : 'Built-in'}
        </StatusBadge>
      </div>

      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        The icon on a yuvak's home screen, in his browser tab, and on the install prompt. Choose{' '}
        <strong>any image</strong> - JPG, PNG or WebP, any shape - then drag and zoom it into the
        square below. It is saved as a {APP_ICON_IDEAL_PX} x {APP_ICON_IDEAL_PX} PNG. Changing it
        needs no deploy.
      </p>

      {/*
        ────────────────────────────────────────────────────────────────────
        The preview, with the crop drawn on it
        ────────────────────────────────────────────────────────────────────

        Two views of one image, side by side, because they answer different questions. The left
        one is the file as uploaded with the safe zone marked on it - the corners outside the
        circle are dimmed, and that dimming is the message. The right one is the same image
        clipped to that circle: what a phone with a round launcher will actually put on the home
        screen.

        `referrerPolicy` is not needed here - these are Supabase Storage and same-origin build
        assets, not lh3 - so it is deliberately absent rather than copied from the darshan
        screens out of habit.
      */}
      <div style={previewRow}>
        <figure style={previewFigure}>
          {/*
            The stage. A drag surface when he has picked something, a plain preview otherwise.

            `role="application"` is deliberately NOT used. This is a group of one image with
            arrow-key behaviour, which `role="img"` plus a label describes honestly; claiming an
            application would make a screen reader hand over every key it has, including the ones
            this does not implement.
          */}
          <div
            ref={stage}
            style={editing ? previewFrameLive : previewFrame}
            onPointerDown={editing ? onPointerDown : undefined}
            onPointerMove={editing ? onPointerMove : undefined}
            onPointerUp={editing ? onPointerUp : undefined}
            onPointerCancel={editing ? onPointerUp : undefined}
            onKeyDown={editing ? onKeyDown : undefined}
            tabIndex={editing ? 0 : undefined}
            role={editing ? 'group' : undefined}
            aria-label={
              editing
                ? 'Position the icon. Arrow keys move it, plus and minus zoom, zero re-centres.'
                : undefined
            }
          >
            {/* Named rather than left empty: which of the three images this is - his pick, the
                icon in force, or the built-in one - is the fact a screen-reader user cannot get
                from the caption, and it is the only fact about the picture that can be put into
                words at all. */}
            <img
              src={shown}
              alt={
                preview
                  ? 'The icon you have chosen'
                  : inUse.custom
                    ? 'The icon in use now'
                    : 'The built-in icon'
              }
              /*
                Two completely different layouts behind one <img>. While he is placing an image
                it is absolutely positioned from `place` and may be far larger than the frame,
                which is what a crop is; with nothing picked it is the old contained preview of
                whatever is in force. `draggable={false}` stops the browser's own image-drag
                ghost from hijacking the first pointer move.
              */
              style={editing ? placedImg : previewImg}
              draggable={false}
            />
            {/* The safe zone. The ring is the boundary; the box-shadow, spreading outward and
                clipped by the frame's overflow, is what dims everything outside it. On a
                browser too old for color-mix the shadow declaration is dropped and the dashed
                ring alone carries the meaning, which is a degradation and not a break. */}
            <div style={safeZone} aria-hidden="true" />
          </div>
          <figcaption className="hint" style={captionStyle}>
            {editing ? (
              <>
                <strong>Drag to move, scroll or use the slider to zoom.</strong> This square is
                exactly what is saved. Everything outside the circle is dimmed - that is the part
                Android is free to cut off.
              </>
            ) : (
              <>
                The whole image. Everything <strong>outside the circle</strong> is dimmed - that
                is the part Android is free to cut off.
              </>
            )}
          </figcaption>
        </figure>

        <figure style={previewFigure}>
          <div style={previewFrame}>
            {/*
              The circle is on a wrapper rather than on the <img>, and that is not tidiness.
              `clip-path` is resolved against the element's own box, and while he is cropping the
              image's box is several times the size of the frame and hanging off three sides of
              it - a circle at 40% of that is somewhere out in the middle of his photograph. The
              wrapper is always exactly the frame, so the circle is always the launcher's.

              It also keeps the frame's own border square and visible around the round icon,
              which is what tells the eye that this is a mask and not a differently-shaped box.
            */}
            <div style={roundMask}>
              {/* Empty alt, deliberately: this is the same image again, and announcing it twice
                  would tell a screen-reader user there are two icons. The caption below carries
                  everything this second view adds. */}
              <img src={shown} alt="" style={editing ? placedImg : previewImg} draggable={false} />
            </div>
          </div>
          <figcaption className="hint" style={captionStyle}>
            The same image on a round launcher. Every Android phone crops a home-screen icon to
            its own shape - a circle, a squircle, a rounded square - and only the middle is
            certain to survive.
          </figcaption>
        </figure>
      </div>

      {/*
        The zoom, and the way back to where he started.

        A slider rather than only the wheel, because a trackpad's wheel is a scroll gesture the
        browser may claim first, and because a control that can be seen is how somebody finds out
        that zooming is possible at all. It is logarithmic: APP_ICON_ZOOM_MIN to 1 takes the
        left half and 1 to APP_ICON_ZOOM_MAX the right, so a step of the thumb is the same
        proportional change everywhere instead of being a lurch at the bottom and nothing at the
        top.
      */}
      {editing && (
        <div className="field" style={zoomRow}>
          <label htmlFor="appIconZoom" style={zoomLabel}>
            Zoom
          </label>
          <input
            id="appIconZoom"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={zoomToSlider(place.zoom)}
            onChange={(e) => zoomTo(sliderToZoom(Number(e.target.value)))}
            disabled={!mayEdit || Boolean(busy)}
            style={zoomSlider}
            aria-describedby="appIconZoom-help"
          />
          <span className="mono hint" style={zoomValue}>
            {place.zoom.toFixed(2)}x
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setPlace(centredIconPlacement({ width: dims.width, height: dims.height }))}
            disabled={!mayEdit || Boolean(busy)}
          >
            Re-centre
          </button>
          <span className="hint" id="appIconZoom-help" style={{ flexBasis: '100%' }}>
            At <span className="mono">1.00x</span> the whole picture fills the square. Zoom out
            below that and the spare room around it is saved as transparent.
          </span>
        </div>
      )}

      <p className="card-note">
        Keep the murti and any writing inside the circle. Nothing is cropped for you - the square
        above is the square that is saved, and where the image sits in it is yours to decide.
      </p>

      {/*
        The current file, named. `path` rather than the URL, because the URL is 120 characters
        of Supabase host and the path is the thing that appears in the bucket.
      */}
      {inUse.custom && (
        <div className="field">
          <span className="hint mono" style={{ wordBreak: 'break-all' }}>
            {inUse.path || inUse.url}
            {inUse.size ? ` · ${bytes(inUse.size)}` : ''} · version {inUse.version}
            {inUse.updatedAt ? ` · saved ${dateTimeGu(inUse.updatedAt)}` : ''}
          </span>
        </div>
      )}

      <div className={`field${error ? ' is-invalid' : ''}`}>
        <label htmlFor="appIconFile">{inUse.custom ? 'Replace the icon' : 'Icon image'}</label>
        <input
          id="appIconFile"
          ref={input}
          type="file"
          /*
            Any raster the browser can decode. It was `image/png` and that is the single change
            that made the rest of this card necessary: the picker itself used to grey out the
            photograph he had, before he could even find out why.

            The stored format is unchanged — the crop is re-encoded as PNG — so this widens what
            he may bring, not what reaches a phone. `image/*` rather than the explicit
            APP_ICON_SOURCE_MIME list, because a `accept` list is a filter on a dialog and not a
            rule: a phone-camera format nobody has heard of yet should be allowed to try and be
            judged by whether it decodes, which is the only test that means anything.
          */
          accept="image/*"
          disabled={!mayEdit || Boolean(busy)}
          onChange={(e) => pick(e.target.files?.[0] || null)}
          aria-describedby="appIconFile-help"
          aria-invalid={error ? 'true' : undefined}
          // width:100% so the browser's own "No file chosen" caption wraps inside the card
          // instead of widening the page on a narrow window.
          style={fileInput}
        />
        <span className="hint" id="appIconFile-help">
          Any image, any shape - up to{' '}
          <span className="mono">{Math.round(APP_ICON_SOURCE_MAX_BYTES / (1024 * 1024))} MB</span>,
          with its shorter side at least{' '}
          <span className="mono">
            {APP_ICON_MIN_PX} px
          </span>
          .{' '}
          {file && dims
            ? `Chosen: ${file.name} · ${dims.width} x ${dims.height} · ${bytes(file.size)}`
            : 'The same image is used for the tab, the home screen and the install prompt.'}{' '}
          What is stored is the square you place above, re-encoded as a PNG under{' '}
          <span className="mono">{Math.round(APP_ICON_MAX_BYTES / 1024)} KB</span> - that limit
          and the PNG format are enforced by the database and by the storage bucket as well as
          here, so nothing outside the rules can be stored by any route.
          {rendered ? ` Last saved crop: ${rendered.px} x ${rendered.px} · ${bytes(rendered.size)}.` : ''}
        </span>
        {error && (
          <span className="field-error" role="alert">
            <span aria-hidden="true">⚠</span> {error}
          </span>
        )}
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy === 'save' ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || Boolean(busy) || !changed}
        >
          {busy === 'save' ? 'Saving…' : 'Save icon'}
        </button>
        {/* Offered only when there is something to go back from. Confirmed, because it deletes
            the uploaded file as well as the setting — see the dialog at the foot of the card. */}
        {inUse.custom && (
          <button
            className={`btn btn-quiet${busy === 'revert' ? ' is-busy' : ''}`}
            type="button"
            onClick={() => setConfirm(true)}
            disabled={!mayEdit || Boolean(busy)}
          >
            {busy === 'revert' ? 'Removing…' : 'Use the built-in icon'}
          </button>
        )}
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {/* §31 — a failed save must offer the way out of it, on the spot. The retry re-runs
            exactly the call that failed; the revert skips the dialog, because the decision was
            already taken and asking twice for one decision teaches him to click through it. */}
        {msg?.tone === 'danger' && (
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            onClick={busy === 'revert' ? revert : save}
            disabled={Boolean(busy)}
          >
            Try again
          </button>
        )}
      </div>

      {/*
        ────────────────────────────────────────────────────────────────────
        What a saved icon actually reaches, and when
        ────────────────────────────────────────────────────────────────────

        The most important paragraph on the card, and the reason it is written out in full
        rather than summarised: every line below is a platform limit, not a thing better code
        would fix, and a સંચાલક who is not told will report each of them as a bug. The iPhone
        line especially is not softened - it is the one case that never resolves itself, and
        pretending otherwise would have him waiting for something that is never coming.
      */}
      <div className="notice" role="note" style={{ marginTop: 'var(--sp-5)' }}>
        <p style={noticeHead}>When a new icon reaches a phone</p>
        <ul style={limitList}>
          <li>
            <strong>Browser tabs, and anyone who has not installed the app:</strong> changes on
            the next load.
          </li>
          <li>
            <strong>Any new install:</strong> gets the new icon immediately.
          </li>
          <li>
            <strong>Android, already installed:</strong> updates on its own within a day or two -
            Chrome re-reads the manifest about once a day. Nobody needs to do anything.
          </li>
          <li>
            <strong>iPhone, already installed:</strong> the icon cannot be changed. iOS copies it
            once when the app is added to the home screen and never looks again. Those users are
            shown a notice in the app asking them to remove and re-add it.
          </li>
        </ul>
      </div>

      {/* §57 — nothing two thousand people will see changes on a single click. The save itself
          is not behind a dialog: the preview above, with the crop drawn on it, is a better
          confirmation than a sentence, and it is on screen the whole time he is deciding.
          This one is, because it deletes the uploaded file as well as the setting. */}
      <ConfirmDialog
        open={confirm}
        title="Go back to the built-in icon?"
        body="The uploaded image is deleted from storage as well, so it would have to be uploaded again to come back. Phones pick this up the same way they pick up a new icon."
        confirmLabel="Use the built-in icon"
        danger
        busy={busy === 'revert'}
        onConfirm={revert}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants.
 *
 * Module scope, so React is not handed a fresh style object on every keystroke and every
 * decode. Every value is a token or a plain geometric ratio: nothing here may invent a colour,
 * a radius or a gap (admin.css, "HOW TO USE THIS FILE").
 * ------------------------------------------------------------------------- */

const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};

/**
 * How wide one preview is.
 *
 * Big enough that the writing on a typical મૂર્તિ mark is legible at the edge of the safe zone,
 * small enough that two of them fit beside each other in a card on a laptop. A raw pixel number
 * rather than a token because admin.css has no size token for an image box and this is a
 * dimension rather than a colour, a radius or a gap.
 */
const PREVIEW_PX = 168;

/** The two previews sit side by side and wrap under each other on a narrow window rather than
 *  shrinking: an icon preview that has been squeezed to 60px is no longer showing him anything. */
const previewRow = {
  display: 'flex',
  gap: 'var(--sp-5)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-4)',
};

const previewFigure = { width: PREVIEW_PX, maxWidth: '100%', margin: 0 };

/**
 * The square the icon is drawn in.
 *
 * `overflow: hidden` is load-bearing rather than tidy: the safe-zone ring dims its surroundings
 * with a box-shadow that spreads far past the frame, and this is what clips it back to the
 * icon's own square.
 *
 * The checkerboard-free sunken surface behind it is deliberate - a PNG for an app icon is
 * expected to have transparency, and a solid neutral shows what the launcher will show
 * (a shape on a background) rather than what a design tool shows (a shape on a grid).
 */
const previewFrame = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  overflow: 'hidden',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-sunken)',
};

/**
 * The same square, while he is placing an image in it.
 *
 * `touchAction: none` is the one line without which this does not work on a phone or a
 * touchscreen laptop at all: the browser claims a one-finger drag as a page scroll before any
 * pointermove is delivered, so the icon would simply refuse to move while the page slid about
 * underneath it. `cursor: grab` and the focus ring are what say it is draggable at all — the
 * outline is the panel's own focus token, so a keyboard user gets the same ring here as on
 * every other control.
 */
const previewFrameLive = {
  ...previewFrame,
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
};

const previewImg = { display: 'block', width: '100%', height: '100%', objectFit: 'contain' };

/** The safe circle, as a mask over the whole frame — what a round launcher puts on the home
 *  screen. On the frame's own box rather than on the image, for the reason given where it is
 *  used: a cropped image's box is much larger than the frame and a circle cut from it would be
 *  in the wrong place and the wrong size. */
const roundMask = {
  position: 'absolute',
  inset: 0,
  clipPath: 'circle(40% at 50% 50%)',
};

/* ---- the zoom control ------------------------------------------------------ */

/**
 * The slider is logarithmic, and the thousand steps are its resolution rather than a unit.
 *
 * A linear slider over 0.25 to 6 spends five sixths of its travel above 1x, where the picture
 * is already too close to be useful, and crosses the whole of the useful range in the first
 * centimetre. Working in logs makes one step of the thumb the same *proportional* change
 * wherever it is, which is how a zoom is actually used.
 */
const ZOOM_LO = Math.log(APP_ICON_ZOOM_MIN);
const ZOOM_HI = Math.log(APP_ICON_ZOOM_MAX);

function zoomToSlider(zoom) {
  const z = Math.min(APP_ICON_ZOOM_MAX, Math.max(APP_ICON_ZOOM_MIN, Number(zoom) || 1));
  return Math.round(((Math.log(z) - ZOOM_LO) / (ZOOM_HI - ZOOM_LO)) * 1000);
}

function sliderToZoom(value) {
  const v = Math.min(1000, Math.max(0, Number(value) || 0));
  return Math.exp(ZOOM_LO + (v / 1000) * (ZOOM_HI - ZOOM_LO));
}

/** Label, slider, the figure, and the way back - one line that wraps to two on a narrow card.
 *  The help text under it takes `flexBasis: 100%` so it always starts a line of its own. */
const zoomRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-4)',
};

const zoomLabel = { marginBottom: 0, flex: '0 0 auto' };

/** Grows to fill the row but never below a width where the thumb still has somewhere to travel;
 *  under that it wraps onto its own line instead. */
const zoomSlider = { flex: '1 1 160px', minWidth: 0 };

/** Fixed enough that the row does not jog left and right as the figure changes width while he
 *  drags the thumb. */
const zoomValue = { flex: '0 0 auto', minWidth: '3.5em', textAlign: 'end' };

/**
 * The maskable safe zone: a circle of 80% diameter, centred — which is 10% inset on each side.
 *
 * The ring marks the boundary and the outward box-shadow dims everything beyond it. The shadow
 * is a spread with no blur and no offset, so it is a flat wash rather than a glow, and it is
 * clipped by the frame above.
 *
 * `color-mix` is the only way to express "this token, but see-through" without inventing a
 * colour admin.css does not own. A browser that does not understand it drops the whole
 * box-shadow declaration and the dashed ring still says what it needs to say.
 *
 * Two rings rather than one, and they are two tokens apart on purpose: an uploaded મૂર્તિ can be
 * pale or dark and a single hairline would vanish into one of them. `border` draws the light
 * ring on the image side, `outline` the dark ring immediately outside it, so the boundary is
 * legible over anything.
 */
const safeZone = {
  position: 'absolute',
  inset: '10%',
  // 50%, not --r-full: a token pill radius on a square box happens to produce a circle, but
  // "half of each side" is what a circle actually is and it stays one at any preview width.
  borderRadius: '50%',
  border: '1px dashed var(--text-invert)',
  outline: '1px dashed var(--text-strong)',
  boxShadow: '0 0 0 999px color-mix(in srgb, var(--text-strong) 55%, transparent)',
  pointerEvents: 'none',
};

const captionStyle = { display: 'block', marginTop: 'var(--sp-2)' };

const fileInput = { width: '100%', minHeight: 'var(--tap)' };

const noticeHead = {
  fontWeight: 'var(--fw-semi)',
  color: 'var(--text-strong)',
  marginBottom: 'var(--sp-2)',
};

/** Inside the list marker rather than outside it, so a wrapped line stays under its own bullet
 *  instead of running back under the marker column. */
const limitList = {
  margin: 0,
  paddingInlineStart: 'var(--sp-5)',
  display: 'grid',
  gap: 'var(--sp-2)',
};
