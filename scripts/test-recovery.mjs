/**
 * ────────────────────────────────────────────────────────────────────────────
 * PASSWORD RECOVERY, AS PURE LOGIC - `npm run test:recovery`
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `shared/domain/recovery.js` holds everything the two recovery screens decide that is not
 * a Supabase call: what a valid address is, what a valid new password is, how long the
 * resend waits, what a recovery URL appears to carry, and - the important one - what a
 * યુવક is told afterwards.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each group is protecting, and against what
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. **Account enumeration, as a constant rather than a behaviour.** This is the reason
 *      the file exists. `neutralOutcome()` must return the same `sent: true` for a
 *      delivered mail, an unknown address, and an error nobody has seen yet. The test does
 *      not check "the code has no else branch" - it checks the output over a table of
 *      unrelated errors, so a future branch on `error.message` fails here rather than
 *      shipping. This project already refuses to leak which mobile numbers are registered
 *      (netlify/functions/login-mobile.js returns one body for two different failures); a
 *      reset form that said "આ ઈમેલ રજીસ્ટર નથી" would give that back through another door.
 *
 *   2. **The cooldown cannot become a lockout.** `cooldownRemaining()` reads a value out of
 *      sessionStorage, which is a string this app's own older builds - or anyone with
 *      devtools - may have written. `Number('')` and `Number(null)` are both 0 and NaN
 *      compares false in every direction, so one unguarded path turns a damaged timestamp
 *      into a countdown that never reaches zero. A યુવક who hits that has no password to get
 *      in with either, which makes it the worst bug this flow could have.
 *
 *   3. **A URL is not a permission.** `readRecoveryUrl()` is allowed to say "this looks like
 *      a recovery link" and is not allowed to say anything stronger. The group asserts the
 *      shape it returns, including that a hand-written fragment claiming `type=recovery`
 *      produces exactly the same `maybeRecovery: true` as a real one - because the page
 *      pairs it with a session before it believes anything, and the test exists to keep
 *      that pairing necessary.
 *
 *   4. **The reset password rule is નોંધણી's rule.** §9. Asserted by driving the validator
 *      at MIN_PASSWORD and one below it, so the day somebody strengthens registration this
 *      file goes red until reset follows.
 *
 *   5. **Drift against the router.** RESET_PATH is what goes into the recovery mail. If that
 *      string and the route in src/App.jsx ever disagree, every mail this project sends
 *      lands on the catch-all redirect and the flow is dead in a way no unit test of either
 *      file alone would notice. Read as text, the same trick scripts/test-navigation.mjs
 *      uses for the nav registry.
 *
 *   6. **The house style holds in the strings a યુવક reads.** Gujarati, and plain hyphens
 *      rather than em dashes - the project's rule for user-visible text.
 *
 * No test framework, for the reason scripts/test-domain.mjs gives. Exit code is the result:
 * 0 green, 1 red.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FORGOT_PATH,
  NEUTRAL_SENT_MESSAGE,
  RECOVERY_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  RESET_PATH,
  classifyRecoveryError,
  cooldownRemaining,
  neutralOutcome,
  readRecoveryUrl,
  resetRedirectTo,
  validateNewPassword,
  validateRecoveryEmail,
} from '../shared/domain/recovery.js';
import { MIN_PASSWORD } from '../shared/domain/constants.js';

const ROOT = path.resolve(import.meta.dirname, '..');

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(`${name}\n       got  ${g}\n       want ${w}`);
};
const ok = (name, cond) => eq(name, Boolean(cond), true);

const group = (name) => console.log(`\n  ${name}`);

/** U+0A80..U+0AFF is the whole Gujarati block. Written as escapes so the class is readable. */
const GUJARATI = /[઀-૿]/;

// ============================================================ 1. no account enumeration

