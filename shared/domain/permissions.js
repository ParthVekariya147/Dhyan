/**
 * સંચાલક permissions — the catalogue, and how the panel reads a resolved set.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this file stopped being
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Until 0043 this held MATRIX — a copy of `public.permissions_for()` — and answered
 * `can(role, permission)` from it. That duplication was deliberate and 0004 argued for it:
 * fetching the matrix before the panel could draw its first menu traded a startup round trip
 * for a duplication the build could check anyway.
 *
 * 0043 makes the matrix editable from the panel, and that argument does not survive the
 * change. A bundle carrying last week's copy of a table that a સંચાલક edited on Tuesday would
 * render a panel that disagrees with what the server enforces — offering a section that is
 * refused on arrival, or hiding one the person has been given. Both are worse than a round
 * trip, and the round trip turned out to be free: `adminAuth.jsx` already called
 * `effective_role()` on every page load, and `public.admin_session()` returns the whole answer
 * in that same call instead of half of it.
 *
 * **So MATRIX is deleted rather than deprecated.** A stale copy of a matrix that has moved
 * into the database is worse than no copy, because it is confidently wrong in whichever
 * direction is less obvious. `can()` now takes the permission list the server resolved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is still code, and why
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PERMISSIONS below is the *catalogue* — the names that exist. That half stays here, and it
 * stays here for the reason the whole design rests on: a permission name only means something
 * because some RLS policy or SECURITY DEFINER function checks it. `public.permissions` is
 * written by migrations and by nothing else (`permissions_immutable()`), so the panel can hand
 * out any name in this list and cannot invent one. This array is the same list, for the build
 * to check against — `scripts/test-permission-catalogue.mjs` asserts that this file, the
 * table, and every permission named in a migration all agree.
 *
 * None of this is the security boundary and it must never be treated as one. Every permission
 * is re-checked inside `public.has_permission()`, which is called from the RLS policy on every
 * table. A yuvak who edits this file out of his own copy of the bundle changes what he sees
 * and nothing about what the database returns.
 */

/**
 * Every permission the panel knows about, in the order the UI lists them.
 *
 * Mirrors the seed in supabase/migrations/0043_dynamic_rbac.sql. Labels and descriptions are
 * deliberately NOT here — they live in `public.permissions` and arrive with the data, because
 * the person editing a role needs to know what he is granting and a label in the bundle is one
 * that can disagree with the key it labels.
 */
export const PERMISSIONS = [
  'users.read', 'users.update', 'users.disable', 'users.test', 'users.purge', 'users.export',
  'users.smk.read',

  'progress.read', 'progress.detail.read', 'progress.export', 'sessions.read',

  'darshan.read', 'darshan.create', 'darshan.update', 'darshan.disable',
  'darshan.image.replace', 'darshan.reorder', 'darshan.import',

  'points.read', 'points.ledger.read', 'points.daily.read', 'points.records.read',
  'points.level3.read', 'points.leaderboard.read',
  'points.config.update', 'points.bonus.update', 'points.adjust',

  'levels.read', 'levels.update', 'level4.read', 'level4.update',

  'settings.read', 'settings.update',
  'video.update', 'navigation.update', 'appicon.update', 'dhun.update',

  'admins.read', 'admins.create', 'admins.update', 'admins.disable',
  'roles.assign', 'roles.manage', 'grants.manage', 'scope.assign',

  'audit.read', 'audit.export',
];

/**
 * The five roles the schema shipped with, and the only ones any code may name.
 *
 * They are not privileged — a custom role may hold exactly the same permissions and be exactly
 * as powerful. What is true of these five is that their *keys* are load-bearing elsewhere:
 * `admins_guard()` names SUPER_ADMIN in three rules, and `public.admin_roles.is_system` stops
 * them being renamed or deleted for that reason. Anything else in a roles dropdown comes from
 * the database, never from here.
 */
export const SYSTEM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CONTENT_MANAGER', 'COORDINATOR', 'VIEWER'];

const SYSTEM_ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CONTENT_MANAGER: 'Content Manager',
  COORDINATOR: 'Coordinator',
  VIEWER: 'Viewer',
};

/**
 * A role's label, for the places that have a key and no row to read it from.
 *
 * `public.admin_roles.label` is the real answer and every screen that has loaded the roles
 * should prefer it — `admin_session()` returns the caller's own, and adminService.listRoles()
 * returns the rest. This is the fallback for a key that arrived without one: the audit trail
 * records `actor_role` as a bare key, and a role deleted last month still appears there with
 * no row left to join to.
 *
 * ACCESS_MANAGER becomes "Access Manager" rather than being printed raw, which is what the
 * panel would otherwise show in the one place a role name outlives the role.
 */
export const roleLabel = (key, labels) => {
  if (!key) return '-';
  if (labels && labels[key]) return labels[key];
  if (SYSTEM_ROLE_LABELS[key]) return SYSTEM_ROLE_LABELS[key];
  return String(key)
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
};

/**
 * May this administrator do this one thing?
 *
 * Takes the resolved permission list rather than a role — that is the whole change 0043 makes
 * to this file. The list comes from `public.admin_session()`, which resolves the role's
 * permissions, adds every unexpired ALLOW grant and removes every DENY, on the server, in the
 * same function the RLS policies consult.
 *
 * @param {string[]|null|undefined} permissions
 * @param {string} permission
 */
export const can = (permissions, permission) =>
  Array.isArray(permissions) && permissions.includes(permission);

/** True when any of the listed permissions is held. For menu visibility. */
export const canAny = (permissions, list) => list.some((p) => can(permissions, p));

/**
 * Nothing held that ends in a mutating verb.
 *
 * Used by the panel to show a single "ફક્ત જોવા માટે" banner rather than disabling controls one
 * at a time. The verb list grew with 0043's splits: `.manage`, `.adjust`, `.purge`, `.test`,
 * `.replace`, `.reorder` and `.import` all write, and a banner that called a person read-only
 * while he could replace દર્શન images would be worse than no banner.
 */
const MUTATING = /\.(update|create|disable|assign|manage|adjust|purge|test|replace|reorder|import)$/;

export const isReadOnly = (permissions) =>
  Array.isArray(permissions) && permissions.length > 0 && !permissions.some((p) => MUTATING.test(p));
