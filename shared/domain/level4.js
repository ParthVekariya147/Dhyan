/**
 * લેવલ ૪ — the shape of a configuration, and the four rules that decide what a યુવક sees.
 *
 * Shared by the સંચાલક panel (which builds configurations) and the યુવક app (which renders
 * one), for the reason `constants.js` gives: two copies of a rule eventually disagree, and
 * the disagreement here would be visible as a card that says તાળું while the database
 * happily accepts the submission behind it.
 *
 * **The database is the authority.** `deriveStatuses()` below is an exact mirror of
 * `level4_activity_states()` in supabase/migrations/0010_level4_activities.sql — same four
 * rules, same branch order — and it exists so the UI can update the moment a submission
 * returns instead of waiting for a round trip. It is optimism, not a decision: every
 * `level4_state()` call replaces its answer, and `level4_submit()` re-checks all of it
 * server-side before an attempt exists at all (§37). If the two ever differ, this file is
 * the one that is wrong.
 *
 * Pure. No React, no Supabase, no fetch — so both apps and scripts/test-level4.mjs can
 * import it, and so the rules can be read without a running database.
 */

import { LEVEL4_UNLOCK_THRESHOLD } from './constants.js';

/** Mirrors the `status` check constraint on public.level4_configs. */
export const L4_CONFIG_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
});

/**
 * The five states a card can be in.
 *
 * Only three of them are rows: IN_PROGRESS, REVISION_REQUIRED and COMPLETED live in
 * `level4_activity_progress`. LOCKED and AVAILABLE are derived on every read and are
 * never stored — a stored lock goes stale the moment the સંચાલક reorders an activity.
 */
export const L4_ACTIVITY_STATUS = Object.freeze({
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  IN_PROGRESS: 'IN_PROGRESS',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  COMPLETED: 'COMPLETED',
});

/**
 * The gate a new configuration starts with — ૮૦ ticks in one day at લેવલ ૩.
 *
 * Re-exported rather than re-typed, because it is the *same* number as §7's unlock: the
 * default reproduces today's behaviour exactly, and a configuration whose gate the સંચાલક
 * has not touched agrees with `profiles.level4_unlocked` (0008's trigger, untouched by
 * this work). `level4_configs.gate_threshold` defaults to 80 on the database side; these
 * two must move together.
 */
export const DEFAULT_GATE_THRESHOLD = LEVEL4_UNLOCK_THRESHOLD;

/**
 * Four. Which level this whole module is about.
 *
 * It lived as `const LEVEL = 4` inside Level4Page.jsx, and that was right while exactly one
 * screen needed it. The completion moment is now said in two places — on the કસોટી screen the
 * moment the last one is finished, and on the list a યુવક returns to afterwards — and both
 * have to name the same level in the same sentence. Two literals that are meant to be one
 * number are two literals that will eventually differ, which is the argument
 * DEFAULT_GATE_THRESHOLD above is written to settle for the threshold; this settles it for
 * the number.
 *
 * Latin digits, deliberately. It is an identifier here and becomes ૪ at the edge, through
 * `gu()`, exactly as `activityCode()` below explains for '4.1'.
 */
export const LEVEL4_ID = 4;

/**
 * '4.1'. Latin digits — this is an identifier stored in a column with a CHECK constraint
 * (`code ~ '^[0-9]+\.[0-9]+$'`), not display text. `gu()` turns it into ૪.૧ at the edge,
 * where it is rendered.
 */
export const activityCode = (levelId, position) => `${levelId}.${position}`;

/** The number after the dot in '4.7', or null for anything that is not a code. */
const codeSuffix = (code) => {
  const m = /^\d+\.(\d+)$/.exec(String(code ?? ''));
  return m ? Number(m[1]) : null;
};

