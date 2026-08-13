import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { TextField } from '../components/Field';
import {
  NEUTRAL_SENT_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  cooldownRemaining,
  neutralOutcome,
  validateRecoveryEmail,
} from '../../shared/domain/recovery.js';
import { gu } from '../lib/constants';
import '../styles/forms.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — પાસવર્ડ ભૂલી ગયા? (/forgot-password)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Ask Supabase to mail a recovery link, and say so in a way that reveals
 *                nothing about who has an account here.
 * Visible        One field, one primary button, one way back to લોગિન. After sending: a
 *                success panel with a resend that is held shut for a minute.
 * Actions        Send the mail. Send it again. Go back to લોગિન.
 * Persisted      Nothing on the server that this page can see. One timestamp in
 *                sessionStorage, holding the resend button - see below.
 * Next           Nowhere, on its own. §5 forbids moving him off this screen automatically:
 *                he is about to leave for his mail app and must be able to come back to a
 *                page that still says what happened.
 * Excluded       Any password field, any mobile number, any statement about whether the
 *                address he typed exists.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one thing this page is really for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Not sending the mail - `resetPasswordForEmail` does that in one line. It is saying the
 * same sentence afterwards no matter what happened. This project already refuses to leak
 * which mobile numbers are registered (netlify/functions/login-mobile.js returns one WRONG
 * body for "no such number" and for "wrong password"), and a reset form that answered "આ
 * ઈમેલ રજીસ્ટર નથી" would hand back through the front door exactly what that function is
 * written to withhold. So there is one success branch and it is reached by both an address
 * that exists and one that does not - `neutralOutcome()` in shared/domain/recovery.js holds
 * that, and scripts/test-recovery.mjs asserts it as a constant rather than as a behaviour.
 *
 * The only two things a યુવક is told apart from that sentence are about *him*: the net is
 * down, or he has asked too many times. Neither says anything about any account.
 */

/**
 * Where the resend cooldown is remembered across a reload.
 *
 * sessionStorage rather than state alone, because the realistic sequence is: send, switch
 * to the mail app, come back, and the browser has reloaded the tab. Without this, that
 * round trip is a free resend, and enough of them walk into Supabase's own per-address
 * limit - at which point he is genuinely locked out for far longer than a minute by the
 * server, with nothing on screen having warned him.
 *
 * sessionStorage and not localStorage: this is a wait, not a preference, and it has no
 * business outliving the tab on a shared phone.
 */
const COOLDOWN_KEY = 'varni:reset-sent-at';

const readSentAt = () => {
  try {
    return Number(sessionStorage.getItem(COOLDOWN_KEY)) || 0;
  } catch {
    // Private mode. The in-memory countdown below still runs for this page view; only
    // surviving a reload is lost, and that is the right thing to give up first.
    return 0;
  }
};

const writeSentAt = (at) => {
  try {
    sessionStorage.setItem(COOLDOWN_KEY, String(at));
  } catch {
    /* see readSentAt */
  }
};

