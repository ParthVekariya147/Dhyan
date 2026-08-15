import { supabase } from '../../../lib/supabase';
import { saveError } from '../../../lib/errors';

/**
 * સંચાલક data access — the other half of the /users section (0038).
 *
 * Until 0038 an administrator was a row in `profiles` with an `admin_profiles` row hanging
 * off it, which meant he needed an SMK, a learning record and — because `profiles.mobile` is
 * NOT NULL, UNIQUE and immutable — an invented ten-digit number that then worked as a real
 * login identifier through netlify/functions/login-mobile.js. `public.admins` keys off
 * `auth.users` instead: an administrator needs no profile, and his mobile number is contact
 * information that grants nothing.
 *
 * Shaped like userService.js beside it on purpose — same camelCase-in / snake_case-out
 * mapping, same `if (error) throw error`, same bounded reads — so the two files in one folder
 * do not read as two different codebases.
 *
 * One thing here is unlike every other service in the panel: creating an administrator is
 * NOT a database write. See createAdmin() at the bottom.
 *
 * Nothing here can delete. `admins_no_delete()` refuses a DELETE from anyone including
 * service_role, and there is no delete policy either: §7's "suspend, never delete" is a
 * property of the table rather than a habit of the UI. setStatus() is the whole of it.
 */

const TABLE = 'admins';

/**
 * Every column, named rather than `*`.
 *
 * userService selects `*` because it reads a view whose shape is the point. This is a table
 * a person's identity lives in, and listing the columns is what stops a column added later
 * — a note, an invite token — from arriving in a payload nothing asked for.
 */
const COLUMNS = 'id, email, name, mobile, role, status, display_name, created_at, updated_at, created_by';

/**
 * The whole list, and it fits.
 *
 * There is no pagination here and that is a decision rather than an omission: §12 sizes the
 * સંઘ at ~2,000 યુવકો and a handful of administrators, and a Pager over five rows is a control
 * that answers nothing. The cap exists anyway, because "there are only ever a few" is an
 * assumption and an unbounded select is how it stops being true quietly. If it is ever
 * reached the page says so rather than silently showing part of a list.
 */
export const LIST_CAP = 200;

/**
 * Administrators, newest first.
 *
 * Every filter is applied in the database, like the યુવક list — not because 200 rows need it,
 * but because a filter done in React is a filter the cap can cut off before it runs.
 *
 * RLS decides what comes back: `id = auth.uid() or has_permission('admins.read')`. So a
 * COORDINATOR calling this receives exactly one row - his own, by the first half of that
 * policy - and an ADMIN receives everyone. That is also why the tab is hidden behind
 * `admins.read` rather than left to look empty: a list of one is a wrong answer, not a refusal.
 * A read refused by a policy is an empty result and never an error
 * — admin/src/lib/errors.js explains why — which is the reason the tab that calls this is
 * hidden behind the same permission rather than left to discover it here.
 */
