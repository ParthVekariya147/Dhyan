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

  /*
    REVOKED is not on this list, and that is the whole point of REVOKED.

    "Not an admin" means the appointment is undone: the person is a યુવક again, `yuvaks` starts
    returning him (0045 rewrites `admin_account_ids()` to skip him), and a screen headed
    સંચાલક that still listed him would be contradicting the યુવક list on the next tab. The row
    survives in `admins` so that the audit trail and his old grants can still be read — that is
    a record, not a membership, and this list is the membership.

    Not deleted from the filter, though: choosing "Not an admin" explicitly still finds them.
    Revoking is a thing somebody can do by mistake, and a list with no way back would make the
    undo depend on remembering the person's name well enough to find him among 2,000 યુવકો.
    Default view: gone. Deliberately asked for: there.
  */
  if (status) q = q.eq('status', status);
  else q = q.neq('status', 'REVOKED');

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

/**
 * The roles a સંચાલક may be given.
 *
 * A database read since 0043, where the five-value `admin_role` enum became rows in
 * `public.admin_roles` that the panel can add to. The list this replaced was a `ROLES`
 * constant in shared/domain/permissions.js, and it had to go for the same reason the matrix
 * beside it did: a dropdown built from the bundle cannot offer a role somebody created on
 * Tuesday, and would keep offering one that was deleted.
 *
 * Ordered by rank, highest first, because that is the order the roles mean something in —
 * Super Admin at the top, Viewer at the bottom — and it is stable as custom roles are added
 * between them. Readable by anyone holding any role at all (the `admin_roles` SELECT policy
 * is `is_admin()`), so the dropdown is populated even for a સંચાલક who cannot edit roles.
 */
export async function listRoles() {
  const { data, error } = await supabase
    .from('admin_roles')
    .select('key, label, description, is_system, rank')
    .order('rank', { ascending: false })
    .order('key');
  if (error) throw error;
  return (data || []).map((r) => ({
    key: r.key,
    label: r.label || r.key,
    description: r.description || '',
    isSystem: Boolean(r.is_system),
    rank: r.rank ?? 0,
  }));
}

/**
 * `{ SUPER_ADMIN: 'Super Admin', … }` — for the tables that print a role key they did not load
 * a row for. roleLabel() in shared/domain/permissions.js takes exactly this shape as its
 * second argument and humanises anything missing from it.
 */
export const roleLabels = (roles) =>
  Object.fromEntries((roles || []).map((r) => [r.key, r.label]));

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
 * ────────────────────────────────────────────────────────────────────────────
 * Giving an existing account a role, which the browser CAN do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The opposite case to createAdmin() above, and the one the panel had no answer for at all.
 *
 * createAdmin() exists because a *new* administrator has no `auth.users` row, and making one
 * needs the secret key. A યુવક who is already registered has had one since the day he signed
 * up — `profiles.id` **is** his `auth.users.id` — so appointing him is nothing more than an
 * INSERT into `public.admins` carrying that id. No account is created, no password is set or
 * seen, and nothing crosses a server function.
 *
 * Until now the only route was the add form, which would refuse him: the endpoint answers
 * `email-taken`, and its own message says "give the person a role on that account instead of
 * creating a second one" — advice the panel then offered no way to follow. The alternative
 * people reach for is worse: a second account on a different address, which splits one person
 * into two identities, leaves his learning record attached to the one he no longer signs in
 * with, and puts a second row in `public.profiles` that every count then includes.
 *
 * Everything that decides whether this is allowed happens inside the one request. The insert
 * policy asks for `admins.create`; `admins_guard()` refuses self-appointment, refuses a role
 * at or above the caller's own rank, and refuses SUPER_ADMIN from anyone who is not one;
 * `admins_fill_identity()` fills anything omitted from the profile; and `audit_admin()`
 * records ROLE_ASSIGNED under the caller. `created_by` is deliberately not sent — the guard
 * takes it from auth.uid(), which a browser cannot spoof.
 *
 * The identity columns ARE sent, though the trigger would fill them, because the profile is
 * already in hand and a value read from the row the સંચાલક picked is better than one
 * re-derived from an address. `mobile` is contact information here and grants nothing: login
 * for an administrator is by email, and netlify/functions/login-mobile.js resolves numbers
 * against `profiles` and never reads this column (0038).
 */
export async function promoteUser({ id, email = '', name = '', mobile = '', role }) {
  const row = {
    id,
    role,
    // Explicit, and it is what re-appoints somebody whose appointment was revoked. Without it
    // the upsert below would leave `status` at whatever it was, so restoring a REVOKED person
    // would quietly write his role and leave him not an administrator.
    status: 'ACTIVE',
    ...(String(email).trim() ? { email: String(email).trim().toLowerCase() } : {}),
    ...(String(name).trim() ? { name: String(name).trim() } : {}),
    // Omitted entirely when blank rather than sent as '': the column is nullable and CHECKed
    // against '^[6-9][0-9]{9}$', which an empty string fails.
    ...(String(mobile).trim() ? { mobile: String(mobile).trim() } : {}),
  };

  /*
    Upsert on the primary key, not a plain insert.

    An `admins` row is never deleted — `admins_no_delete()` refuses it for everyone including
    service_role — so undoing an appointment leaves the row behind at `status = 'REVOKED'`
    (0045). Appointing that person again is therefore an UPDATE, and a plain insert would come
    back as `23505`: a duplicate-key error about a row the person cannot see, on a screen whose
    search deliberately offers him because he is a યુવક again.

    The guard runs either way and is what decides whether this is allowed. On the UPDATE path
    it applies one extra rule: coming out of REVOKED asks for `admins.create` as well as
    `admins.disable`, because putting somebody back is an appointment rather than switching
    access on again.
  */
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'id' })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toAdmin(data);
}

