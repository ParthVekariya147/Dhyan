import { supabase } from '../../../lib/supabase';
import {
  DEFAULT_GATE_THRESHOLD,
  L4_CONFIG_STATUS,
  toActivity,
  toConfig,
} from '../../../../../shared/domain/level4.js';

/**
 * લેવલ ૪ configurations, as the panel writes them.
 *
 * A configuration is a *version* of the sub-level layout: which દ્રશ્યો belong to ૪.૧, to
 * ૪.૨, and so on. Exactly one version is PUBLISHED at a time (the partial unique index in
 * 0010 enforces that, not this file), and a PUBLISHED version is never edited in place —
 * it is cloned into a new DRAFT and the clone is what changes. That rule is the whole
 * reason `cloneConfig()` exists, and the pages state it to the સંચાલક rather than cloning
 * behind his back.
 *
 * Two things deliberately do *not* live here:
 *
 *   · **Business rules.** Which selection is valid — duplicates, gaps, unknown items — is
 *     decided by `shared/domain/level4-selection.js`, which is pure and is shared with the
 *     યુવક side. A second opinion in a service is how the two stop agreeing.
 *   · **Authorisation.** Every write below is refused by `has_permission('settings.update')`
 *     inside the RLS policy on the table (§2.4), and both RPCs re-check it themselves. What
 *     the pages disable is the *button*; the database is the boundary.
 *
 * Column names are snake_case in Postgres and camelCase in the model, and the two are
 * mapped in one place here — the same arrangement darshanService.js uses, and for the same
 * reason: a camelCase name written straight at PostgREST fails as an unknown column, at
 * runtime, on the one save that mattered. Reads go through `toConfig` / `toActivity` in
 * shared/domain/level4.js so the panel and the યુવક app see one model.
 */

const CONFIGS = 'level4_configs';
const ACTIVITIES = 'level4_activities';
const ITEMS = 'level4_activity_items';
const PROGRESS = 'level4_activity_progress';

const CONFIG_COLUMN = {
  title: 'title',
  status: 'status',
  requireGate: 'require_gate',
  gateThreshold: 'gate_threshold',
};

const ACTIVITY_COLUMN = {
  code: 'code',
  title: 'title',
  description: 'description',
  position: 'position',
  active: 'active',
  // How many દ્રશ્યો of this કસોટી must be recalled to pass it (0016). null = all of them,
  // which is what every કસોટી composed before that migration means.
  requiredCount: 'required_count',
};

/** camelCase patch → the row PostgREST expects. An unknown field is a bug, so it throws. */
function toRow(patch, map, where) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (!col) throw new Error(`${where}: unknown field "${k}"`);
    row[col] = v;
  }
  return row;
}

/**
 * Who published a version, by name rather than by uuid.
 *
 * Read separately and allowed to fail. `profiles` is governed by `users.read`, which a
 * CONTENT_MANAGER does not hold — the policy answers him with zero rows rather than an
 * error (admin/src/lib/errors.js explains why), and a configuration list that refused to
 * load because a *name* was unreadable would be the wrong failure. Missing simply means
 * the line reads "Published 12 Aug 2026" with no "by".
 */
async function loadActorNames(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return {};
  try {
    const { data, error } = await supabase.from('profiles').select('id, name').in('id', wanted);
    if (error) throw error;
    return Object.fromEntries((data || []).map((p) => [p.id, p.name]));
  } catch (e) {
    console.warn('[admin] profile names unreadable, showing dates only', e);
    return {};
  }
}

/**
 * Every version, newest first.
 *
 * The activity count is tallied from a second small read rather than asked for as an
 * embedded aggregate: the count is what the સંચાલક picks a version by, and it must not
 * depend on PostgREST's aggregate syntax being available on whichever version is deployed.
 */
export async function listConfigs() {
  const { data: rows, error } = await supabase
    .from(CONFIGS)
    .select('*')
    .order('version', { ascending: false });
  if (error) throw error;

  const configs = (rows || []).map(toConfig);
  if (!configs.length) return [];

  const [{ data: acts, error: aErr }, names] = await Promise.all([
    supabase.from(ACTIVITIES).select('id, config_id, active'),
    loadActorNames(configs.map((c) => c.publishedBy)),
  ]);
  if (aErr) throw aErr;

  const tally = {};
  for (const a of acts || []) {
    const t = (tally[a.config_id] ||= { total: 0, active: 0 });
    t.total += 1;
    if (a.active) t.active += 1;
  }

  return configs.map((c) => ({
    ...c,
    activityCount: tally[c.id]?.total ?? 0,
    activeActivityCount: tally[c.id]?.active ?? 0,
    publishedByName: names[c.publishedBy] || '',
  }));
}

