/**
 * auditLogs — what an administrator did, and when (§41, §42).
 *
 * Where the rows come from
 * ------------------------
 * The database writes them. `audit_scene()`, `audit_setting()`, `audit_profile()` and
 * `audit_admin_profile()` are AFTER triggers (supabase/migrations/0004_rbac.sql) that fire
 * inside the same transaction as the change, from `to_jsonb(old)` and `to_jsonb(new)` —
 * data the browser never supplies and cannot omit.
 *
 * That replaces the previous arrangement, where the panel wrote the row itself after a
 * successful save. The policy required an audit row to be *writable*; it could not require
 * that one be *written*, so an administrator running an edited bundle kept his access and
 * stopped leaving a trail.
 *
 * ADMIN_LOGIN is the exception and is still written by the panel: signing in changes no
 * governed table, so no trigger can observe it.
 *
 * A log is append-only. There is no update or delete policy on `audit_logs` for anyone,
 * સંચાલક included, and `at` defaults to now() in the database, so an entry cannot be
 * backdated or attributed to someone else.
 *
 * Where the *detail* comes from
 * -----------------------------
 * `before` and `after`, not `meta`. The triggers store `to_jsonb(old)` and `to_jsonb(new)`
 * and never write `meta`, which keeps its '{}'::jsonb default on every row they produce —
 * so a reader that shows `meta` alone shows nothing at all. `changedFields()` below turns
 * the pair into the short list of fields that actually moved, and
 * admin/src/features/audit/pages/AuditLogPage.jsx renders it.
 *
 * `meta` survives for ADMIN_LOGIN, the one action the panel still writes itself. It is a
 * small, human-readable summary and must never carry a password, a token, a
 * service-account key or any other credential (§41).
 */

export const AUDIT_COLLECTION = 'auditLogs';

export const ACTIONS = {
  ADMIN_LOGIN: 'ADMIN_LOGIN',

  // Content — derived from the diff by audit_scene().
  DARSHAN_UPDATED: 'DARSHAN_UPDATED',
  DARSHAN_PUBLISHED: 'DARSHAN_PUBLISHED',
  DARSHAN_ACTIVATED: 'DARSHAN_ACTIVATED',
  DARSHAN_DISABLED: 'DARSHAN_DISABLED',
  DARSHAN_ORDER_CHANGED: 'DARSHAN_ORDER_CHANGED',
  IMAGE_REPLACED: 'IMAGE_REPLACED',

  // Configuration — audit_setting().
  VIDEO_UPDATED: 'VIDEO_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  LEVEL_UPDATED: 'LEVEL_UPDATED',

  /*
    લેવલ ૪'s sub-level configuration — audit_level4_config() (0010_level4_activities.sql).

    Three of the four come from the AFTER UPDATE trigger, following 0004's rule that the
    database writes its own trail. LEVEL4_CONFIG_CLONED is the exception and is written by
    `level4_clone_config()` itself, because only that function knows which configuration
    the new draft was copied *from* — a trigger on the INSERT sees the copy and not the
    source.

    Creating an empty draft is deliberately not audited: it governs nothing until it is
    published, and a trail that records every abandoned draft buries the publishes.
  */
  LEVEL4_PUBLISHED: 'LEVEL4_PUBLISHED',
  LEVEL4_ARCHIVED: 'LEVEL4_ARCHIVED',
  LEVEL4_CONFIG_UPDATED: 'LEVEL4_CONFIG_UPDATED',
  LEVEL4_CONFIG_CLONED: 'LEVEL4_CONFIG_CLONED',

  // People — audit_profile() on profiles, and audit_admin_profile().
  USER_UPDATED: 'USER_UPDATED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_DISABLED: 'USER_DISABLED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ADMIN_UPDATED: 'ADMIN_UPDATED',
  ADMIN_ENABLED: 'ADMIN_ENABLED',
  ADMIN_DISABLED: 'ADMIN_DISABLED',
  /*
    0045. Undoing an appointment is not the same act as disabling an administrator, and the
    trail must not call them the same: only ADMIN_REVOKED returns the person to public.yuvaks,
    so it is the entry that explains why a name reappeared in every count on a given day.
  */
  ADMIN_REVOKED: 'ADMIN_REVOKED',
  ADMIN_RESTORED: 'ADMIN_RESTORED',

  /*
    Access itself — audit_admin_role(), audit_role_permission() and audit_admin_grant()
    (0043_dynamic_rbac.sql).

    Until 0043 the role→permission matrix was a hardcoded SQL function, so a change to it
    was a migration and the trail was the git history. It is a table now, editable from the
    panel, which means "who gave Coordinators the ability to award points, and when" is a
    question the audit log has to be able to answer.

    The permission entries are deliberately one row per permission moved, not one per save.
    The role editor writes the whole tick-box grid at once, so a single ROLE_UPDATED would
    say that something changed among forty-six checkboxes and leave the reader to diff two
    JSON blobs. `ROLE_PERMISSION_GRANTED points.adjust → COORDINATOR` is the sentence
    somebody actually needs a year later.
  */
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
  ROLE_PERMISSION_GRANTED: 'ROLE_PERMISSION_GRANTED',
  ROLE_PERMISSION_REVOKED: 'ROLE_PERMISSION_REVOKED',
  GRANT_ADDED: 'GRANT_ADDED',
  GRANT_REMOVED: 'GRANT_REMOVED',
};