/**
 * The code to give the activity the સંચાલક is about to add.
 *
 * "One past the highest so far", counted from both `position` and the codes themselves,
 * and then advanced past anything already taken. Counting from `code` matters because the
 * two are independent by design (see the column comment in 0010): an activity keeps its
 * name through a reorder, so after ૪.૧ ↔ ૪.૩ are swapped the highest *position* is 3 while
 * the highest *code* is also 3 — but delete ૪.૩ and only the code remembers that the name
 * was used. Reusing a name a યુવક has already seen is the thing to avoid.
 */
export function nextActivityCode(activities, levelId = 4) {
  const list = Array.isArray(activities) ? activities : [];
  const taken = new Set(list.map((a) => String(a?.code ?? '')));

  let highest = 0;
  for (const a of list) {
    const pos = Number(a?.position);
    if (Number.isInteger(pos) && pos > highest) highest = pos;
    const suffix = codeSuffix(a?.code);
    if (suffix !== null && suffix > highest) highest = suffix;
  }

  let next = highest + 1;
  while (taken.has(activityCode(levelId, next))) next += 1;
  return activityCode(levelId, next);
}

/**
 * Both mappers accept either shape on purpose.
 *
 * PostgREST hands the panel snake_case columns; `level4_published_config()` hands the યુવક
 * app camelCase keys it built with jsonb_build_object. One model for both means the pages
 * do not each carry their own idea of what a configuration looks like.
 */
const pick = (row, snake, camel) => (row?.[snake] !== undefined ? row[snake] : row?.[camel]);

export function toConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version ?? null,
    status: row.status ?? L4_CONFIG_STATUS.DRAFT,
    title: row.title ?? '',
    requireGate: pick(row, 'require_gate', 'requireGate') ?? true,
    gateThreshold: pick(row, 'gate_threshold', 'gateThreshold') ?? DEFAULT_GATE_THRESHOLD,
    createdAt: pick(row, 'created_at', 'createdAt') ?? null,
    createdBy: pick(row, 'created_by', 'createdBy') ?? null,
    updatedAt: pick(row, 'updated_at', 'updatedAt') ?? null,
    updatedBy: pick(row, 'updated_by', 'updatedBy') ?? null,
    publishedAt: pick(row, 'published_at', 'publishedAt') ?? null,
    publishedBy: pick(row, 'published_by', 'publishedBy') ?? null,
  };
}

/**
 * `sceneIds` is always an array, in the order the સંચાલક arranged (§26), whether it
 * arrived as a jsonb array from the RPC or as an embedded `level4_activity_items` list
 * from PostgREST — which does not promise any order, so it is sorted here by `position`
 * rather than trusted.
 */
export function toActivity(row) {
  if (!row) return null;

  let sceneIds = pick(row, 'scene_ids', 'sceneIds');
  if (!Array.isArray(sceneIds)) {
    const items = row.level4_activity_items || row.items || [];
    sceneIds = [...items]
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map((i) => pick(i, 'scene_id', 'sceneId'))
      .filter(Boolean);
  }

  return {
    id: row.id,
    configId: pick(row, 'config_id', 'configId') ?? null,
    code: row.code ?? '',
    title: row.title ?? '',
    description: row.description ?? '',
    position: row.position ?? 0,
    active: row.active !== false,
    sceneIds,
    /*
      The pass mark (0016). **null means "all of them"** and is not the same as 0 — an
      activity requiring nothing would be passed by submitting nothing, which is why the
      column's check constraint starts at 1 and why this preserves null rather than
      defaulting it here. The number is resolved against the activity's real contents by
      `level4_required_count()` in SQL, which is the only place that decision is made.
    */
    requiredCount: pick(row, 'required_count', 'requiredCount') ?? null,
    createdAt: pick(row, 'created_at', 'createdAt') ?? null,
    updatedAt: pick(row, 'updated_at', 'updatedAt') ?? null,
  };
}

/** A progress row, from either source, keyed by the activity it belongs to. */
function progressByActivity(progressRows) {
  const map = new Map();
  for (const r of progressRows || []) {
    const id = pick(r, 'activity_id', 'activityId') ?? r?.id;
    if (id) map.set(id, r);
  }
  return map;
}

