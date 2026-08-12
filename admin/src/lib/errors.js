/**
 * Supabase error codes are not something to put in front of a સંચાલક (§12, §53).
 * Everything unmapped becomes one calm sentence; the real code goes to the console
 * so it is still debuggable.
 *
 * Three shapes arrive here, and they do not agree on where the code lives:
 *
 *   AuthError       thrown by adminAuth.jsx's login()/resetPassword(). `code` is a GoTrue
 *                   string ('invalid_credentials'), `status` is the HTTP status. A network
 *                   failure arrives as AuthRetryableFetchError with **no code at all** and
 *                   status 0.
 *   PostgrestError  thrown by every service under features/<name>/services, which all do
 *                   `const { data, error } = await ...; if (error) throw error`. `code` is
 *                   a Postgres SQLSTATE ('42501', '23505') or a PostgREST code
 *                   ('PGRST116'), and a network failure arrives with `code: ''`.
 *   Error           plain throws from our own code — saveScene()'s unknown-field guard,
 *                   getSupabase()'s unconfigured guard. No code, so they fall through to
 *                   the fallback sentence, which is correct: they are bugs, not conditions
 *                   a સંચાલક can act on.
 *
 * Because two of the three signal "the network died" by *omitting* the code, keying on
 * `e.code` alone can never see it. isNetwork() reads name/status/message instead.
 *
 * One thing this file cannot report, by design: an RLS *read* denial is not an error.
 * 0004_rbac.sql writes `select using (id = auth.uid() or has_permission('users.read'))`,
 * so a CONTENT_MANAGER opening /users receives an empty result rather than 42501 — the
 * page shows an empty table and dataError() is never called. Only a write the policy
 * refuses reaches here, as 42501 raised by the WITH CHECK.
 */

const NETWORK = 'Network problem. Please try again.';
const RELOGIN = 'Please log in again.';

/**
 * A schema the panel's code expects and the database does not have. Named as a setup
 * problem rather than a data problem, the way the old Firestore "create the index"
 * message was — a સંચાલક who sees this cannot fix it by retrying, and someone should be
 * told that a migration has not been applied.
 */
const SERVER_SETUP = 'The server setup is incomplete. Please inform whoever built the panel.';

/** supabase.auth.* — keyed on AuthError.code, GoTrue's own error-code strings. */
const LOGIN_ERRORS = {
  // Supabase will not say which half was wrong: an unknown email and a wrong password are
  // the same code, so that a login form cannot be used to find out who has an account.
  // Firebase's separate auth/wrong-password and auth/user-not-found have no equivalent
  // here and must not be faked by guessing from the message text.
  invalid_credentials: 'The email or password is incorrect.',

  email_address_invalid: 'That email address is not valid.',
  validation_failed: 'The details entered are not valid. Please check the email and password again.',

  // Normally unreachable and mapped anyway. scripts/seed-admin-supabase.mjs passes
  // email_confirm: true on both branches, and src/lib/auth.jsx documents that the project
  // runs with "Confirm email" OFF. It becomes reachable the moment that setting is turned
  // on in the dashboard — and then it is the *only* thing wrong, which a fallback sentence
  // would hide behind "લોગિન કરવામાં સમસ્યા આવી".
  email_not_confirmed: 'This email has not been confirmed yet. Please open the link sent to your email.',

  user_not_found: 'No account was found with these details.',
  user_banned: 'This account has been disabled.',

  over_request_rate_limit: 'Too many attempts. Please try again in a little while.',
  over_email_send_rate_limit: 'Too many emails sent. Please try again in a little while.',

  email_provider_disabled: 'Email/Password login is not enabled in Supabase.',

  request_timeout: NETWORK,

  // "પાસવર્ડ ભૂલી ગયા?" sends a link that expires.
  otp_expired: 'This link has expired. Please request a new one.',

  session_expired: RELOGIN,
  bad_jwt: RELOGIN,
};

/**
 * PostgREST reads — keyed on PostgrestError.code, which is a Postgres SQLSTATE or a
 * PGRSTxxx code. Branch on this and never on the message: the message is English, and
 * for a trigger it is the developer's own `raise exception` text.
 */
