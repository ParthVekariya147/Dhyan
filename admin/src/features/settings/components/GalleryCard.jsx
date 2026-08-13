import { useEffect, useState } from 'react';
import {
  DEFAULT_SLIDESHOW,
  SLIDESHOW_KEY,
  SLIDESHOW_MAX_SECONDS,
  SLIDESHOW_MIN_SECONDS,
  resolveSlideshow,
  validateSlideshow,
} from '../../../../../shared/domain/settings.js';
import { updateAppSettings } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * How long લેવલ ૨'s fullscreen દર્શન holds each દ્રશ્ય on આપોઆપ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a setting at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The gallery's આપોઆપ advances by itself once a યુવક has started it. How long it waits is
 * not a fact about the code — it is a judgement about how long a દ્રશ્ય wants to be looked
 * at, and the only person in a position to make it is the one who can watch a room of યુવકો
 * and see whether six seconds is hurried. So it is his, and changing it needs no deploy
 * (§62).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it is a card of its own
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It is a field of settings/app exactly as the app name is, which is the argument for
 * putting it in the General card above — and that argument was followed for `tickWord`. The
 * difference here is that this one has a **bound the database enforces** (0018), so it has a
 * refusal path of its own: a save can come back rejected by a trigger, and the message has to
 * land next to the field that caused it rather than under a Save button shared with the
 * maintenance message. DhunCard and DriveFolderCard are separate for the same shape of
 * reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this cannot do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It cannot start a slideshow. આપોઆપ never runs until a યુવક presses it — this only says how
 * long each દ્રશ્ય is held once he has. It also changes nothing about લેવલ ૨'s progress,
 * લેવલ ૩ or લેવલ ૪: the gallery records nothing at all.
 */
export default function GalleryCard({ slideshow, onSaved }) {
  const { can } = useAdminAuth();
  /**
   * Same split as the rest of this page: `settings.read` opens the card, `settings.update`
   * moves the number. Disabled rather than hidden — what the interval currently is remains
   * the useful fact on this card, and a VIEWER asked "why is the દર્શન so fast?" should be
   * able to read the answer. The check that matters is the RLS policy on `settings`; this is
   * only where it becomes visible.
   */
  const mayEdit = can('settings.update');

  /*
    Held as a string, not a number.

    A number-typed state forces a decision about what `Number('')` means on every keystroke,
    and the answer it gives — 0 — is a value this field must refuse. Keeping the raw text
    lets an empty box be an empty box: not yet a number, and not silently a zero-second
    slideshow.
  */
  const [value, setValue] = useState(String(DEFAULT_SLIDESHOW.seconds));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The rule is shown as a hint before the first edit and as an error only after one. A field
  // that is red the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  /*
    Through the same resolver the યુવક app uses, never a looser read of this panel's own. The
    field has to show what is actually in force — including when the stored value is one this
    panel would not have written, which is exactly when the difference matters.
  */
  const inUse = resolveSlideshow(slideshow).seconds;

  useEffect(() => {
    setValue(String(inUse));
    setTouched(false);
    setMsg(null);
  }, [inUse]);

  /*
    The same shared rule the save runs, evaluated as he types so the message arrives at the
    keystroke that caused it. Display only — save() validates again and is the authority,
    because a live check that drifted from the saved one would be a second answer to one
    question, which is what shared/domain/settings.js exists to prevent.

    The trim-and-test rather than a bare Number(): `Number(' ')` is 0 and `Number('')` is 0,
    and a blank box must read as "nothing typed yet", not as a zero-second slideshow.
  */
  const text = value.trim();
  const parsed = text === '' || !/^\d+$/.test(text) ? NaN : Number(text);
  const check = validateSlideshow({ seconds: parsed });
  const error = touched && !check.ok ? check.gu : '';
  // Nothing to save when the box already holds what is in force: re-saving writes a settings
  // row and files an audit entry for a change that did not happen (§41).
  const changed = check.ok && parsed !== inUse;

  async function save() {
    const v = validateSlideshow({ seconds: parsed });
    if (!v.ok) {
      setTouched(true);
      setMsg({ tone: 'danger', text: v.gu });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await updateAppSettings({ [SLIDESHOW_KEY]: { seconds: v.seconds } });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.
      setMsg({ tone: 'ok', text: `Saved. The slideshow now holds each Darshan for ${v.seconds}s.` });
      onSaved?.();
    } catch (e) {
      // §31 — a failed save leaves the typing where it is and offers the button again.
      // `saveError` surfaces the trigger's own message, which names the bound, so a write
      // refused by 0018 explains itself rather than arriving as "something went wrong".
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>Gallery slideshow</h2>
        {/* Which of the two it is, in a word: his number, or the built-in one. */}
        <StatusBadge tone={inUse === DEFAULT_SLIDESHOW.seconds ? 'off' : 'info'}>
          {inUse === DEFAULT_SLIDESHOW.seconds ? 'Built-in default' : 'Custom'}
        </StatusBadge>
      </div>

      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        Level 2 opens a Darshan full screen when a yuvak taps it, with an{' '}
        <strong>આપોઆપ</strong> button that steps through the collection on its own. This is how
        long each Darshan is held. It never starts by itself - the yuvak presses it - and it
        stops at the last Darshan rather than looping.
      </p>

      <div className={`field${error ? ' is-invalid' : ''}`}>
        <label htmlFor="slideshowSeconds">Slideshow interval</label>
        <input
          id="slideshowSeconds"
          type="number"
          inputMode="numeric"
          min={SLIDESHOW_MIN_SECONDS}
          max={SLIDESHOW_MAX_SECONDS}
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
            setMsg(null);
          }}
          disabled={!mayEdit || busy}
          aria-describedby="slideshowSeconds-help"
          aria-invalid={error ? 'true' : undefined}
          style={{ maxWidth: '10rem' }}
        />
        <span className="hint" id="slideshowSeconds-help">
          Seconds, between <span className="mono">{SLIDESHOW_MIN_SECONDS}</span> and{' '}
          <span className="mono">{SLIDESHOW_MAX_SECONDS}</span>. In use now:{' '}
          <span className="mono">{inUse}s</span>
          {inUse === DEFAULT_SLIDESHOW.seconds ? ' (built-in default)' : ''}. The range is
          enforced by the database as well as here, so a value outside it cannot be stored by
          any route.
        </span>
        {error && (
          <span className="field-error" role="alert">
            <span aria-hidden="true">⚠</span> {error}
          </span>
        )}
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save interval'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      {/*
        Said here because it is the question this number raises and the panel cannot answer it
        from the number alone: a short interval on a slow connection does not produce a fast
        slideshow, it produces a slideshow waiting on images. The viewer starts each dwell
        only once the picture is actually on screen, so the effective pace on a poor network
        is the download, not this field.
      */}
      <p className="card-note">
        Each interval is counted from the moment the picture has arrived, not from when it was
        requested - so on a slow connection the slideshow paces itself rather than skipping
        past Darshan a yuvak has not seen yet.
      </p>
    </div>
  );
}

/* Layout constant at module scope — a fresh object per keystroke is a re-render nobody
 * asked for. Tokens only; admin.css owns every value. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