/**
 * One version, whole: the configuration, its activities in `position` order, and each
 * activity's દ્રશ્ય membership in the order the સંચાલક arranged it (§26 — configured order,
 * never re-sorted on read).
 *
 * `progressCount` is advisory. `level4_activity_progress` is readable only with
 * `progress.read` or for one's own row, so a CONTENT_MANAGER sees zero here for an activity
 * that has plenty — which is exactly why the pages offer *archive* as the ordinary action
 * and delete only as the narrow case (§28). The refusal that counts is in the database.
 */
export async function getConfig(configId) {
  const { data: row, error } = await supabase.from(CONFIGS).select('*').eq('id', configId).maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const { data: acts, error: aErr } = await supabase
    .from(ACTIVITIES)
    .select('*')
    .eq('config_id', configId)
    .order('position', { ascending: true });
  if (aErr) throw aErr;

  const activities = (acts || []).map(toActivity);
  const config = { ...toConfig(row), activities };
  if (!activities.length) return config;

  const ids = activities.map((a) => a.id);
  const [{ data: items, error: iErr }, progress] = await Promise.all([
    supabase
      .from(ITEMS)
      .select('activity_id, scene_id, position')
      .in('activity_id', ids)
      .order('position', { ascending: true }),
    supabase
      .from(PROGRESS)
      .select('activity_id')
      .in('activity_id', ids)
      .then(({ data, error: pErr }) => {
        if (pErr) throw pErr;
        return data || [];
      })
      .catch((e) => {
        console.warn('[admin] progress unreadable for this role, treating as unknown', e);
        return [];
      }),
  ]);
  if (iErr) throw iErr;

  const byActivity = {};
  for (const it of items || []) (byActivity[it.activity_id] ||= []).push(it.scene_id);

  const progressCounts = {};
  for (const p of progress) progressCounts[p.activity_id] = (progressCounts[p.activity_id] || 0) + 1;

  config.activities = activities.map((a) => ({
    ...a,
    sceneIds: byActivity[a.id] || [],
    progressCount: progressCounts[a.id] || 0,
  }));
  return config;
}

/**
 * A new DRAFT version.
 *
 * `version` is derived — max + 1 — and never a counter kept somewhere. Two સંચાલકો pressing
 * this at the same moment collide on the unique index, which is named here rather than
 * passed through: PostgREST's message quotes an index name that means nothing to the person
 * reading it. Same treatment createScene() gives the દર્શન collection.
 */
export async function createConfig({ title = '', requireGate = true, gateThreshold = DEFAULT_GATE_THRESHOLD } = {}) {
  const { data: top, error: tErr } = await supabase
    .from(CONFIGS)
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tErr) throw tErr;

  const { data, error } = await supabase
    .from(CONFIGS)
    .insert({
      version: (top?.version || 0) + 1,
      status: L4_CONFIG_STATUS.DRAFT,
      title: String(title || '').trim(),
      require_gate: !!requireGate,
      gate_threshold: Number(gateThreshold),
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Another version was just created. Reload and try again.');
    throw error;
  }
  return data.id;
}

export async function updateConfig(configId, patch) {
  // `updated_at` is deliberately not sent. 0010's `level4_configs_stamp` trigger sets it,
  // and its comment says why that has to be the database's job: a client that stamps its own
  // can stamp the value it is already holding and defeat the check it is taking part in.
  const row = toRow(patch, CONFIG_COLUMN, 'updateConfig');
  const { error } = await supabase.from(CONFIGS).update(row).eq('id', configId);
  if (error) throw error;
}

/**
 * §10 — a PUBLISHED version is edited by copying it, not by changing it.
 *
 * Deep copy, new version number, status DRAFT, done in one transaction inside
 * `level4_clone_config`. It is an RPC and not three statements from the browser because a
 * clone that copied the activities and then lost the network before the items would leave a
 * version that looks complete and teaches nothing.
 */
export async function cloneConfig(configId) {
  const { data, error } = await supabase.rpc('level4_clone_config', { p_config_id: configId });
  if (error) throw error;
  return data;
}

