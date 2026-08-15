import { supabase } from '../../../lib/supabase';
import { sanitizeMeta } from '../../../../../shared/domain/audit.js';

/**
 * §41, §42 — who changed what, and when.
 *
 * Since 0004_rbac.sql this is used for exactly one action: ADMIN_LOGIN. Every other entry
 * is written by a database trigger inside the same transaction as the change it records,
 * which is what makes it impossible to skip. Signing in changes no governed table, so no
 * trigger can observe it, and it stays here.
 *
 * `at` defaults to now() in the database rather than being sent by the client, so an
 * entry cannot be backdated. The RLS insert policy pins actor_id to auth.uid(), so a
 * change cannot be attributed to someone else. There is no update or delete policy for
 * anyone, admins included — an audit trail that can be edited is decoration.
 *
 * actorName is not stored: it would go stale the moment a yuvak's name changed, and the
 * name is resolved at read time instead — see actorNames() below for where it now comes from.
 */
export async function writeAudit({ actorId, actorRole = null, action, targetId = '', resourceType = '', meta = {} }) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_id: actorId,
    actor_role: actorRole,
    action,
    resource_type: resourceType,
    target_id: targetId,
    meta: sanitizeMeta(meta),
  });
  if (error) throw error;
}

/**
 * A failed audit write must not undo a change the admin already made, nor look like the
 * change failed. It is logged loudly and surfaced by the caller as a warning beside the
 * success message.
 */
export async function tryWriteAudit(entry) {
  try {
    await writeAudit(entry);
    return true;
  } catch (e) {
    console.error('[admin] audit write failed', e);
    return false;
  }
}

/** Newest first. No realtime subscription — an audit log is history (§83). */
export async function listAudit({ pageSize = 50, cursor = null, action = '' } = {}) {
  const offset = Number(cursor) || 0;
  let q = supabase
    .from('audit_logs')
    // `before` and `after` are the diff, and since 0004_rbac.sql they are the *only*
    // record of what a change did. Every trigger — audit_profile(), audit_admin_profile(),
    // audit_scene(), audit_setting() — writes to_jsonb(old)/to_jsonb(new) into those two
    // columns and never touches `meta`, which keeps its '{}'::jsonb default. Selecting
    // `meta` alone, as this did, therefore rendered "Details: —" on every row except
    // ADMIN_LOGIN: the trail said a દર્શન had been updated and could not say what about it
    // changed, which is the one question an append-only log exists to answer (§41, §42).
    //
    // `actor_role` and `resource_type` are the other two columns §8 asked for and 0004
    // added; the page shows the role the actor was acting *as* at the time, which is not
    // the role his admin_profiles row carries today.
    //
    // Both jsonb columns are whole rows, so a `profiles` entry carries the yuvak's mobile
    // and SMK. That is not a leak — the select policy on audit_logs is
    // `has_permission('audit.read')`, which only SUPER_ADMIN and ADMIN hold — but it is
    // why the page renders a short summary rather than dumping the objects.
    //
    // The actor's name is NOT selected here any more. It used to be an embedded
    // `profiles!audit_logs_actor_id_fkey(name)`, and 0038 made that impossible in two ways at
    // once — see actorNames() below.
    .select('id, action, resource_type, target_id, actor_role, meta, before, after, at, actor_id');

  if (action) q = q.eq('action', action);

  const { data, error } = await q
    .order('at', { ascending: false })
    // `at` alone is not a total order, and .range() offsets assume one. audit_logs_at_idx
    // is (at desc), and `at` defaults to now() — which is the *transaction* clock, so
    // every row a single save writes shares one timestamp to the microsecond. Postgres is
    // free to return tied rows in a different order for each query, so a tie straddling a
    // page boundary shows one row twice and hides another when the સંચાલક presses Next.
    // `id` is a bigserial (0001_init.sql), unique and monotonic, and breaks every tie the
    // same way on every query.
    .order('id', { ascending: false })
    .range(offset, offset + pageSize); // one extra row answers "is there a next page?"
  if (error) throw error;

  const page = (data || []).slice(0, pageSize);
  const names = await actorNames(page.map((r) => r.actor_id));

  const rows = page.map((r) => ({
    id: r.id,
    action: r.action,
    resourceType: r.resource_type || '',
    targetId: r.target_id,
    actorRole: r.actor_role || '',
    meta: r.meta,
    // Null for an INSERT — the row did not exist before — and the page tells that apart
    // from an UPDATE rather than showing an empty diff.
    before: r.before || null,
    after: r.after || null,
    at: r.at,
    actorId: r.actor_id,
    // Empty when the name could not be resolved, which is exactly what the embed produced
    // for a missing join — AuditLogPage falls back to the first eight characters of the id,
    // so a row never loses its actor, only his name.
    actorName: names.get(r.actor_id) || '',
  }));

  return {
    rows,
    cursor: rows.length ? offset + rows.length : null,
    hasNext: (data || []).length > pageSize,
  };
}