/*
  The single most important group in this file.

  Every one of these errors is a different thing going wrong, and the યુવક must not be able
  to tell any of them from "the mail is on its way" - because one of them, in a version of
  this code somebody writes later, would be "no such user". The assertion is on the whole
  returned object, not just on `sent`, so a future edit that kept `sent: true` and varied the
  message still fails.
*/
group('§3 - the answer is the same whatever happened');
{
  const expected = { sent: true, kind: 'neutral', message: NEUTRAL_SENT_MESSAGE };

  eq('a clean send is neutral', neutralOutcome(null), expected);
  eq('undefined is neutral', neutralOutcome(undefined), expected);

  // The table. Each is a real shape Supabase or a proxy in front of it can produce.
  const hostile = [
    { name: 'user not found', error: { message: 'User not found', status: 404 } },
    { name: 'email not confirmed', error: { message: 'Email not confirmed', status: 400 } },
    { name: 'invalid email', error: { message: 'Unable to validate email address', status: 400 } },
    { name: 'smtp refused', error: { message: 'Error sending recovery email', status: 500 } },
    { name: 'signups disabled', error: { message: 'Signups not allowed', status: 422 } },
    { name: 'an empty object', error: {} },
    { name: 'a bare Error', error: new Error('boom') },
    { name: 'something未来', error: { message: 'a failure mode invented next year', status: 418 } },
  ];
  for (const h of hostile) {
    eq(`${h.name} is indistinguishable from success`, neutralOutcome(h.error), expected);
  }

  // The two exceptions, and the reason they are allowed: both are statements about HIM -
  // his connection, his request rate - and neither is a statement about any account.
  eq(
    'a dead connection is NOT claimed as sent',
    neutralOutcome({ message: 'Failed to fetch' }),
    { sent: false, kind: 'network', message: RECOVERY_MESSAGE.network }
  );
  eq(
    'a throttle is NOT claimed as sent',
    neutralOutcome({ status: 429, message: 'Too Many Requests' }),
    { sent: false, kind: 'throttled', message: RECOVERY_MESSAGE.throttled }
  );

  // The neutral sentence must not name the address, name the app's decision, or assert
  // delivery. A conditional is the whole point of it.
  ok('the neutral sentence is conditional', NEUTRAL_SENT_MESSAGE.includes('જો'));
  ok('the neutral sentence does not say "મોકલી છે"', !NEUTRAL_SENT_MESSAGE.includes('મોકલી છે'));
}

group('classifyRecoveryError - the three kinds, and nothing finer');
{
  eq('no error is ok', classifyRecoveryError(null), 'ok');
  eq('Failed to fetch is network', classifyRecoveryError({ message: 'Failed to fetch' }), 'network');
  eq('NetworkError is network', classifyRecoveryError({ message: 'NetworkError when attempting to fetch' }), 'network');
  eq('Load failed is network', classifyRecoveryError({ message: 'Load failed' }), 'network');
  eq('429 is throttled', classifyRecoveryError({ status: 429 }), 'throttled');
  eq('statusCode 429 is throttled', classifyRecoveryError({ statusCode: 429 }), 'throttled');
  eq('a rate-limit message is throttled', classifyRecoveryError({ message: 'email rate limit exceeded' }), 'throttled');
  eq('anything else is neutral', classifyRecoveryError({ message: 'User not found' }), 'neutral');
}

// ============================================================ 2. the cooldown

/*
  Hostile inputs first, because the stored value is not trusted.

  Every one of these must produce 0 - "no wait, let him try". The failure this prevents is
  not cosmetic: a countdown that never reaches zero is a યુવક permanently unable to ask for
  the mail that is his only way back into the account.
*/
group('cooldownRemaining - nothing can wedge it shut');
{
  const now = 1_700_000_000_000;

  const junk = [
    ['never sent', 0],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -1],
    ['a word', 'soon'],
    ['an object', {}],
    ['a future stamp', now + 60_000],
  ];
  const stuck = junk.filter(([, v]) => cooldownRemaining(v, now) !== 0).map(([n]) => n);
  eq('every damaged or impossible stamp means no cooldown', stuck, []);

  eq('a bad `now` also means no cooldown', cooldownRemaining(now, NaN), 0);

  // The ordinary countdown.
  eq('just sent is the full wait', cooldownRemaining(now, now), RESEND_COOLDOWN_SECONDS);
  eq('one second in', cooldownRemaining(now, now + 1000), RESEND_COOLDOWN_SECONDS - 1);
  eq('half way', cooldownRemaining(now, now + 30_000), RESEND_COOLDOWN_SECONDS - 30);
  eq('one second short', cooldownRemaining(now, now + 59_000), 1);
  eq('exactly expired', cooldownRemaining(now, now + 60_000), 0);
  eq('long past', cooldownRemaining(now, now + 600_000), 0);

  // It must count down monotonically and land on 0 - never skip past it into a negative,
  // which would render as "ફરીથી ... -3 સેકન્ડ રાહ જુઓ".
  let previous = Infinity;
  const wrong = [];
  for (let ms = 0; ms <= 61_000; ms += 500) {
    const left = cooldownRemaining(now, now + ms);
    if (left < 0) wrong.push(`negative at ${ms}ms`);
    if (left > previous) wrong.push(`went up at ${ms}ms`);
    previous = left;
  }
  eq('it only ever counts down, and never below zero', wrong, []);
  eq('the wait is the documented 60 seconds', RESEND_COOLDOWN_SECONDS, 60);
}

