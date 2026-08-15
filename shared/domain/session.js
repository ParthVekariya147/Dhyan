/**
 * How long a signed-in session lasts before the app makes the યુવક start a fresh one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The problem this is for
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everyone has installed the app to their home screen. An installed PWA is not a browser tab:
 * it is opened and closed for weeks without ever being *loaded* again. The document stays
 * alive in the background, the service worker keeps serving the precached shell, and a phone
 * that installed the app in June can still be running June's JavaScript in August — with June's
 * navigation bar, June's point rules and June's icon — while every server-side change the
 * સંચાલક has made since sits waiting for a load that never comes.
 *
 * `registerType: 'autoUpdate'` in vite.config.js is not the answer to this and was never meant
 * to be. It updates the worker when the page is *loaded*, which is exactly the event that is
 * not happening.
 *
 * So the session is given a maximum age. Past it, the next time the app is brought to the
 * foreground it ends the session and loads itself again from the network. One load, at a
 * moment nobody is in the middle of anything, and the phone is running today's app.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What "expire" means here, exactly
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It means the Supabase session is ended and the યુવક signs in again. It is not a silent
 * refresh: `autoRefreshToken` already keeps a live token alive indefinitely, which is the
 * behaviour this deliberately overrides.
 *
 * **That is a real cost and it should be set with it in mind.** At `hours: 24` every યુવક in
 * the સંઘ types his SMK and password once a day. The panel's card says so in those words, next
 * to the field, because the number is easy to type and hard to take back — 2,000 people
 * discover it at once.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Off by default
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `enabled: false`, so deploying this changes nothing for anybody. Every other setting in this
 * folder follows the same rule — DEFAULT_SLIDESHOW is six seconds because six seconds is what
 * the code did before it was configurable — and it matters more here than anywhere else: a
 * default of "on" would sign out the entire સંઘ on the deploy that introduced it, with no
 * announcement and no obvious cause.
 */

/** The field inside `settings['app'].value`. */
export const SESSION_KEY = 'session';

/**
 * One hour to thirty days.
 *
 * The floor is 1 rather than 0 because zero is not a short session, it is a login screen that
 * reappears on every foreground — indistinguishable from a broken app, and reachable by
 * mistyping. One hour is already aggressive enough to be felt.
 *
 * The ceiling is 720 hours because past a month the setting has stopped meaning anything: a
 * phone that has not been opened in a month reloads on its own when it is, and a number
 * larger than that is a number nobody can reason about. It also bounds the mistake — a
 * mistyped 99999 is refused rather than quietly becoming "never".
 */
export const SESSION_MIN_HOURS = 1;
export const SESSION_MAX_HOURS = 720;

/**
 * 24 hours is what the field is *pre-filled* with when the card is first opened, not what is
 * in force. `enabled` is false, so this number does nothing until somebody turns it on.
 */
export const DEFAULT_SESSION = Object.freeze({ enabled: false, hours: 24 });

/** Where the phone remembers when the current session began. */
export const SESSION_STARTED_KEY = 'varni.session.startedAt';

/**
 * `settings['app'].session` → the policy actually in force.
 *
 * Forgiving in the same shape as resolveSlideshow(), and the directions matter more than
 * usual because the wrong branch signs 2,000 people out:
 *
 *   absent / not an object   → off. Nothing has been configured, and "nothing configured"
 *                              must never mean "expire".
 *   enabled not exactly true → off. `Boolean(stored.enabled)` would make the string "false"
 *                              — which is what a hand-edited jsonb row can easily hold —
 *                              switch the whole સંઘ's sessions on.
 *   hours not a number       → off, not "off but remember 24". **`typeof`, never `Number()`**,
 *                              for the reason resolveSlideshow() sets out: `Number(null)` and
 *                              `Number('')` are both 0, and a coercing check would turn an
 *                              empty field into an expiry of zero hours.
 *   out of range             → clamped, not defaulted. A સંચાલક who stored 0 asked for "as
 *                              short as possible" and 1 hour is the honest answer; 5000 is
 *                              clamped to 720 rather than switched off, because switching off
 *                              a policy somebody deliberately enabled is the one direction
 *                              that fails silently.
 *
 * Returning `{ enabled: false }` with the hours still present is deliberate: the panel shows
 * the last number he typed when he toggles the policy back on, exactly as resolveLevel4Gate()
 * keeps its threshold across a switched-off gate.
 */