/**
 * Who the actors on this page are, over both identities (0038).
 *
 * This used to be a PostgREST embed on the read above:
 * `profiles!audit_logs_actor_id_fkey(name)`. 0038 broke it twice over, and the second break is
 * the one that mattered:
 *
 *   1. `audit_logs.actor_id` no longer references `profiles`. It was repointed at
 *      `auth.users`, because the old constraint quietly made a યુવક profile mandatory for
 *      every administrator — the AFTER triggers that write this trail run inside the same
 *      transaction as the change, so an administrator with no profile row could not edit a
 *      દ્રશ્ય or save a setting at all. There is no longer a named relationship for PostgREST
 *      to embed, and `auth` is not an exposed schema, so no embed can replace it.
 *   2. Since 0038 an actor may legitimately have no profile at all. Even if the embed still
 *      worked, every action taken by an administrator appointed after that migration would
 *      have rendered as a bare uuid.
 *
 * `public.actor_names()` answers over `admins` and `profiles` together. It is SECURITY DEFINER
 * with `has_permission('audit.read')` checked inside it — the permission that opens the page
 * these names appear on — so it returns nothing at all to anyone else rather than becoming a
 * way to read names a role holds no `users.read` over.
 *
 * Batched at 200 exactly as userService.getUsersByIds() is, and for the same reason: the ids
 * travel in the request body here rather than in a query string, so the 414 is not the
 * constraint, but a page of 100 audit rows and an audit export are the same code path, and one
 * `= any()` over thousands of uuids is a scan nobody asked for. The batches go out together, so
 * the cost is round trips in parallel rather than in sequence.
 *
 * A failure here is logged and swallowed, which is the one place this file does that
 * deliberately. The names are a courtesy on top of the record; the record itself — what
 * changed, when, and the actor's id — has already been read successfully by the time this
 * runs, and throwing would replace a page of history with an error message because a lookup of
 * display names did not answer.
 */
const ID_BATCH = 200;

async function actorNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  if (!unique.length) return out;

  const batches = [];
  for (let i = 0; i < unique.length; i += ID_BATCH) batches.push(unique.slice(i, i + ID_BATCH));

  try {
    const results = await Promise.all(
      batches.map(async (batch) => {
        const { data, error } = await supabase.rpc('actor_names', { ids: batch });
        if (error) throw error;
        return data || [];
      })
    );
    // `kind` ('admin' | 'yuvak') is returned by the function and deliberately not kept: the
    // trail already records the role the actor was acting *as* at the time, on the row, which
    // is the honest answer to "in what capacity" — and it is not the same answer as which
    // table his name happens to live in today.
    for (const batch of results) for (const row of batch) out.set(row.id, row.name || '');
  } catch (e) {
    console.error('[admin] actor names could not be resolved', e);
  }
  return out;
}