/**
 * Make a version live.
 *
 * Everything that makes this safe is in the RPC: the permission check, archiving whichever
 * version is currently PUBLISHED, and the swap, all atomically. The panel's job is to have
 * asked first and to show what is about to go live — never to sequence the writes itself,
 * because a half-published લેવલ ૪ is a યુવક with no sub-levels at all.
 */
export async function publishConfig(configId) {
  const { data, error } = await supabase.rpc('level4_publish', { p_config_id: configId });
  if (error) throw error;
  return data;
}

export const archiveConfig = (configId) => updateConfig(configId, { status: L4_CONFIG_STATUS.ARCHIVED });

export async function createActivity(configId, { code, title = '', description = '', position }) {
  const { data, error } = await supabase
    .from(ACTIVITIES)
    .insert({
      config_id: configId,
      code: String(code || '').trim(),
      title: String(title || '').trim(),
      description: String(description || '').trim(),
      position: Number(position),
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('That code or order is already used in this version.');
    throw error;
  }
  return data.id;
}

export async function updateActivity(activityId, patch) {
  // No `updated_at` here either — `level4_activities_stamp` sets it. See updateConfig.
  const row = toRow(patch, ACTIVITY_COLUMN, 'updateActivity');
  const { error } = await supabase.from(ACTIVITIES).update(row).eq('id', activityId);
  if (error) throw error;
}

/**
 * §28 — removal, for the one case where removal is honest.
 *
 * A sub-level a યુવક has already worked through is never deleted; it is deactivated, so his
 * COMPLETED row keeps pointing at something real and his coverage still counts (decision #4).
 * Deleting is offered only for a draft sub-level nobody has touched, and the cascade on
 * `level4_activity_items` is what makes it a single statement.
 */
export async function deleteActivity(activityId) {
  const { error } = await supabase.from(ACTIVITIES).delete().eq('id', activityId);
  if (error) throw error;
}

/**
 * §27 — renumber `position` so the given order is the order.
 *
 * One statement, not one per activity. `unique (config_id, position)` is DEFERRABLE INITIALLY
 * DEFERRED precisely so a rotation can pass through a state where two rows briefly share a
 * number; that only helps if every row moves inside the same transaction, and PostgREST gives
 * each request its own. So the whole set is written as a single upsert.
 *
 * The rows are re-read first and sent back whole. An upsert carrying only `{id, position}`
 * would be an INSERT that Postgres builds *before* it detects the conflict, and `code` and
 * `config_id` are NOT NULL — the update never gets a chance to run.
 */
export async function reorderActivities(configId, orderedActivityIds) {
  const { data: rows, error } = await supabase.from(ACTIVITIES).select('*').eq('config_id', configId);
  if (error) throw error;

  const byId = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  const next = orderedActivityIds
    .map((id, i) => (byId[id] ? { ...byId[id], position: i + 1 } : null))
    .filter(Boolean);

  // An order that does not name every activity would leave the unnamed ones holding numbers
  // the named ones are moving onto — a deferred constraint still fails at commit. Refusing
  // here says so in one sentence instead.
  if (next.length !== (rows || []).length) {
    throw new Error('The new order does not list every sub-level. Reload and try again.');
  }
  if (!next.length) return;

  const { error: uErr } = await supabase.from(ACTIVITIES).upsert(next, { onConflict: 'id' });
  if (uErr) throw uErr;
}

/**
 * Replace one sub-level's membership. `position` is the array order — §26, the સંચાલક's
 * arrangement is the order a યુવક sees, and nothing re-sorts it later.
 *
 * Delete-then-insert rather than a diff. The window in between is a sub-level with no items,
 * and it is survivable for one reason only: this configuration is a DRAFT, and a DRAFT is
 * withheld from `level4_published_config()` (§9), so nobody but the સંચાલક at this screen can
 * observe it. Saving again fixes it. A PUBLISHED version never reaches here — the pages send
 * that path through cloneConfig() first.
 */
export async function setActivityItems(activityId, sceneIds) {
  const { error: dErr } = await supabase.from(ITEMS).delete().eq('activity_id', activityId);
  if (dErr) throw dErr;

  // Distinct, order preserved: `primary key (activity_id, scene_id)` would reject a repeat
  // (§7 A), and the selection UI can produce one by adding two overlapping ranges.
  const seen = new Set();
  const rows = [];
  for (const id of sceneIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ activity_id: activityId, scene_id: id, position: rows.length + 1 });
  }
  if (!rows.length) return;

  const { error: iErr } = await supabase.from(ITEMS).insert(rows);
  if (iErr) throw iErr;
}
