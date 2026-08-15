/**
 * સંચાલક roles and what each one may do.
 *
 * This file is the *UI* copy of the matrix. It decides what the panel renders. It is not
 * the security boundary and must never be treated as one: every permission below is
 * re-checked inside `public.has_permission()` in Postgres, which is called from the RLS
 * policy on every table. A yuvak who edits this file out of his own copy of the bundle
 * changes what he sees and nothing about what the database returns.
 *
 * There are therefore two copies of one matrix — here, and in
 * `public.permissions_for(admin_role)` (supabase/migrations/0004_rbac.sql). That is
 * deliberate: the alternative is fetching the matrix over the wire before the panel can
 * draw its first menu, which trades a startup round-trip for a duplication the build can
 * check anyway. `node scripts/seed-admin.mjs` compares the two and reports any drift, the
 * same way it already does for the ADMIN_MOBILES list.
 *
 * Permission names are `resource.verb`. Only verbs the panel actually performs appear here —
 * there is no `users.create`, because a yuvak registers himself through the નોંધણી form.
 * A permission nothing checks is a false assurance.
 *
 * `darshan.create` was once absent for the same reason, and no longer is. The master list
 * is still built by `npm run content` from the સંચાલક's sheet, and that remains the way a
 * batch of દ્રશ્યો arrives — a hundred rows typed into a panel one at a time is not a
 * pipeline. What the sheet could not do is add a single દ્રશ્ય *now*, without a build and a
 * deploy, and that gap is what this permission closes. It is deliberately separate from
 * `darshan.update`: editing the વર્ણન of a દ્રશ્ય that exists and calling a new one into
 * existence are different acts, and the second is the one that can renumber the
 * collection, so a CONTENT_MANAGER may do both while the matrix keeps them distinguishable
 * in the audit trail.
 */

/** @typedef {'SUPER_ADMIN'|'ADMIN'|'CONTENT_MANAGER'|'COORDINATOR'|'VIEWER'} AdminRole */

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CONTENT_MANAGER', 'COORDINATOR', 'VIEWER'];

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CONTENT_MANAGER: 'Content Manager',
  COORDINATOR: 'Coordinator',
  VIEWER: 'Viewer',
};

export const roleLabel = (r) => ROLE_LABELS[r] || r || '-';

/** Every permission the panel knows about. The order is the order the UI lists them in. */
export const PERMISSIONS = [
  'users.read',
  'users.update',
  'users.disable',

  /*
    Marking an account as a test account, and deleting one.

    Not part of `users.update`, and the distance between them is the point. An edit changes
    what a row says; marking one `is_test` removes that person from every total, ranking,
    list and export this panel produces (0040) while leaving him able to sign in and carry on
    - a disappearance from the numbers that nobody would think to look for. `users.purge` then
    deletes a test account outright, which is the only deletion of a person this application
    allows anywhere.

    Both are SUPER_ADMIN only, by being absent from every other role's list below.
  */
  'users.test',
  'users.purge',

  'progress.read',
  'sessions.read',

  'darshan.read',
  'darshan.create',
  'darshan.update',
  'darshan.disable',

  'settings.read',
  'settings.update',

  'admins.read',
  'admins.create',
  'admins.update',
  'admins.disable',
  'roles.assign',

  'audit.read',
];

/**
 * The matrix.
 *
 * Read it against §10 of the governance spec — least privilege, and no role silently
 * inheriting the one above it:
 *
 *   · ADMIN cannot create, change or disable administrators, and cannot assign roles.
 *     Only SUPER_ADMIN administers administrators.
 *   · CONTENT_MANAGER gets no user administration at all.
 *   · COORDINATOR sees people and progress but changes nothing.
 *   · VIEWER holds no `.update`, `.create`, `.disable` or `.assign` permission of any
 *     kind, and is deliberately kept out of `audit.read`: the audit trail names who did
 *     what, which is the panel's most sensitive read.
 */
const MATRIX = {
  SUPER_ADMIN: PERMISSIONS,

  ADMIN: [
    'users.read',
    'users.update',
    'users.disable',
    'progress.read',
    'sessions.read',
    'darshan.read',
    'darshan.create',
    'darshan.update',
    'darshan.disable',
    'settings.read',
    'settings.update',
    'admins.read',
    'audit.read',
  ],

  CONTENT_MANAGER: [
    'darshan.read',
    'darshan.create',
    'darshan.update',
    'darshan.disable',
    'settings.read',
  ],

  COORDINATOR: ['users.read', 'progress.read', 'sessions.read', 'darshan.read'],

  VIEWER: ['users.read', 'progress.read', 'sessions.read', 'darshan.read', 'settings.read'],
};

/** @param {AdminRole|null|undefined} role */
export const permissionsFor = (role) => MATRIX[role] || [];

/**
 * @param {AdminRole|null|undefined} role
 * @param {string} permission
 */
export const can = (role, permission) => permissionsFor(role).includes(permission);

/** True when the role may perform any of the listed permissions. For menu visibility. */
export const canAny = (role, permissions) => permissions.some((p) => can(role, p));

/**
 * A role holding no permission ending in a mutating verb is read-only. Used by the panel
 * to show a single "ફક્ત જોવા માટે" banner rather than disabling controls one at a time,
 * and by the drift check to assert VIEWER never gains a write.
 */
const MUTATING = /\.(update|create|disable|assign)$/;
export const isReadOnly = (role) => !permissionsFor(role).some((p) => MUTATING.test(p));