// ============================================================ 3. the URL is not a permission

group('readRecoveryUrl - describes the link, never authorises it');
{
  eq(
    'the implicit link',
    readRecoveryUrl('#access_token=abc&refresh_token=def&type=recovery', ''),
    { maybeRecovery: true, failed: false, reason: '', tokenHash: '' }
  );
  eq(
    'the pkce link',
    readRecoveryUrl('', '?code=a-uuid-here'),
    { maybeRecovery: true, failed: false, reason: '', tokenHash: '' }
  );
  eq(
    'an expired link is a refusal, and says why internally',
    readRecoveryUrl('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', ''),
    { maybeRecovery: false, failed: true, reason: 'otp_expired', tokenHash: '' }
  );
  eq(
    'an error in the query string is caught too',
    readRecoveryUrl('', '?error=access_denied&error_code=otp_expired'),
    { maybeRecovery: false, failed: true, reason: 'otp_expired', tokenHash: '' }
  );
  eq(
    'a bare error with no code still refuses',
    readRecoveryUrl('#error=server_error', ''),
    { maybeRecovery: false, failed: true, reason: 'server_error', tokenHash: '' }
  );
  eq(
    'a plain visit is neither',
    readRecoveryUrl('', ''),
    { maybeRecovery: false, failed: false, reason: '', tokenHash: '' }
  );
  eq(
    'a signup confirmation is not a recovery',
    readRecoveryUrl('#access_token=abc&type=signup', ''),
    // `maybeRecovery` is true here on the access_token alone, and that is correct and safe:
    // the page still requires a session AND pairs it with this hint, and Supabase will
    // refuse an updateUser that the session does not authorise. The point of the assertion
    // is that this function does not pretend to tell them apart - the session does.
    { maybeRecovery: true, failed: false, reason: '', tokenHash: '' }
  );

  /*
    The shape this project now mails, and the one rule attached to it.

    The hash is carried only when the link says `type=recovery`, because that is the type
    the page then passes to verifyOtp. Carrying a signup or email-change hash under a
    'recovery' claim would be the page telling Supabase something the link never said - so
    the pairing is asserted here, where it is one line, rather than trusted in the caller.
  */
  eq(
    'the verify link carries its hash',
    readRecoveryUrl('', '?token_hash=pkce_abc123&type=recovery'),
    { maybeRecovery: true, failed: false, reason: '', tokenHash: 'pkce_abc123' }
  );
  eq(
    'a hash in the fragment is read too',
    readRecoveryUrl('#token_hash=abc&type=recovery', ''),
    { maybeRecovery: true, failed: false, reason: '', tokenHash: 'abc' }
  );
  eq(
    'a hash from another kind of mail is not carried as a recovery',
    readRecoveryUrl('', '?token_hash=abc&type=signup'),
    { maybeRecovery: false, failed: false, reason: '', tokenHash: '' }
  );
  eq(
    'a refusal carries no hash, whatever else the URL holds',
    readRecoveryUrl('', '?token_hash=abc&type=recovery&error_code=otp_expired'),
    { maybeRecovery: false, failed: true, reason: 'otp_expired', tokenHash: '' }
  );

  // The property that keeps this honest: a hand-written fragment is indistinguishable from
  // a real one. If that ever stopped being true, somebody would have started trusting it.
  eq(
    'a forged fragment looks exactly like a real one',
    readRecoveryUrl('#type=recovery', ''),
    readRecoveryUrl('#access_token=forged&type=recovery', '')
  );

  // Malformed input must not throw - this runs during the first render of the page whose
  // job is to handle broken links.
  const survived = [];
  for (const bad of [null, undefined, '#', '?', '#=', '###', '?&&&', '#%%%']) {
    try {
      readRecoveryUrl(bad, bad);
      survived.push(true);
    } catch {
      survived.push(String(bad));
    }
  }
  eq('malformed URLs are described, not thrown on', survived.filter((s) => s !== true), []);
}