export async function listAdmins({ role = '', status = '', term = '' } = {}) {
  let q = supabase.from(TABLE).select(COLUMNS);

  if (role) q = q.eq('role', role);
  if (status) q = q.eq('status', status);

  const search = String(term || '').trim();
  if (search) {
    // `ilike` on both halves, and a contains match rather than the yuvak list's prefix:
    // an administrator is looked up by whichever fragment the person asking remembers, and
    // there are too few rows for the missing index to matter. The comma and the parentheses
    // are PostgREST's own `or` syntax, so a term containing them would be read as more
    // filters — the same removal applyTerm() does in userService.
    const safe = search.replace(/[,()]/g, '');
    q = q.or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  // One extra row, exactly as the paginated lists do, so "the cap was reached" is answered
  // without a second count query.
  const { data, error } = await q.order('created_at', { ascending: false }).range(0, LIST_CAP);
  if (error) throw error;

  const all = data || [];
  return { rows: all.slice(0, LIST_CAP).map(toAdmin), truncated: all.length > LIST_CAP, cap: LIST_CAP };
}

/** One administrator. Null rather than a throw when the row is absent or not readable. */
export async function getAdmin(id) {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toAdmin(data) : null;
}

/*
  The three writes.

  Each sends exactly the column it is named for and nothing else. That is not tidiness: the
  `admins_guard()` trigger compares NEW against OLD field by field, so a patch that carried
  `status` unchanged alongside a new `role` would still be a role change *and* a status change
  as far as `has_permission('admins.disable')` is concerned, and an administrator holding only
  roles.assign would be refused for a change he did not make.

  `updated_at` is deliberately not sent. The trigger sets it from the database clock, which is
  the only clock that cannot be wrong or lied to.

  `.select().single()` on each, so the row that comes back is the row Postgres actually holds
  after every trigger has run — the caller patches its list from that rather than from what it
  hoped it wrote.
*/

export const setRole = (id, role) => patch(id, { role });

export const setStatus = (id, status) => patch(id, { status });

/**
 * The optional label — "સંચાલક (વરાછા)" — and not the name.
 *
 * It is the one field the guard lets an administrator change on his own row: editing your own
 * display_name is allowed, changing your own role or status is not, whoever you are.
 */
export const updateDisplayName = (id, value) =>
  patch(id, { display_name: String(value ?? '').trim() || null });

async function patch(id, values) {
  const { data, error } = await supabase
    .from(TABLE)
    .update(values)
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toAdmin(data);
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Appointing an administrator, which the browser cannot do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admins.id` references `auth.users`, so a new administrator needs an auth account first —
 * and creating one is `auth.admin.createUser()`, which needs the project's secret key. A
 * secret key in a browser bundle is a secret key published on the internet (§50), so this one
 * write in the whole panel goes through a server function instead: it verifies the caller's
 * own token, checks `admins.create` against the same matrix the RLS policy uses, creates the
 * auth user with the secret key and inserts the row.
 *
 * The caller's access token is forwarded rather than any shared secret. The endpoint therefore
 * knows *who* is asking and can refuse a CONTENT_MANAGER exactly as the policy would, and the
 * `audit_admin()` trigger records the appointment under the administrator who made it instead
 * of under an anonymous service account.
 *
 * The contract:
 *
 *   200   { id, role, email }
 *   4xx   { code, gu, detail? }
 *   5xx   { code, gu }
 *
 * `code` is one of bad-request | not-authenticated | not-permitted | email-taken |
 * weak-password | setup-incomplete | server-error, and it is read from `code` with `error`
 * accepted as a fallback: the interface was specified as `{ error }` and shipped as `{ code }`,
 * and a client that reads only one of the two spellings turns every refusal into the generic
 * sentence. Reading both costs one `??`.
 *
 * `gu` is a Gujarati sentence for the યુવક app's voice and is deliberately NOT shown: this
 * panel is written in English throughout (see admin/src/lib/errors.js, whose maps are all
 * English), and one Gujarati notice appearing among English ones reads as a bug rather than
 * as a translation. The code is what this file words.
 *
 * `detail` is the interesting one. When the auth account was created but the `admins` insert
 * was refused, the function rolls the account back and passes the guard's own message through
 * as `detail` — so "an administrator cannot appoint themselves" survives the round trip and is
 * shown as itself rather than as the endpoint's flat "not-permitted".
 *
 * An unrecognised body — an HTML 502 from the platform, a rewritten error — is not guessed at.
 * It becomes an Error with no code, which adminWriteError() words as the general failure
 * sentence, and the console keeps the status for whoever has to look into it.
 */
export async function createAdmin({ email, password, name, mobile = '', role }) {
  /*
    getSession() rather than a token held in a module variable: supabase-js refreshes the
    access token in the background, and a copy taken at sign-in would be an hour stale by the
    time somebody appoints a colleague — which the endpoint would correctly reject as
    not-authenticated, on a screen where the person's session is plainly fine.
  */
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  // Refused here rather than sent as an anonymous request, so the sentence a person reads is
  // about his session having lapsed and not about a permission he does hold.
  if (!token) throw apiError('not-authenticated');

  const res = await fetch('/api/create-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: String(email || '').trim().toLowerCase(),
      password,
      name: String(name || '').trim(),
      // Omitted entirely when blank rather than sent as '': the column is nullable and
      // CHECKed against '^[6-9][0-9]{9}$', which an empty string fails.
      ...(String(mobile || '').trim() ? { mobile: String(mobile).trim() } : {}),
      role,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.code ?? body?.error;
    console.error('[admin] create-admin refused', res.status, code || '', body?.detail || '');
    throw apiError(code, body?.detail);
  }
  return body?.id || null;
}

/**
 * The endpoint's five codes, worded for the person who pressed the button.
 *
 * Deliberately the same shape as the maps in admin/src/lib/errors.js — a code looked up as an
 * own property, one calm sentence out, everything unmapped falling through — and deliberately
 * NOT in that file: these are the contract of one endpoint that one form calls, and errors.js
 * is where the codes *every* page can meet live.
 */
const API_ERRORS = {
  'not-authenticated': 'Your session has expired. Please log in again and try once more.',
  'not-permitted': 'You do not have permission to add an administrator.',
  'email-taken': 'An account already exists with this email address. Give the person a role on that account instead of creating a second one.',
  'weak-password': 'That password is too weak. Use a longer one - at least eight characters, and no more than 72.',
  'bad-request': 'The details entered are not valid. Please check the email, the name and the role.',
  // The two the endpoint answers with when the fault is not the person's. Named as a setup
  // problem in the same words errors.js uses for a missing migration, because it is the same
  // kind of problem and it cannot be fixed by trying again: SUPABASE_SECRET_KEY has not been
  // configured for this deploy.
  'setup-incomplete': 'Adding administrators is not switched on yet. Please inform whoever built the panel.',
  'server-error': 'The server could not add the administrator. Nothing was created - please try again, and tell whoever built the panel if it keeps happening.',
};

const apiError = (code, detail) =>
  Object.assign(new Error(`create-admin: ${code || 'unknown'}`), {
    apiCode: code || '',
    // The guard's own refusal, when the insert was the half that failed. Kept separate from
    // `message`, which is a developer string, so adminWriteError() can look it up in the same
    // table it uses for a refusal that arrived over PostgREST.
    apiDetail: detail || '',
  });

/**
 * ────────────────────────────────────────────────────────────────────────────
 * What the database refuses, said out loud
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admins_guard()` (0038) raises eight distinct refusals, and every one of them arrives as
 * SQLSTATE P0001 — for which errors.js has exactly one sentence, "This change does not follow
 * the rules. The server has blocked it." That sentence is right for a trigger whose message is
 * developer English about an internal invariant. It is wrong for these: each of the eight
 * names a rule about *administering people* that the person reading it either has to accept
 * ("you cannot change your own role") or can act on ("ask a SUPER_ADMIN"), and answering all
 * of them with one shrug withholds the answer while appearing to give one.
 *
 * So they are matched on their message text, which errors.js otherwise forbids — and for the
 * same reason it makes the exception for લેવલ ૪: 0038 states in a comment beside the guard
 * that these strings are asserted verbatim by scripts/test-rls.mjs and are part of the
 * contract, so they are identifiers that happen to read as English rather than prose that may
 * be reworded. An exact match, never a prefix: a message that has drifted must fall through to
 * the general sentence rather than be shown under a rule it no longer states.
 *
 * The two impossible ones are mapped anyway. A DELETE is never attempted by this panel, and an
 * insert through PostgREST is never attempted either (createAdmin goes to the endpoint), so
 * both would be bugs — but a bug that produces a sentence a person can quote is a bug report,
 * and a bug that produces "there was a problem saving" is not.
 */
const GUARD_ERRORS = {
  'an administrator cannot appoint themselves':
    'An administrator cannot appoint himself. Someone else has to create the account.',
  'an administrator cannot change their own role or status':
    'You cannot change your own role or your own status. Another administrator has to make this change - which is what stops the last SUPER_ADMIN from locking himself out.',
  'not permitted to manage administrators':
    'You do not have permission to make changes to administrators.',
  'not permitted to assign roles': "You do not have permission to change anyone's role.",
  'not permitted to enable or disable administrators':
    'You do not have permission to suspend or re-enable an administrator.',
  'only a SUPER_ADMIN may change a SUPER_ADMIN':
    'Only a Super Admin may change another Super Admin.',
  'only a SUPER_ADMIN may grant SUPER_ADMIN': 'Only a Super Admin may grant the Super Admin role.',
  'administrators are disabled (status = DISABLED), never deleted':
    'An administrator is never deleted - suspend or disable the account instead, so the record of what he did stays attached to a person.',
};

/**
 * The one error function this feature's pages call. Endpoint codes first, then the guard's own
 * refusals, then everything errors.js already knows — a 42501 from the policy, a 23505 from
 * the unique index on the address, a dead network.
 */
export function adminWriteError(e) {
  // Before the endpoint's own code, deliberately. A 403 from /api/create-admin says only
  // "not-permitted", while its `detail` may say "an administrator cannot appoint themselves" —
  // which is the rule that was actually broken and the only one of the two he can act on.
  const detail = guardMessage(e?.apiDetail);
  if (detail) return detail;

  if (e?.apiCode && Object.prototype.hasOwnProperty.call(API_ERRORS, e.apiCode)) {
    return API_ERRORS[e.apiCode];
  }
  // A PostgREST refusal on one of the three table writes. Only P0001 is read as a guard
  // message; a 42501 from the policy stays with errors.js, which already words it.
  if (e?.code === 'P0001') {
    const guard = guardMessage(e.message);
    if (guard) return guard;
  }
  return saveError(e);
}

const guardMessage = (text) => {
  const key = String(text || '').trim();
  return Object.prototype.hasOwnProperty.call(GUARD_ERRORS, key) ? GUARD_ERRORS[key] : null;
};

/** Columns are snake_case in Postgres and camelCase everywhere above it. One place to translate. */
function toAdmin(v) {
  return {
    id: v.id,
    email: v.email || '',
    name: v.name || '',
    // Contact only, and genuinely optional since 0038 — an empty string here means "none
    // recorded" and the table prints a dash for it, which is not the same as a number the
    // panel failed to load.
    mobile: v.mobile || '',
    role: v.role || null,
    status: v.status || 'ACTIVE',
    displayName: v.display_name || '',
    createdAt: v.created_at || null,
    updatedAt: v.updated_at || null,
    createdBy: v.created_by || null,
  };
}