/**
 * Does this account already hold a role?
 *
 * Asked before the search results are shown, so somebody who is already an administrator is
 * marked as one in the list instead of being offered as a candidate and then refused by the
 * primary key with `23505` — a duplicate-key error is a true statement about a row and tells
 * the person nothing about what to do next.
 *
 * Returns a Set of ids. RLS applies: without `admins.read` this comes back empty, and the
 * caller then simply offers everybody, which is the honest degradation — the insert is still
 * refused by the policy and the guard. Anyone who can reach this screen holds `admins.read`
 * (it is what the tab is gated on), so that path is theoretical.
 */
export async function existingAdminIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Set();
  const { data, error } = await supabase
    .from(TABLE)
    .select('id')
    // REVOKED is deliberately not counted. That state means the appointment was undone, so the
    // person is an ordinary યુવક again and appointing him is a perfectly ordinary thing to do -
    // marking him "already an administrator" would refuse the one action the screen exists for.
    // promoteUser() upserts, so the leftover row is updated rather than collided with.
    .neq('status', 'REVOKED')
    .in('id', list);
  if (error) throw error;
  return new Set((data || []).map((r) => r.id));
}

/*
  ────────────────────────────────────────────────────────────────────────────
  Roles, the catalogue, and per-person exceptions — what /access is built on
  ────────────────────────────────────────────────────────────────────────────

  All of it is ordinary PostgREST against the four tables 0043 added. There is no endpoint and
  no secret key anywhere in this half of the file, because none of it creates an account: a
  role is a row, a permission binding is a row, and an exception is a row.

  What stops any of it being dangerous is that the browser is not trusted with a single one of
  these decisions. `role_permissions_guard()`, `admin_grants_guard()` and `admin_roles_guard()`
  re-apply every rule — roles.manage, never SUPER_ADMIN, never at or above your own rank, never
  a permission you do not hold yourself — and they are BEFORE triggers, so they bind
  service_role too. Everything below is a form over a table whose triggers say no.
*/

/**
 * The permission catalogue, grouped as the role editor renders it.
 *
 * `public.permissions` is written by migrations alone, so this list is fixed for a given
 * deploy — but it is read rather than imported, because the label and the description live in
 * the table. shared/domain/permissions.js carries the keys for the build to check against and
 * deliberately carries no wording: a label in the bundle is one that can disagree with the key
 * it labels, and the person editing a role is reading the label.
 */
export async function listPermissions() {
  const { data, error } = await supabase
    .from('permissions')
    .select('key, resource, verb, label, description, is_section, sort')
    .order('sort')
    .order('key');
  if (error) throw error;
  return (data || []).map((p) => ({
    key: p.key,
    resource: p.resource,
    verb: p.verb,
    label: p.label || p.key,
    description: p.description || '',
    isSection: Boolean(p.is_section),
    sort: p.sort ?? 0,
  }));
}

/** Which permissions each role holds, as `{ ROLE_KEY: Set<permission> }`. */
export async function listRolePermissions() {
  const { data, error } = await supabase.from('role_permissions').select('role_key, permission');
  if (error) throw error;
  const out = {};
  for (const r of data || []) (out[r.role_key] ||= new Set()).add(r.permission);
  return out;
}

/**
 * How many administrators hold each role.
 *
 * Through `admin_role_usage()` (0044) rather than counting the rows this client can see: the
 * `admins` SELECT policy is `id = auth.uid() or has_permission('admins.read')`, so a browser
 * count is a count of what the policy let past. A role editor that said "this affects 1
 * administrator" when it affects nine is worse than one that said nothing.
 */
export async function roleUsage() {
  const { data, error } = await supabase.rpc('admin_role_usage');
  if (error) throw error;
  const out = {};
  for (const r of data || []) out[r.role_key] = { members: r.members, active: r.active_members };
  return out;
}

/**
 * Save a role's permission set as a diff, not as a replacement.
 *
 * The screen presents a grid of forty-six checkboxes and it would be simpler to delete every
 * row for the role and insert the ticked ones. That is wrong here for two separate reasons,
 * and the second is the serious one:
 *
 *   · `audit_role_permission()` writes one row per permission moved. A delete-all/insert-all
 *     would record forty-six revocations and forty-six grants every time somebody changed one
 *     checkbox, which buries the change that actually happened in the trail meant to show it.
 *   · For a moment mid-save the role would hold nothing. Anyone signed in under it would have
 *     his sidebar emptied and his next request refused — `has_permission()` reads these rows
 *     live, on every query.
 *
 * So only the difference is written. Each statement is independently subject to the guard,
 * which is also why they are not wrapped in a single call: a permission the caller may not
 * grant is refused on its own row and the rest still apply, and the screen re-reads to show
 * exactly what landed.
 */