// ============================================================ 4. the password rule

group('§9 - reset uses નોંધણી\'s password rule, by import');
{
  const short = 'x'.repeat(MIN_PASSWORD - 1);
  const exact = 'x'.repeat(MIN_PASSWORD);

  eq('one character short is refused', validateNewPassword(short, short).ok, false);
  eq('exactly the minimum is accepted', validateNewPassword(exact, exact).ok, true);
  eq('the refusal names the minimum in Gujarati digits', GUJARATI.test(validateNewPassword(short, short).errors.password), true);

  eq('an empty password is refused', validateNewPassword('', '').ok, false);
  eq('a missing confirmation is refused', validateNewPassword(exact, '').ok, false);
  eq('a mismatch is refused', validateNewPassword('abcdefg', 'abcdefh').ok, false);
  eq(
    'the mismatch is reported on the confirm field, where he must fix it',
    Object.keys(validateNewPassword('abcdefg', 'abcdefh').errors),
    ['confirm']
  );
  eq(
    'a short password reports both problems at once',
    Object.keys(validateNewPassword('x', '').errors).sort(),
    ['confirm', 'password']
  );
  eq('a long password is fine', validateNewPassword('a'.repeat(64), 'a'.repeat(64)).ok, true);

  // Whitespace is a legitimate password character and must not be trimmed away - trimming
  // would set a password the યુવક cannot then type back.
  eq('a password with spaces is kept verbatim', validateNewPassword('a b c d', 'a b c d').ok, true);
  eq('trailing space matters', validateNewPassword('abcdef ', 'abcdef').ok, false);
}

group('validateRecoveryEmail - format only, never existence');
{
  eq('empty is refused', validateRecoveryEmail('').ok, false);
  eq('whitespace is refused', validateRecoveryEmail('   ').ok, false);
  eq('no @ is refused', validateRecoveryEmail('yuvak').ok, false);
  eq('a mobile number is refused', validateRecoveryEmail('9601269715').ok, false);
  eq('a good address passes', validateRecoveryEmail('yuvak@example.com').ok, true);
  eq('it is trimmed and folded for Supabase', validateRecoveryEmail('  YUVAK@Example.COM  ').email, 'yuvak@example.com');
  eq('every message is Gujarati', GUJARATI.test(validateRecoveryEmail('').error), true);
}

group('resetRedirectTo - one path, built once');
{
  eq('a plain origin', resetRedirectTo('https://dhyan.example.com'), 'https://dhyan.example.com/reset-password');
  eq('a trailing slash does not double up', resetRedirectTo('https://dhyan.example.com/'), 'https://dhyan.example.com/reset-password');
  eq('several trailing slashes', resetRedirectTo('https://dhyan.example.com///'), 'https://dhyan.example.com/reset-password');
  eq('a dev origin with a port', resetRedirectTo('http://localhost:5173'), 'http://localhost:5173/reset-password');
  eq('it always ends in RESET_PATH', resetRedirectTo('https://x.test').endsWith(RESET_PATH), true);
}

// ============================================================ 5. drift against the router

