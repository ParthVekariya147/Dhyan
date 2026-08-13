/**
 * ────────────────────────────────────────────────────────────────────────────
 * PASSWORD RECOVERY, AS PURE LOGIC
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything the two recovery screens decide, with no React, no network and no Supabase
 * client — so `scripts/test-recovery.mjs` can assert it exactly, including the parts that
 * are security properties rather than behaviour.
 *
 * Three of those properties are the reason this file exists at all rather than the logic
 * living inside the pages:
 *
 *   1. **The answer to "was that email registered?" is a constant.** `neutralOutcome()`
 *      returns the same value for a delivered mail, an unknown address and a Supabase
 *      error nobody anticipated. If that ever becomes a branch on the error, the ~2,000
 *      mobile numbers this project already protects at login (netlify/functions/login-mobile.js)
 *      become enumerable through the front door instead. A test can hold a constant; it
 *      cannot easily hold "nobody added an else".
 *
 *   2. **A recovery link is not proof of anything.** `readRecoveryUrl()` reads the URL only
 *      to tell a *broken* link from a *possible* one, and says so in its return shape:
 *      `maybeRecovery` is a hint used to pick which screen to draw, never a permission.
 *      The permission is a Supabase recovery session, and only the page can hold that.
 *      Anything in this module that returned "yes, let him set a password" from a string
 *      would be the reset-session bypass §24 asks to be tested for.
 *
 *   3. **The cooldown is UX and must be unable to become a lockout.** `cooldownRemaining()`
 *      is clamped at both ends and treats a damaged or future-dated stored timestamp as
 *      "no cooldown", because the stored value comes from sessionStorage — a string this
 *      app's own older builds, or anyone with devtools, may have written. A recovery flow
 *      that a corrupt clock can wedge shut is worse than no cooldown, since the યુવક who
 *      hits it has no password to get in with either.
 *
 * The password rule is imported, never restated: `MIN_PASSWORD` is નોંધણી's rule, and
 * §9 asks that reset use the same one. A second copy here is a second chance to disagree,
 * and the disagreement would be the worst kind — a password accepted at reset that the
 * registration form would have refused.
 */
import { EMAIL_RE, MIN_PASSWORD, gu } from './constants.js';
import { FORGOT_PATH, RESET_PATH, resetRedirectTo } from './recovery-routes.js';

/*
  Re-exported so this module stays the one place the flow is read from.

  The three live in recovery-routes.js because src/lib/auth.jsx needs the redirect builder
  and is eager — importing it from here would pull every Gujarati sentence below into the
  entry chunk, which it measurably did. That is a bundling concern and nobody reading the
  recovery flow should have to know about it, so the names still resolve from here.
*/
export { FORGOT_PATH, RESET_PATH, resetRedirectTo };

/**
 * The resend cooldown, in seconds.
 *
 * UX protection only, and §4 is explicit about that. Supabase Auth's own per-address and
 * per-IP limits on /recover are the authoritative ones; this number exists so a યુવક who
 * taps twice does not spend one of them, and so the second tap says something useful
 * instead of appearing to do nothing.
 *
 * 60 rather than something longer because the failure mode is asymmetric: a cooldown that
 * is too short costs one wasted Supabase request, and one that is too long strands a યુવક
 * whose first mail genuinely did not arrive.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * The one thing this app says after a reset request, whatever actually happened.
 *
 * §3. Note what it does not contain: no address, no "we sent", no "not found". "જો ... હશે"
 * is doing the security work — it describes a condition without answering it.
 */
export const NEUTRAL_SENT_MESSAGE =
  'જો આ ઈમેલ અમારી સિસ્ટમમાં નોંધાયેલ હશે, તો પાસવર્ડ રીસેટ કરવાની લિંક મોકલવામાં આવશે.';

/** §20 — the three outcomes a યુવક may be told apart, and nothing finer. */
export const RECOVERY_MESSAGE = {
  network: 'ઇન્ટરનેટ કનેક્શન તપાસો અને ફરી પ્રયાસ કરો.',
  throttled: 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી પ્રયાસ કરો.',
  generic: 'હાલમાં પ્રક્રિયા પૂર્ણ થઈ શકી નથી. થોડા સમય પછી ફરી પ્રયાસ કરો.',
  expired: 'આ પાસવર્ડ રીસેટ લિંક હવે માન્ય નથી.',
  weak: 'આ પાસવર્ડ સ્વીકારાયો નથી. બીજો પાસવર્ડ પસંદ કરો.',
};

/**
 * The email a reset is asked for.
 *
 * Format only. There is deliberately no "does this address exist" step anywhere in this
 * module or in the pages that use it — §2 forbids the lookup, and a lookup is exactly what
 * an attacker needs. An address that is well-formed and unknown must travel the identical
 * path to one that is well-formed and registered, right through to the same sentence.
 */