export default function ForgotPassword() {
  const { resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => cooldownRemaining(readSentAt(), Date.now()));

  /*
    The duplicate-click guard, and it is a ref rather than `busy` on purpose.

    `busy` is state, so two taps inside one React batch both read it as false and both send.
    That is not theoretical on a phone: a tap that the browser also delivers as a click, or
    an impatient double tap, arrives well inside a single commit. The ref is written
    synchronously and so is read by the second call as already true.

    `disabled={busy}` on the button stays, because it is what the યુવક can see. This is what
    makes it true.
  */
  const inFlight = useRef(false);

  /*
    One interval while a cooldown is running, and none when it is not.

    Driven off the stored timestamp rather than by decrementing a counter, so a tab that was
    backgrounded - where timers are throttled to once a minute or paused outright - shows the
    right number when it comes back instead of resuming a count it stopped making.
  */
  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setInterval(() => {
      setLeft(cooldownRemaining(readSentAt(), Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [left]);

  const send = useCallback(
    async (address) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setFormError('');

      try {
        await resetPassword(address);
        /*
          §3 - the success path and the "no such address" path are THIS line, together.
          `resetPassword` resolves for both, and `neutralOutcome(null)` below returns the
          same object it returns for an error nobody anticipated.
        */
        const at = Date.now();
        writeSentAt(at);
        setLeft(RESEND_COOLDOWN_SECONDS);
        setSent(true);
      } catch (err) {
        const outcome = neutralOutcome(err);
        if (outcome.sent) {
          // A refused SMTP relay, a Supabase error we have never seen: still the neutral
          // sentence, because telling those apart from "unknown address" is telling accounts
          // apart. The cooldown is started all the same - whatever went wrong, hammering it
          // is not the fix.
          const at = Date.now();
          writeSentAt(at);
          setLeft(RESEND_COOLDOWN_SECONDS);
          setSent(true);
        } else {
          // Network or throttle. Both are about him, not about any account, and both leave
          // him on the form with the address still typed so one tap retries.
          setFormError(outcome.message);
        }

        /*
          §27 - what may be logged, and what may not. The kind is a category with no address
          in it; the error object is not logged at all, because Supabase puts the address it
          was called with into some of its messages.
        */
        if (import.meta.env.DEV) console.warn('password recovery request failed:', outcome.kind);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [resetPassword]
  );

  async function submit(ev) {
    ev.preventDefault();
    const check = validateRecoveryEmail(email);
    if (!check.ok) {
      setFieldError(check.error);
      return;
    }
    setFieldError('');
    await send(check.email);
  }

  async function resend() {
    if (left > 0) return;
    const check = validateRecoveryEmail(email);
    if (!check.ok) {
      // Only reachable if he edited the field after sending. Sends him back to the form
      // rather than failing silently under a success panel.
      setSent(false);
      setFieldError(check.error);
      return;
    }
    await send(check.email);
  }

  /*
    ────────────────────────────────────────────────────────────────────────────
    The success panel (§5)
    ────────────────────────────────────────────────────────────────────────────

    A separate state and not a notice under the form, because the form has nothing left to
    do and leaving it on screen invites a second submit that the cooldown then refuses -
    which reads as the page having stopped working. Spam is named explicitly: this project
    sends through whatever SMTP the Supabase project is configured with, and the first place
    a recovery mail lands when that is not warmed up is the junk folder.
  */
  if (sent) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">રીસેટ લિંક મોકલવામાં આવી છે</h1>
          <p className="auth-sub">{NEUTRAL_SENT_MESSAGE}</p>

          <ul className="recovery-steps">
            <li>તમારા ઈમેલનું Inbox અને Spam/Junk folder તપાસો.</li>
            <li>લિંક પર ક્લિક કરીને નવો પાસવર્ડ સેટ કરો.</li>
          </ul>

          {formError && <div className="notice warn">{formError}</div>}

          <button className="btn" type="button" onClick={resend} disabled={busy || left > 0}>
            {busy
              ? 'મોકલાય છે…'
              : left > 0
                ? `ફરીથી લિંક મોકલવા માટે ${gu(left)} સેકન્ડ રાહ જુઓ.`
                : 'ફરીથી મોકલો'}
          </button>

          <p className="auth-alt">
            <Link to="/login">લોગિન પર પાછા જાઓ</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">પાસવર્ડ ભૂલી ગયા?</h1>
        <p className="auth-sub">
          તમારા રજીસ્ટર્ડ ઈમેલ પર પાસવર્ડ ફરીથી સેટ કરવાની લિંક મોકલવામાં આવશે.
        </p>

        <form onSubmit={submit} noValidate>
          <TextField
            id="recovery-email"
            label="ઈમેલ એડ્રેસ"
            hint="નોંધણી વખતે આપેલું ઈમેલ સરનામું લખો."
            error={fieldError}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError('');
              if (formError) setFormError('');
            }}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            disabled={busy}
          />

          {formError && <div className="notice warn">{formError}</div>}

          <button className="btn" type="submit" disabled={busy || left > 0}>
            {busy
              ? 'મોકલાય છે…'
              : left > 0
                ? `ફરીથી લિંક મોકલવા માટે ${gu(left)} સેકન્ડ રાહ જુઓ.`
                : 'રીસેટ લિંક મોકલો'}
          </button>

          {/*
            `button` and not `submit`, and inside the form - the same two decisions લોગિન
            makes about its secondary action, for the same reason: the phone keyboard's "go"
            key follows form order, and a stray submit here would navigate instead of send.
          */}
          <Link className="btn btn-quiet" to="/login">
            લોગિન પર પાછા જાઓ
          </Link>
        </form>
      </div>
    </div>
  );
}