const DATA_ERRORS = {
  // insufficient_privilege. On a read this is a missing GRANT rather than a policy — a
  // policy denial returns no rows (see the header). On a write it is the WITH CHECK.
  '42501': 'You do not have permission to view this.',

  // JWT missing, malformed or expired.
  PGRST301: RELOGIN,
  PGRST302: RELOGIN,

  // .single()/.maybeSingle() got no row, or more than one.
  PGRST116: 'That record was not found.',

  // The schema the panel expects is not the schema the database has: a missing embedded
  // relationship (audit_logs → profiles), a missing RPC (effective_role, stage_breakdown),
  // a missing column (scenes.image_url before 0004), a missing table.
  PGRST200: SERVER_SETUP,
  PGRST202: SERVER_SETUP,
  PGRST204: SERVER_SETUP,
  '42703': SERVER_SETUP,
  '42883': SERVER_SETUP,
  '42P01': SERVER_SETUP,

  '57014': 'Loading the data took too long. Please try again.',
  '53300': 'The server is busy right now. Please try again in a little while.',
  '08006': NETWORK,

  // Constraint failures can surface on a read too, through an RPC that writes.
  '23505': 'These details are already used by another record.',
  '23503': 'This record is linked to another record.',
  '23514': 'The details entered do not follow the rules.',
  '23502': 'A required detail is empty.',
  '22P02': 'The details entered are not in the right format.',

  // raise_exception from a PL/pgSQL trigger — profiles_guard_immutable(),
  // admin_profiles_guard(), admin_profiles_no_delete(). Their messages are English
  // sentences written for a developer and must not be shown.
  P0001: 'This change does not follow the rules. The server has blocked it.',
};

/**
 * The same codes mean something different when the સંચાલક pressed સાચવો. Only the ones
 * whose wording changes are listed; everything else falls through to DATA_ERRORS.
 */
const WRITE_ERRORS = {
  // A COORDINATOR saving a દર્શન, or a CONTENT_MANAGER saving settings: 0004_rbac.sql's
  // `with check (has_permission('darshan.update'))` is what refuses it.
  '42501': 'You do not have permission to make this change.',

  // scenes_index_unique / scenes_order_unique from 0004, and profiles.smk / profiles.mobile
  // from 0001 — the same constraint the Firestore build had to fake with a companion doc.
  '23505': 'These details are already used for another record. Please enter something different.',
};

/**
 * Chrome says "Failed to fetch", Firefox "NetworkError when attempting to fetch resource",
 * Safari "Load failed", undici "fetch failed". Only consulted when there is no code, so a
 * genuine TypeError from our own code cannot be mislabelled as the network being down.
 */
const FETCH_FAILURE = /failed to fetch|fetch failed|networkerror|network error|network request failed|load failed/i;

function isNetwork(e) {
  if (!e) return false;
  // auth-js wraps every transport failure in this, with code undefined and status 0.
  if (e.name === 'AuthRetryableFetchError') return true;
  if (e.status === 0) return true;
  // postgrest-js returns `{ code: '', message: 'TypeError: Failed to fetch', ... }`.
  if (!e.code && FETCH_FAILURE.test(String(e.message || ''))) return true;
  return false;
}

function log(e) {
  if (!e) return;
  // `hint` is where Postgres puts the actual fix — for 42501 it is the literal GRANT to
  // run. Logging only `message` throws that away.
  console.error('[admin]', e.code || e.name || '', e.message || e, e.hint || '');
}

/**
 * The code is server-supplied, so it is looked up as an own property only. `code` is a
 * plain string from the wire; a table lookup that walked the prototype chain would answer
 * 'constructor' with a function, and React renders a function by throwing.
 */
function pick(map, code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(map, code)
    ? map[code]
    : null;
}

export function loginError(e) {
  log(e);
  if (isNetwork(e)) return NETWORK;
  return pick(LOGIN_ERRORS, e?.code) || 'There was a problem logging in. Please try again.';
}

export function dataError(e) {
  log(e);
  if (isNetwork(e)) return NETWORK;
  return pick(DATA_ERRORS, e?.code) || 'There was a problem loading the data.';
}

export function saveError(e) {
  log(e);
  if (isNetwork(e)) return NETWORK;
  return (
    pick(WRITE_ERRORS, e?.code) ||
    pick(DATA_ERRORS, e?.code) ||
    'There was a problem saving. Please try again.'
  );
}

/**
 * Signed in, holds no role at all. Shown by RequireAdmin, and by the login page after a
 * sign-in that succeeded: the password was right and the permission is still missing, and
 * a form that simply re-renders says neither.
 */
export const NOT_ADMIN = 'You do not have permission to use the Admin Panel.';

/**
 * Signed in, holds a role, and that role does not reach this section — a COORDINATOR on
 * /settings, a CONTENT_MANAGER on /users. Stated rather than mimed: as the header above
 * explains, an RLS *read* denial returns an empty result and not an error, so the page
 * behind this would have rendered "there is nothing here" about data the સંચાલક is only
 * not allowed to see.
 */
export const NO_SECTION_PERMISSION = 'You do not have permission to open this section.';