/**
 * §2.2, in JavaScript. The mirror of `level4_activity_states()`.
 *
 *   completed(a) = an explicit COMPLETED row  OR  (a has items AND all of them are covered)
 *   status(a)    = COMPLETED if completed(a)
 *                | LOCKED    if the gate is shut
 *                | LOCKED    if any active activity below it is not completed
 *                | whatever an explicit row says (REVISION_REQUIRED / IN_PROGRESS)
 *                | AVAILABLE
 *
 * The branch order is the rule and is not interchangeable. COMPLETED is asked *first* — ahead
 * of both the gate and the position check — so that neither can take back a કસોટી already
 * passed (§1 rule 4: a ધ્યાન already done is never taken away). The reorder case was always
 * covered; the gate case is 0012's, and it is the one that bites in practice, because
 * `gateOpen` is not a fact about the યુવક alone. It reads `gate_threshold` off the published
 * configuration, which the સંચાલક may raise — and a number moving must not read as a
 * punishment to someone standing below its new value.
 *
 * The two remaining LOCKED branches are untouched, and they are what keeps ક્રમ intact: a
 * કસોટી he has *not* completed is still shut by a closed gate and still shut by an unfinished
 * one before it. Nothing here opens ground that was not already walked.
 *
 * `coveredSceneIds` is the union of the દ્રશ્યો inside every activity the યુવક has
 * explicitly completed, in **any** version (`level4_state().coveredSceneIds`). That is what
 * carries progress across a new publication: an activity whose ground he has already walked
 * counts as walked, and only genuinely new દર્શન are asked of him.
 *
 * Inactive activities are dropped, exactly as the SQL does — a withheld activity is not
 * shown and does not block the one after it.
 *
 * @returns activities in position order, each with `{ status, attemptCount, revisionCount,
 *          completedAt }` merged in. `completedAt` is null for an activity credited
 *          through coverage: there was no moment at which he completed *that* activity.
 */
export function deriveStatuses({ activities, progressRows, coveredSceneIds, gateOpen } = {}) {
  const covered = coveredSceneIds instanceof Set ? coveredSceneIds : new Set(coveredSceneIds || []);
  const progress = progressByActivity(progressRows);

  const list = (Array.isArray(activities) ? activities : [])
    .filter((a) => a && a.active !== false)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const isCompleted = (activity) => {
    const row = progress.get(activity.id);
    if (row?.status === L4_ACTIVITY_STATUS.COMPLETED) return true;
    const ids = activity.sceneIds || [];
    return ids.length > 0 && ids.every((id) => covered.has(id));
  };

  // Walked in position order, so "is anything below this unfinished?" is a flag rather
  // than a re-scan — and, more to the point, is asked of the same set the SQL asks it of.
  let anythingBelowUnfinished = false;

  return list.map((activity) => {
    const row = progress.get(activity.id);
    const explicit = row?.status ?? null;
    const done = isCompleted(activity);

    let status;
    if (done) status = L4_ACTIVITY_STATUS.COMPLETED;
    else if (!gateOpen) status = L4_ACTIVITY_STATUS.LOCKED;
    else if (anythingBelowUnfinished) status = L4_ACTIVITY_STATUS.LOCKED;
    else if (
      explicit === L4_ACTIVITY_STATUS.REVISION_REQUIRED ||
      explicit === L4_ACTIVITY_STATUS.IN_PROGRESS
    ) {
      status = explicit;
    } else status = L4_ACTIVITY_STATUS.AVAILABLE;

    if (!done) anythingBelowUnfinished = true;

    return {
      ...activity,
      status,
      attemptCount: pick(row, 'attempt_count', 'attemptCount') ?? 0,
      revisionCount: pick(row, 'revision_count', 'revisionCount') ?? 0,
      completedAt: pick(row, 'completed_at', 'completedAt') ?? null,
    };
  });
}
