import { useEffect, useState } from 'react';
import {
  DEFAULT_SESSION,
  SESSION_KEY,
  SESSION_MAX_HOURS,
  SESSION_MIN_HOURS,
  resolveSessionPolicy,
  validateSessionPolicy,
} from '../../../../../shared/domain/session.js';
import { updateAppSettings } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { saveError } from '../../../lib/errors';

/**
 * How long a signed-in session lasts before the app makes a યુવક start a fresh one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a card exists for a setting nobody asked for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * An installed app is not a browser tab. It is opened and closed for weeks without ever being
 * *loaded*: the service worker serves the shell it cached, the document survives in the
 * background, and a phone that installed in June is still running June's JavaScript in August.
 * Every server-side change made since - a new icon, a new bottom bar, new point rules - sits
 * waiting for a load that does not come.
 *
 * This is the lever that makes a load happen. It is on the same page and in the same row as the
 * app icon above it deliberately: shipping the icon setting without this one would produce a
 * panel that reports "Saved" while two thousand home screens keep the old mark for months,
 * which is worse than not having the setting at all - a control that appears to work.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the card is so blunt about the cost
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Expire" here means the Supabase session is **ended and the યુવક signs in again**. It is not
 * a silent token refresh - `autoRefreshToken` already keeps a live session alive indefinitely,
 * and this deliberately overrides it. At 24 hours, every યુવક in the સંઘ types his SMK and his
 * password once a day.
 *
 * That is a number which is easy to type and impossible to take back quietly: two thousand
 * people meet it at once, most of them on a phone, several of them having forgotten the
 * password. So the consequence is stated in one sentence in the largest words the card has,
 * next to the switch, and it is not softened into "users may occasionally be asked to sign in".
 * They will not occasionally be asked. They will all be signed out, every N hours, forever.
 *
 * Off by default, for the same reason: `DEFAULT_SESSION.enabled` is false, so the deploy that
 * introduced this changed nothing for anybody.
 */