/*
  The check no unit test of either file alone can make.

  RESET_PATH is what Supabase puts in the mail. If src/App.jsx does not route that exact
  string, the link opens the catch-all, which redirects to '/' - so every recovery mail this
  project has ever sent silently stops working, and both files still look correct on their
  own. Read as text rather than imported, because importing App.jsx would pull React and the
  whole page graph into a node script.
*/
group('§25 - the mail\'s destination is a route this app actually has');
{
  const app = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf8');

  ok(`src/App.jsx routes ${RESET_PATH}`, app.includes(`path="${RESET_PATH}"`));
  ok(`src/App.jsx routes ${FORGOT_PATH}`, app.includes(`path="${FORGOT_PATH}"`));

  // Both must remain reachable without a session (§17). <Guarded> around either would make
  // recovery impossible for the only people who need it.
  const resetBlock = app.slice(app.indexOf(`path="${RESET_PATH}"`), app.indexOf(`path="${RESET_PATH}"`) + 400);
  ok('/reset-password is not behind <Guarded>', !resetBlock.includes('<Guarded>'));

  // ...and /reset-password must NOT be behind <PublicOnly> either, which is the subtler of
  // the two mistakes: a recovery link signs him in, so PublicOnly would redirect him away
  // from the page at the moment he arrived, consuming the link and changing nothing.
  ok('/reset-password is not behind <PublicOnly>', !resetBlock.includes('<PublicOnly>'));

  const forgotBlock = app.slice(app.indexOf(`path="${FORGOT_PATH}"`), app.indexOf(`path="${FORGOT_PATH}"`) + 400);
  ok('/forgot-password IS behind <PublicOnly>', forgotBlock.includes('<PublicOnly>'));

  // The protected routes must be exactly as they were. This is the "do not accidentally
  // make the application public" assertion (§17), written as a count rather than a spot
  // check so that removing a guard anywhere shows up here.
  const guardedCount = (app.match(/<Guarded>/g) || []).length;
  ok(`the guarded routes are still guarded (${guardedCount} of them)`, guardedCount >= 10);

  // And the login page must actually offer the flow, or none of the above is reachable.
  const login = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Login.jsx'), 'utf8');
  ok('લોગિન links to the recovery page', login.includes(`to="${FORGOT_PATH}"`));
}