/** Gujarati label for the list; unknown actions fall back to the raw code. */
export const ACTION_LABELS = {
  ADMIN_LOGIN: 'Admin login',

  DARSHAN_UPDATED: 'Darshan updated',
  DARSHAN_PUBLISHED: 'Darshan published',
  DARSHAN_ACTIVATED: 'Darshan activated',
  DARSHAN_DISABLED: 'Darshan disabled',
  DARSHAN_ORDER_CHANGED: 'Darshan order changed',
  IMAGE_REPLACED: 'Image replaced',

  VIDEO_UPDATED: 'Video link updated',
  SETTINGS_UPDATED: 'Settings updated',
  LEVEL_UPDATED: 'Level updated',

  LEVEL4_PUBLISHED: 'Level 4 configuration published',
  LEVEL4_ARCHIVED: 'Level 4 configuration archived',
  LEVEL4_CONFIG_UPDATED: 'Level 4 configuration updated',
  LEVEL4_CONFIG_CLONED: 'Level 4 configuration copied to a new version',

  USER_UPDATED: 'User details updated',
  USER_SUSPENDED: 'User account suspended',
  USER_DISABLED: 'User account disabled',
  ROLE_ASSIGNED: 'Admin appointed',
  ROLE_CHANGED: 'Admin role changed',
  ADMIN_UPDATED: 'Admin details updated',
  ADMIN_ENABLED: 'Admin enabled',
  ADMIN_DISABLED: 'Admin disabled',
  ADMIN_REVOKED: 'Admin appointment undone - back to being a yuvak',
  ADMIN_RESTORED: 'Admin appointment remade',

  ROLE_CREATED: 'Role created',
  ROLE_UPDATED: 'Role updated',
  ROLE_DELETED: 'Role deleted',
  ROLE_PERMISSION_GRANTED: 'Permission added to a role',
  ROLE_PERMISSION_REVOKED: 'Permission removed from a role',
  GRANT_ADDED: 'Permission granted to one person',
  GRANT_REMOVED: 'Individual permission removed',
};

export const actionLabel = (a) => ACTION_LABELS[a] || a || '-';

/** `resource_type` is the table name, so the trail reads the same as the schema. */
export const RESOURCE_LABELS = {
  scenes: 'Darshan',
  settings: 'Settings',
  profiles: 'User',
  admin_profiles: 'Admin',
  admins: 'Admin',
  level4_configs: 'Level 4',
  admin_roles: 'Role',
  role_permissions: 'Role permissions',
  admin_grants: 'Individual permission',
};

export const resourceLabel = (r) => RESOURCE_LABELS[r] || r || '-';

/**
 * Which fields of a `before`/`after` pair are worth showing.
 *
 * The trigger stores the whole row, which is the right thing to store and the wrong thing
 * to render: `updated_at` differs on every single change and says nothing. This lists the
 * keys whose difference is the change.
 */
const NOISE = new Set(['updated_at', 'created_at', 'at']);

export function changedFields(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = [];
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    const a = JSON.stringify(before[k] ?? null);
    const b = JSON.stringify(after[k] ?? null);
    if (a !== b) out.push({ field: k, from: before[k] ?? null, to: after[k] ?? null });
  }
  return out;
}

/**
 * Belt and braces against a careless caller putting a credential in `meta`. Anything
 * whose key looks like a secret is dropped before the write leaves the browser.
 *
 * Still used by the one remaining client-written action, ADMIN_LOGIN.
 */
const SECRET_KEY_RE = /pass|secret|token|credential|key|serviceaccount|private/i;

export function sanitizeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (v === undefined || typeof v === 'function') continue;
    out[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
  }
  return out;
}