export default function SessionCard({ session, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * Same split as the rest of this page: `settings.read` opens the card, `settings.update`
   * moves the switch. Disabled rather than hidden - whether sessions expire, and after how
   * long, is exactly the fact a VIEWER fielding "why does it keep logging me out?" needs to be
   * able to read. The check that matters is the RLS policy on `settings`; this is only where it
   * becomes visible.
   */
  const mayEdit = can('settings.update');

  /*
    Through the same resolver the યુવક app uses, never a looser read of this panel's own. The
    card has to show what is actually in force - including when the stored row is one this panel
    would not have written, which is exactly when the difference matters. resolveSessionPolicy()
    clamps an out-of-range number rather than switching the policy off, so `inUse.hours` is
    always a number this field can legitimately hold.
  */
  const inUse = resolveSessionPolicy(session);

  const [enabled, setEnabled] = useState(DEFAULT_SESSION.enabled);
  /*
    Held as a string, not a number - the same argument GalleryCard's interval makes.

    A number-typed state forces a decision about what `Number('')` means on every keystroke, and
    the answer it gives is 0. Here that answer is worse than wrong: zero is not a short session,
    it is a login screen that reappears on every foreground, and an empty box must read as
    "nothing typed yet" rather than as that.
  */
  const [hours, setHours] = useState(String(DEFAULT_SESSION.hours));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  // The rule is shown as a hint before the first edit and as an error only after one. A field
  // that is red the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  /*
    Keyed on the two resolved values rather than on the `session` prop, which is a fresh object
    on every read of the settings row and would fight the સંચાલક for his cursor.
  */
  useEffect(() => {
    setEnabled(inUse.enabled);
    setHours(String(inUse.hours));
    setTouched(false);
    setMsg(null);
  }, [inUse.enabled, inUse.hours]);

  /*
    The same shared rule the save runs, evaluated as he types so the message arrives at the
    keystroke that caused it. Display only - save() validates again and is the authority,
    because a live check that drifted from the saved one would be a second answer to one
    question, which is what shared/domain/session.js exists to prevent.

    The trim-and-test rather than a bare Number(): `Number(' ')` and `Number('')` are both 0, and
    0 is the one value on this field that must never be produced by an empty box.
  */
  const text = hours.trim();
  const parsed = text === '' || !/^\d+$/.test(text) ? NaN : Number(text);
  const draft = { enabled, hours: parsed };
  const check = validateSessionPolicy(draft);
  const error = touched && !check.ok ? check.gu : '';
  // Nothing to save when the form already holds what is in force: re-saving writes a settings
  // row and files an audit entry for a change that did not happen (§41).
  const changed = check.ok && (enabled !== inUse.enabled || parsed !== inUse.hours);

  /*
    The number the warning quotes.

    His draft while it is a usable number, and what is in force otherwise - so the sentence never
    reads "every NaN hours" mid-keystroke, and never quotes a number he has already replaced.
  */
  const warnHours = Number.isFinite(parsed) ? parsed : inUse.hours;

  async function save() {
    const v = validateSessionPolicy({ enabled, hours: parsed });
    if (!v.ok) {
      setTouched(true);
      setMsg({ tone: 'danger', text: v.gu });
      setConfirm(false);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      /*
        Both halves together, always. The hours are stored even when the switch is off - which
        is what lets him toggle the policy back on and find the number he last chose, exactly as
        the લેવલ ૪ gate keeps its threshold across a switched-off gate - and 0042 validates them
        either way, because that is the value that comes into force the instant somebody flips
        the switch.
      */
      await updateAppSettings({ [SESSION_KEY]: { enabled: v.enabled, hours: v.hours } });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.
      setMsg({
        tone: 'ok',
        text: v.enabled
          ? `Saved. Every yuvak will now be signed out every ${v.hours} hours, and the app reloads itself when he signs in again.`
          : 'Saved. Sessions no longer expire - nobody is signed out automatically.',
      });
      onSaved?.();
    } catch (e) {
      // §31 - a failed save leaves the typing where it is and offers the button again.
      // `saveError` surfaces the trigger's own message, which names the bound, so a write
      // refused by 0042 explains itself rather than arriving as "something went wrong".
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  /*
    Confirmed only when the save leaves the policy switched ON.

    Turning it off, or shortening it while it is already off, costs nobody anything and a dialog
    there would be one more thing to click through - which is how a confirmation stops being
    read. Turning it on, or changing the number while it is on, is felt by every યુવક in the સંઘ
    on his next visit, which is precisely what §57 asks to be put behind a second press.
  */
  const needsConfirm = enabled;

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>Automatic sign-out</h2>
        {/* Which of the two it is, in a word. Colour is never the only signal - the word in the
            badge says the same (§43). */}
        <StatusBadge tone={inUse.enabled ? 'warn' : 'off'}>
          {inUse.enabled ? `On - every ${inUse.hours} hours` : 'Off'}
        </StatusBadge>
      </div>

      {/*
        What it is FOR, before what it costs.

        Without this paragraph the card reads as a security setting somebody added out of habit,
        and the reasonable response to a security setting nobody asked for is to leave it alone.
        It is not a security setting. It is the delivery mechanism for every other setting in
        this panel, and that has to be said before the switch is worth looking at.
      */}
      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        An installed app can go weeks without ever loading new code. This gives a session a
        maximum age - the next time a yuvak opens the app after that, it signs him out and loads
        the newest version. It is how a new icon, a new bottom bar or new point rules actually
        reach a phone that is already installed.
      </p>

      <div className="field">
        {/* .check gives the whole row `min-height: var(--tap)`, so the label and the box are one
            target big enough for a thumb rather than a 16px square. */}
        <label className="check" htmlFor="sessionOn">
          <input
            id="sessionOn"
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setTouched(true);
              setMsg(null);
            }}
            disabled={!mayEdit || busy}
            aria-describedby="sessionOn-help"
          />
          Sign a yuvak out after a set time
        </label>
        <span className="hint" id="sessionOn-help">
          Off by default, and off is what the app did before this setting existed. In use now:{' '}
          <span className="mono">
            {inUse.enabled ? `on, every ${inUse.hours} hours` : 'off'}
          </span>
          .
        </span>
      </div>

      {/*
        ────────────────────────────────────────────────────────────────────
        The cost, stated once, in the plainest sentence available
        ────────────────────────────────────────────────────────────────────

        Shown only while the switch is ticked, so it is a consequence of what he has just done
        rather than a standing warning he learns to read past. It quotes his own number, because
        "every 24 hours" and "every 720 hours" are very different decisions and a generic
        sentence would flatten them into one.

        It is deliberately not phrased as "users may need to sign in again". They will. All of
        them. On the schedule in the box below.
      */}
      {enabled && (
        <div className="notice notice-warn" role="status">
          <strong>Every yuvak will have to sign in again every {warnHours} hours.</strong> SMK and
          password, mostly on a phone, for everybody at once. There is no way to exempt anyone,
          and nobody is warned in advance - the login screen is simply what he finds the next
          time he opens the app.
        </div>
      )}

      <div className={`field${error ? ' is-invalid' : ''}`}>
        <label htmlFor="sessionHours">Session length</label>
        <input
          id="sessionHours"
          type="number"
          inputMode="numeric"
          min={SESSION_MIN_HOURS}
          max={SESSION_MAX_HOURS}
          step={1}
          value={hours}
          onChange={(e) => {
            setHours(e.target.value);
            setTouched(true);
            setMsg(null);
          }}
          /*
            Editable even while the switch is off, and that is a decision rather than an
            oversight. The number is stored either way and comes into force the instant somebody
            flips the switch, so the moment to get it right is while he is deciding - not after.
            0042 validates it on a switched-off row for exactly the same reason.
          */
          disabled={!mayEdit || busy}
          aria-describedby="sessionHours-help"
          aria-invalid={error ? 'true' : undefined}
          style={{ maxWidth: '10rem' }}
        />
        <span className="hint" id="sessionHours-help">
          Hours, between <span className="mono">{SESSION_MIN_HOURS}</span> and{' '}
          <span className="mono">{SESSION_MAX_HOURS}</span> (thirty days). In use now:{' '}
          <span className="mono">{inUse.hours}h</span>
          {inUse.enabled ? '' : ' (stored, but not in force while the switch above is off)'}. The
          range is enforced by the database as well as here, so a value outside it cannot be
          stored by any route.
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
          onClick={() => (needsConfirm ? setConfirm(true) : save())}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {/* §31 - a failed save must offer the way out of it, on the spot. The second attempt
            skips the dialog: it was already confirmed, and asking twice for one decision teaches
            him to click through it. */}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      {/*
        Two questions this setting raises that the field cannot answer, and that a સંચાલક will
        otherwise answer for himself incorrectly.

        The first: it does not sign anybody out in the middle of anything. The check runs when
        the app is brought to the foreground, so the sign-in lands at the moment he was opening
        the app anyway - not halfway through a લેવલ ૪ test.

        The second: nothing is lost. Progress, points and answers live in the database, not in
        the session, so a sign-out costs a login and nothing else. Left unsaid, "signs him out"
        reads as "loses his place", which is the reason this setting would never be switched on.
      */}
      <p className="card-note">
        The check happens when the app is opened, not while it is being used - nobody is
        interrupted halfway through a test. Nothing is lost either way: progress, points and
        answers are stored on the server, so signing in again picks up exactly where he was.
      </p>

      {/* §57 - nothing two thousand people will feel changes on a single click. The dialog
          repeats the number rather than saying "are you sure": the number is the decision, and
          a confirmation that does not restate it is a confirmation of nothing. */}
      <ConfirmDialog
        open={confirm}
        title={inUse.enabled ? 'Change the session length?' : 'Sign every yuvak out on a schedule?'}
        body={`Every yuvak will have to sign in again every ${warnHours} hours, from his next visit onward. Nothing is lost - progress and points are on the server - but he will meet a login screen he did not meet before.`}
        confirmLabel={inUse.enabled ? 'Save the new length' : 'Turn it on'}
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants - module scope so no fresh style object is created per keystroke.
 * Tokens only; admin.css owns every value.
 * ------------------------------------------------------------------------- */

const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