export async function setRolePermissions(roleKey, next) {
  const current = (await listRolePermissions())[roleKey] || new Set();
  const want = new Set(next);

  const toAdd = [...want].filter((p) => !current.has(p));
  const toRemove = [...current].filter((p) => !want.has(p));

  if (toAdd.length) {
    const { error } = await supabase
      .from('role_permissions')
      .insert(toAdd.map((permission) => ({ role_key: roleKey, permission })));
    if (error) throw error;
  }
  if (toRemove.length) {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_key', roleKey)
      .in('permission', toRemove);
    if (error) throw error;
  }
  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * A new role.
 *
 * `is_system` is never sent: the guard forces it false on insert, and a client that tried
 * would be quietly overruled rather than refused — so not sending it keeps the request an
 * honest description of what is being asked for.
 *
 * `rank` decides who may administer whom, and the guard refuses anything at or above the
 * caller's own. The screen offers only ranks below his for that reason.
 */
export async function createRole({ key, label, description = '', rank }) {
  const { data, error } = await supabase
    .from('admin_roles')
    .insert({ key: String(key).trim().toUpperCase(), label: String(label).trim(), description, rank })
    .select('key, label, description, is_system, rank')
    .single();
  if (error) throw error;
  return data;
}

/** The label, the description and the rank. Never the key - renaming a role would orphan the
    `admins.role` rows pointing at it, which is what the foreign key is there to prevent. */
export async function updateRole(key, { label, description, rank }) {
  const patch = {};
  if (label !== undefined) patch.label = String(label).trim();
  if (description !== undefined) patch.description = description;
  if (rank !== undefined) patch.rank = rank;
  const { data, error } = await supabase
    .from('admin_roles')
    .update(patch)
    .eq('key', key)
    .select('key, label, description, is_system, rank')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Delete a role. Refused by the guard if it is a system role or if anybody holds it — the
 * second names the number, so the message can be acted on rather than merely understood.
 */
export async function deleteRole(key) {
  const { error } = await supabase.from('admin_roles').delete().eq('key', key);
  if (error) throw error;
}

/** One administrator's exceptions, newest first. */
export async function listGrants(adminId) {
  const { data, error } = await supabase
    .from('admin_grants')
    .select('admin_id, permission, effect, reason, expires_at, granted_by, granted_at')
    .eq('admin_id', adminId)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((g) => ({
    adminId: g.admin_id,
    permission: g.permission,
    effect: g.effect,
    reason: g.reason || '',
    expiresAt: g.expires_at || null,
    grantedBy: g.granted_by || null,
    grantedAt: g.granted_at || null,
  }));
}

/**
 * Add or replace one exception.
 *
 * Upsert rather than insert: the primary key is (admin_id, permission), so changing an ALLOW
 * to a DENY for the same permission is a change to the row that exists. An insert would come
 * back as `23505` — a duplicate-key error about a row the person is looking at and asking to
 * change, which is the least useful thing the screen could say.
 */
export async function setGrant({ adminId, permission, effect, reason, expiresAt = null }) {
  const { data, error } = await supabase
    .from('admin_grants')
    .upsert(
      {
        admin_id: adminId,
        permission,
        effect,
        reason: String(reason || '').trim(),
        expires_at: expiresAt,
      },
      { onConflict: 'admin_id,permission' }
    )
    .select('admin_id, permission, effect, reason, expires_at')
    .single();
  if (error) throw error;
  return data;
}

export async function removeGrant(adminId, permission) {
  const { error } = await supabase
    .from('admin_grants')
    .delete()
    .eq('admin_id', adminId)
    .eq('permission', permission);
  if (error) throw error;
}

/**
 * What this administrator may actually do, and why each one.
 *
 * `admin_effective_permissions()` (0044) rather than the same union assembled here from
 * `role_permissions` and `admin_grants`. That JavaScript would be a second implementation of
 * the resolution rule, and the first one is what every RLS policy in the schema consults — so
 * the two disagreeing means the panel stating, with confidence, that somebody may do something
 * the database will refuse. The screen exists to explain the gate; it must not be able to
 * describe a different one.
 *
 * `source` is 'bootstrap' | 'role' | 'granted' | 'denied'. A 'denied' row is a permission he
 * does NOT hold, returned so the screen can say why he is missing something the rest of his
 * role has.
 */
export async function effectivePermissions(adminId) {
  const { data, error } = await supabase.rpc('admin_effective_permissions', { p_admin: adminId });
  if (error) throw error;
  return (data || []).map((r) => ({
    permission: r.permission,
    source: r.source,
    expiresAt: r.expires_at || null,
  }));
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