/*
  The reset page must never ask Supabase to change a password by naming a user.

  `updateUser({ password })` acts on the session; a call that passed an address or an id
  would be the arbitrary-user update §24 asks to be tested for. Asserted as absence, over the
  page and over the auth service, because this is the one property whose violation would look
  entirely reasonable in review.
*/
group('§10/§24 - the update is bound to the session, not to a named user');
{
  const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'ResetPassword.jsx'), 'utf8');
  const auth = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'auth.jsx'), 'utf8');

  /*
    Comments stripped before asserting absence.

    Both files explain this rule in prose, so a naive `includes('updateUser')` matches the
    sentence describing why the page must not call it - a test that fails precisely because
    the property is documented. Absence assertions have to look at code.
  */
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pageCode = code(page);

  ok('the page never reads an email from the URL', !/searchParams|useSearchParams/.test(pageCode));
  ok('the page never calls updateUser itself', !pageCode.includes('updateUser'));
  ok('updatePassword takes only a password', /async updatePassword\(password\)/.test(auth));
  ok('updateUser is called with the password alone', /updateUser\(\{ password \}\)/.test(auth));

  /*
    The verify step, which is the only thing between a link and a session.

    It takes a hash and a type and nothing else - no address, no user id. A variant that
    accepted an email would let the page name whose password is about to be changed, which
    is the same defect as an updatePassword(email, password) and is worth its own assertion
    because it would arrive looking like a convenience.
  */
  ok('the token is verified as a recovery, never as another type', /verifyOtp\(\{ type: 'recovery', token_hash \}\)/.test(auth));
  ok('the verify names no user', !/verifyOtp\(\{[^}]*email/.test(auth));
  ok('the page never calls verifyOtp itself', !pageCode.includes('verifyOtp'));

  // The recovery mail must point at the reset page and not, as it once did, at લોગિન.
  ok('the mail redirects to the reset page', auth.includes('resetRedirectTo('));
  ok('no hardcoded localhost reaches the redirect', !/redirectTo:\s*['"`]http:\/\/localhost/.test(auth));

  /*
    The client option the whole mailed flow rests on, asserted because reverting it breaks
    nothing that runs in a browser the developer is looking at.

    PKCE - supabase-js's default - keeps the code verifier in the localStorage of the profile
    that asked for the mail, so the link only works if it is opened there. It is opened in the
    Gmail app's webview instead, and it also makes GoTrue store the token under a `pkce_`
    prefix that verifyOtp cannot turn straight into a session. Both failures look like
    "the link is expired" and neither reproduces on a desktop where mail and app share a
    browser, which is exactly why this is a test and not a comment.
  */
  const client = fs.readFileSync(path.join(ROOT, 'shared', 'supabase', 'client.js'), 'utf8');
  ok('the mailed link is not bound to one browser profile', /flowType:\s*'implicit'/.test(client));
}

/*
  §16 - the સંચાલક panel's own recovery, which is the same flow and was not.

  The panel has a "forgot password" on its login screen, and it used to address the mail to
  `${location.origin}/admin/`. There is no recovery screen there. Supabase opens a live
  session the instant it verifies a link, so that redirect signed the સંચાલક into the
  dashboard with the link spent and the password untouched - and every retry did the same,
  which means an admin who had genuinely forgotten his password could not recover it at all.

  Asserted here rather than in an admin-only test because the property is about the pair:
  whatever address the panel mails, this project must route it. Both apps are served from one
  origin (netlify.toml), so RESET_PATH is reachable from either.

  The second assertion is the one that matters for §16. An admin recovery is an ordinary
  Supabase recovery - no path exists anywhere in the panel by which one person's password is
  set from another person's session, and no administrator ever handles a password or a token.
*/
group('§16 - the સંચાલક panel recovers through the same reset screen');
{
  const adminAuth = fs.readFileSync(path.join(ROOT, 'admin', 'src', 'lib', 'adminAuth.jsx'), 'utf8');
  const code = adminAuth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok('the panel builds its redirect with resetRedirectTo()', code.includes('resetRedirectTo('));
  ok('the panel no longer mails a link to /admin/', !/redirectTo:.*\/admin\//.test(code));
  ok('the panel never calls updateUser with a named user', !/updateUser\(\{[^}]*email/.test(code));

  // The panel signs people in and mails links. It must not be able to set a password at all -
  // an administrator holds no route to anybody's credentials, his own included, except the
  // mail Supabase sends to the address on that account.
  ok('the panel sets no password anywhere', !code.includes('updateUser'));
  ok('the panel holds no service-role key', !/SUPABASE_SECRET|service_role/.test(adminAuth));
}

// ============================================================ 6. house style

/*
  Em dashes are a comment character in this project, not a UI one - user-visible strings use
  a plain hyphen. Every exported message is checked, since these are the newest user-facing
  strings in the app and the rule is easy to forget in a file nobody has edited since.
*/
group('house style - Gujarati, and no em dash in anything a યુવક reads');
{
  const shown = [NEUTRAL_SENT_MESSAGE, ...Object.values(RECOVERY_MESSAGE)];

  eq('every message is Gujarati', shown.filter((m) => !GUJARATI.test(m)), []);
  eq('no message contains an em dash', shown.filter((m) => m.includes('—')), []);
  eq('no message contains an en dash', shown.filter((m) => m.includes('–')), []);

  // The pages too - their Gujarati is written inline rather than imported.
  for (const rel of [['src', 'pages', 'ForgotPassword.jsx'], ['src', 'pages', 'ResetPassword.jsx']]) {
    const src = fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
    // Strip block comments, where an em dash is house style, then look at what is left.
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const offenders = withoutComments
      .split('\n')
      .filter((line) => line.includes('—') && GUJARATI.test(line));
    eq(`${rel[rel.length - 1]} has no em dash in Gujarati UI text`, offenders, []);
  }
}

group('§11 - the refusal explains nothing internal');
{
  const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'ResetPassword.jsx'), 'utf8');

  // The reason code is read (to decide the screen) and must never be printed. `{url.reason}`
  // in JSX would put `otp_expired` on a યુવક's screen.
  ok('the failure reason is never rendered', !page.includes('{url.reason}'));
  ok('no raw error message is rendered', !/\{\s*(err|error)(\.message)?\s*\}/.test(page));
  ok('no token is ever rendered', !/\{\s*[^}]*access_token[^}]*\}/.test(page));
}

// ==================================================================== result

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  console.log(fails.map((f) => `  ✗ ${f}`).join('\n\n') + '\n');
  process.exit(1);
}