export function validateRecoveryEmail(raw) {
  const email = String(raw ?? '').trim();
  if (!email) return { ok: false, error: 'ઈમેલ સરનામું લખો.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'આખું ઈમેલ સરનામું લખો.' };
  // Lower-cased for Supabase, which stores addresses folded. Returned separately from the
  // raw value so a page can keep showing what he typed while sending what the server wants.
  return { ok: true, email: email.toLowerCase() };
}

/**
 * The new password and its confirmation.
 *
 * §9 — નોંધણી's rule, reached by import. The returned object is keyed by field name so a
 * page can drop each message beside the input it is about, which is the layout contract
 * components/Field.jsx already holds for લોગિન and નોંધણી.
 */
export function validateNewPassword(password, confirm) {
  const errors = {};
  const pw = String(password ?? '');
  const cf = String(confirm ?? '');

  if (!pw) errors.password = 'નવો પાસવર્ડ લખો.';
  else if (pw.length < MIN_PASSWORD) errors.password = `ઓછામાં ઓછા ${gu(MIN_PASSWORD)} અક્ષર લખો.`;

  // Checked even when the first field is already wrong, so a યુવક fixing a short password
  // is not then told about a mismatch he could have been shown at the same time.
  if (!cf) errors.confirm = 'પાસવર્ડ ફરીથી લખો.';
  else if (pw && pw !== cf) errors.confirm = 'બંને પાસવર્ડ સરખા નથી.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Is this error one a યુવક may be told about by name?
 *
 * Only two are, and both are about *his* situation rather than about any account: the net
 * is down, or he has asked too often. Everything else — including an unknown address, a
 * refused SMTP relay and anything Supabase invents later — collapses into the neutral
 * sentence, because telling those apart is telling accounts apart.
 *
 * Returns a *kind*, not a message, so the caller decides whether "throttled" is shown as an
 * error or folded into the cooldown it already has on screen.
 */
export function classifyRecoveryError(error) {
  if (!error) return 'ok';

  const msg = String(error.message || error.gu || '').toLowerCase();
  const status = Number(error.status ?? error.statusCode ?? 0);

  // `fetch` rejects rather than resolving when the connection is gone. This is the one case
  // where saying nothing would be actively wrong: the request never reached Supabase, so a
  // "check your inbox" screen would be a lie he acts on by waiting.
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
    return 'network';
  }
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'throttled';
  }
  return 'neutral';
}

/**
 * The reset-request screen's answer, for any outcome.
 *
 * `sent` is what decides whether the success panel is drawn, and it is true for both 'ok'
 * and 'neutral'. That is the whole enumeration defence expressed as one line: the screen a
 * યુવક sees after submitting a registered address and after submitting an unregistered one
 * are the same screen, reached by the same branch.
 */
export function neutralOutcome(error) {
  const kind = classifyRecoveryError(error);
  if (kind === 'network') return { sent: false, kind, message: RECOVERY_MESSAGE.network };
  if (kind === 'throttled') return { sent: false, kind, message: RECOVERY_MESSAGE.throttled };
  return { sent: true, kind: 'neutral', message: NEUTRAL_SENT_MESSAGE };
}

/**
 * How many seconds are left before ફરીથી મોકલો may be pressed.
 *
 * Every hostile input resolves to 0, which is "no cooldown, let him try". The list matters
 * because `startedAt` is read back from sessionStorage: `Number('')` and `Number(null)` are
 * both 0, a value from a clock that has since been corrected can sit in the future, and a
 * NaN comparison is false in every direction. Each of those would otherwise turn into a
 * countdown that never reaches zero.
 */
export function cooldownRemaining(startedAt, now, seconds = RESEND_COOLDOWN_SECONDS) {
  const start = Number(startedAt);
  const at = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(at) || start <= 0) return 0;

  const elapsed = Math.floor((at - start) / 1000);
  // A negative elapsed means the stored stamp is in the future — a corrected device clock,
  // or a tampered value. Treated as expired rather than as a very long wait.
  if (elapsed < 0) return 0;
  if (elapsed >= seconds) return 0;
  return seconds - elapsed;
}

/**
 * What the recovery URL appears to carry — a hint for choosing a screen, never a permission.
 *
 * Supabase hands back two shapes and one failure, and the failure is the reason this reads
 * the URL at all:
 *
 *   implicit   #access_token=…&type=recovery      the older link
 *   pkce       ?code=…                             the current one
 *   refused    #error=…&error_code=otp_expired…    an expired or already-used link
 *
 * The refusal never becomes a session, so without reading it the expired-link case would
 * render as "waiting for a recovery session" for ever — the infinite spinner §19 forbids.
 * Reading it lets the page say "લિંક હવે માન્ય નથી" immediately and offer a new one.
 *
 * `maybeRecovery` is named to be unusable as an authorisation: it means "it is worth waiting
 * for a session", and the page still refuses to enable the form until Supabase produces one.
 */
export function readRecoveryUrl(hash = '', search = '') {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));

  const errorCode = h.get('error_code') || q.get('error_code') || '';
  const errorName = h.get('error') || q.get('error') || '';

  if (errorCode || errorName) {
    // `otp_expired` and `access_denied` are the two Supabase returns for a link that has
    // lapsed or been consumed. Anything else here is still a refusal, and is treated as one
    // rather than passed through — §11 forbids showing the raw value either way.
    return { maybeRecovery: false, failed: true, reason: errorCode || errorName };
  }

  const type = h.get('type') || q.get('type') || '';
  const hasToken = Boolean(h.get('access_token'));
  const hasCode = Boolean(q.get('code'));

  return {
    maybeRecovery: type === 'recovery' || hasToken || hasCode,
    failed: false,
    reason: '',
  };
}