export function resolveSessionPolicy(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const raw = s.hours;
  const hasHours = typeof raw === 'number' && Number.isFinite(raw);
  const hours = hasHours
    ? Math.min(SESSION_MAX_HOURS, Math.max(SESSION_MIN_HOURS, Math.round(raw)))
    : DEFAULT_SESSION.hours;

  return { enabled: s.enabled === true && hasHours, hours };
}

/**
 * Refuses what resolveSessionPolicy() would silently clamp.
 *
 * Same division of labour as validateSlideshow(): the resolver forgives so that a stored row
 * always produces a running app, this refuses so that a સંચાલક who types 5000 is told the
 * ceiling rather than left to find out that his month-long session is really a month.
 */
export function validateSessionPolicy(policy) {
  const p = policy && typeof policy === 'object' ? policy : null;
  if (!p) return { ok: false, gu: 'The session setting is missing.' };

  if (p.enabled !== true && p.enabled !== false) {
    return { ok: false, gu: 'Turn the automatic sign-out on or off.' };
  }

  // Validated even when switched off, because the number is stored either way and a row
  // holding a bad one would come into force the moment somebody flipped the switch.
  const n = p.hours;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, gu: 'Session length: enter a number of hours.' };
  }
  if (!Number.isInteger(n)) {
    return { ok: false, gu: 'Session length: enter a whole number of hours.' };
  }
  if (n < SESSION_MIN_HOURS || n > SESSION_MAX_HOURS) {
    return {
      ok: false,
      gu: `Session length: between ${SESSION_MIN_HOURS} and ${SESSION_MAX_HOURS} hours.`,
    };
  }

  return { ok: true, enabled: p.enabled, hours: n };
}

/**
 * Has this session outlived the policy?
 *
 * Pure, and taking both instants as arguments, so that the rule is testable without a clock
 * and identical in the app and in the suite that checks it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The three ways this is asked with a broken clock, and where each falls
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `startedAt` is written by the phone and read by the phone, so the two readings come from
 * the same wrong clock and ordinary skew cancels out. What does not cancel is the clock being
 * *changed* between them, which on a phone happens for real: a timezone flight, a manual
 * correction, or a device that lost power and came back at the epoch.
 *
 *   startedAt missing / NaN  → expired. A session whose beginning is unknown cannot be shown
 *                              to be young, and the cost of being wrong is one reload.
 *   startedAt in the future  → expired. The alternative — treating it as "very recent" —
 *                              makes a phone whose clock jumped forward and back immortal,
 *                              which is the one failure mode that never corrects itself.
 *   now before startedAt by  → covered by the case above; there is deliberately no tolerance
 *   a few seconds              window, because a spurious reload costs a network request and a
 *                              missed one costs a યુવક running last month's app.
 *
 * Every branch fails towards reloading. That is the safe direction here and it is worth being
 * explicit about why: this whole mechanism exists because phones get stuck on old builds, so
 * an ambiguity resolved as "keep the old build" would be the mechanism failing at its own job.
 */
export function sessionExpired(policy, startedAt, now) {
  const p = policy && typeof policy === 'object' ? policy : {};
  if (p.enabled !== true) return false;

  const hours = typeof p.hours === 'number' && Number.isFinite(p.hours) ? p.hours : 0;
  if (hours <= 0) return false;

  const started = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : NaN;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : NaN;
  if (Number.isNaN(started) || Number.isNaN(at)) return true;
  if (started > at) return true;

  return at - started >= hours * 60 * 60 * 1000;
}

/** How long is left, in milliseconds, for a caller that wants to arm a timer. 0 when due. */
export function sessionRemainingMs(policy, startedAt, now) {
  const p = policy && typeof policy === 'object' ? policy : {};
  if (p.enabled !== true) return Infinity;
  if (sessionExpired(p, startedAt, now)) return 0;
  return startedAt + p.hours * 60 * 60 * 1000 - now;
}
