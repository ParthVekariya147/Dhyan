import { supabase } from '../../../lib/supabase';
import { getUsersByIds } from '../../users/services/userService';
// STAGE went with sessionTotals()'s second count; only the stage guard is still needed.
import { safeStage } from '../../../lib/domain';

/**
 * Progress (§38) and sessions (§40) read the two tables the યુવક app actually writes —
 * src/lib/learning.jsx is the other half of this file:
 *
 *   learning_state       one row per yuvak, the live position
 *   learning_sessions    one row per submitted round, history
 *
 * Under Firestore these were subcollections, read with collection-group queries that each
 * needed an index deployed before they would answer at all. Both are ordinary tables here,
 * so there is no index to deploy and no failed-precondition to explain. Access is one
 * policy per table (supabase/migrations/0004_rbac.sql): a caller without `progress.read`
 * or `sessions.read` sees only his own row, which is an empty page rather than an error.
 *
 * Nothing here is a listener (§83). A progress table does not need to redraw itself while
 * being read, and a standing listener per open page is a cost against a read budget that
 * has to serve 2,000 yuvaks (§84).
 */

/**
 * Postgres columns are snake_case; this module and the pages it feeds speak camelCase.
 * Mapping is confined to these two functions so no query has to think about it.
 */
const fromRow = (r) => ({
  currentStage: r.current_stage,
  sessionId: r.session_id,
  rememberedItemIds: r.remembered_item_ids || [],
  pendingItemIds: r.pending_item_ids || [],
  masteredItemIds: r.mastered_item_ids || [],
  completedSessions: r.completed_sessions ?? 0,
  totalAtSubmit: r.total_at_submit ?? 0,
  updatedAt: r.updated_at || null,
});

const fromSessionRow = (r) => ({
  rememberedItemIds: r.remembered_item_ids || [],
  pendingItemIds: r.pending_item_ids || [],
  total: r.total ?? 0,
  submittedAt: r.submitted_at || null,
  completedAt: r.completed_at || null,
  // 0004_rbac.sql:250 — `status` is the round's own lifecycle (STARTED / IN_PROGRESS /
  // COMPLETED / ABANDONED, default COMPLETED). It was never mapped, so the panel had to
  // guess the state from `completed_at` and called every submitted round "Active" until
  // the યુવક also finished Memory Darshan — a different fact, and not this column's.
  // The two stay separate here: `status` is what the round is, `completedAt` is when
  // memory recall ended.
  status: r.status || '',
});

const LEARNING = 'learning_state';
const SESSIONS = 'learning_sessions';

/** One yuvak's live position. Read on his detail page, not in any list. */
export async function getLearningState(uid) {
  const { data, error } = await supabase.from(LEARNING).select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data ? normaliseState(uid, fromRow(data)) : null;
}

/** One yuvak's submitted rounds, newest first and bounded. */
export async function getUserSessions(uid, { max = 30 } = {}) {
  const { data, error } = await supabase
    .from(SESSIONS)
    .select('*')
    .eq('user_id', uid)
    .order('submitted_at', { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data || []).map((r) => normaliseSession(uid, r.id, fromSessionRow(r)));
}

/**
 * §38 — organisation-wide progress, one page at a time.
 *
 * Ordered by `updatedAt` so the most recently active yuvaks come first, which is what a
 * સંચાલક opening this page is actually looking for. Stage is a WHERE clause, not an array
 * filter applied afterwards: the browser never receives a row it will not show.
 *
 * The સબઝોન filter is the one exception and the page says so. learning_state carries no
 * sub_zone_id, and copying the profile column into it would duplicate user data into a row
 * written on every stage change (§44) to save one filter.
 */
export async function listProgress({ pageSize = 20, cursor = null, stage = '' } = {}) {
  const offset = Number(cursor) || 0;
  let q = supabase.from(LEARNING).select('*');
  if (stage) q = q.eq('current_stage', stage);

  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .range(offset, offset + pageSize); // one extra row answers "is there a next page?"
  if (error) throw error;

  const page = (data || []).slice(0, pageSize);
  const rows = page.map((r) => normaliseState(r.user_id, fromRow(r)));
  await attachUsers(rows);

  return {
    rows,
    cursor: page.length ? offset + page.length : null,
    hasNext: (data || []).length > pageSize,
  };
}

/**
 * §11's date-range report, on the one activity date the app really writes.
 *
 * `learning_sessions.submitted_at` (0002_learning_fields.sql:13) is set by
 * src/lib/learning.jsx at submit, so a round genuinely carries the moment it happened.
 * That makes it the honest basis for "તારીખવાર અહેવાલ" — unlike `public.progress.date`,
 * which is the table §9's daily reset is built around and which nothing writes yet.
 *
 * Filtering on `submitted_at` rather than `created_at` keeps the range and the "Submitted"
 * column on screen talking about the same fact. The column is nullable (0002 added it
 * after 0001 created the table), so a row written before it existed falls outside every
 * range — there are none in this project, and inventing a `created_at` fallback would
 * silently date a round by when its row was inserted instead.
 *
 * The bounds are instants built by admin/src/lib/export.js istRange(); see the note there
 * on why a bare 'YYYY-MM-DD' would move the cut-off 5½ hours (§9).
 */
function applySessionRange(q, { fromIso = null, toIsoExclusive = null } = {}) {
  if (fromIso) q = q.gte('submitted_at', fromIso);
  if (toIsoExclusive) q = q.lt('submitted_at', toIsoExclusive);
  return q;
}

/**
 * "Completed only" is stated directly. Under Firestore it had to be smuggled into an
 * orderBy, because ordering by a field silently excludes rows lacking it and an inequality
 * filter would have forced a composite index. Neither applies here.
 *
 * It filters on `status`, the column 0004_rbac.sql:250 added for exactly this question,
 * not on `completed_at`. `completed_at` is written when Memory Darshan ends
 * (src/lib/learning.jsx complete()), so filtering on it answered a different question than
 * the checkbox asked and disagreed with the pill beside it.
 */
const applySessionFilters = (q, { completedOnly = false, fromIso = null, toIsoExclusive = null }) =>
  applySessionRange(completedOnly ? q.eq('status', 'COMPLETED') : q, { fromIso, toIsoExclusive });

/**
 * §40 — submitted rounds across everyone, newest first.
 */
export async function listSessions({
  pageSize = 20,
  cursor = null,
  completedOnly = false,
  fromIso = null,
  toIsoExclusive = null,
} = {}) {
  const offset = Number(cursor) || 0;
  const q = applySessionFilters(supabase.from(SESSIONS).select('*'), {
    completedOnly,
    fromIso,
    toIsoExclusive,
  });

  const { data, error } = await q
    // Always by submit time, in both modes. Ordering by `completed_at` put the rounds
    // whose recall is still open first (Postgres sorts NULLS FIRST descending) — newest
    // last, which is not what "newest first" promises.
    .order('submitted_at', { ascending: false })
    .range(offset, offset + pageSize);
  if (error) throw error;

  const page = (data || []).slice(0, pageSize);
  const rows = page.map((r) => normaliseSession(r.user_id, r.id, fromSessionRow(r)));
  await attachUsers(rows);

  return {
    rows,
    cursor: page.length ? offset + page.length : null,
    hasNext: (data || []).length > pageSize,
  };
}

/**
 * §11 — every round matching the filters on screen, for the export.
 *
 * Same predicate as listSessions(), applied through the same two helpers, so the file and
 * the table can never describe different sets. Chunked and capped for the reason
 * fetchAllUsers() is: a report that quietly stopped at one page is worse than none, so
 * `truncated` comes back with the rows and the page says so.
 *
 * Names are attached in one batch per chunk (§84), because a report of round scores with
 * no યુવક name in it answers nothing a સંચાલક asked.
 */
export const SESSION_EXPORT_CAP = 5000;

export async function fetchAllSessions({
  completedOnly = false,
  fromIso = null,
  toIsoExclusive = null,
  cap = SESSION_EXPORT_CAP,
  chunk = 1000,
} = {}) {
  const rows = [];
  let offset = 0;

  for (;;) {
    const q = applySessionFilters(supabase.from(SESSIONS).select('*'), {
      completedOnly,
      fromIso,
      toIsoExclusive,
    });

    const { data, error } = await q
      .order('submitted_at', { ascending: false })
      .range(offset, offset + chunk - 1);
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch.map((r) => normaliseSession(r.user_id, r.id, fromSessionRow(r))));

    if (batch.length < chunk) break;
    if (rows.length >= cap) {
      rows.length = cap;
      await attachUsers(rows);
      return { rows, truncated: true, cap };
    }
    offset += chunk;
  }

  await attachUsers(rows);
  return { rows, truncated: false, cap };
}

/**
 * How many yuvaks sit at each stage. One aggregation query per stage — eight small
 * server-side counts rather than 2,000 documents pulled into the browser to be tallied
 * (§15, §85). No precomputed analytics document: these already answer the question, and
 * a counter would be a second copy of the truth that can drift.
 */
export async function stageBreakdown() {
  // One GROUP BY instead of one count query per stage — see supabase/migrations/0003.
  const { data, error } = await supabase.rpc('stage_breakdown');
  if (error) throw error;
  return (data || []).map((r) => ({ stage: r.stage, count: Number(r.count) }));
}

/**
 * Total submitted rounds. One aggregation, and a head request — no row is transferred.
 *
 * It used to run a second count as well, of the yuvaks sitting at COMPLETED, and return it
 * as `completedUsers`. Nobody read it: the dashboard's "completed" figure comes out of
 * stageBreakdown() (dashboard/services/dashboardService.js), which already has that number
 * in the breakdown it fetches alongside this call. Two queries for one figure is also the
 * duplication §44 warns about — two counts of the same fact can disagree — so the wasted
 * round trip is gone and stageBreakdown() stays the single source.
 */
export async function sessionTotals() {
  const { count, error } = await supabase.from(SESSIONS).select('id', { count: 'exact', head: true });
  if (error) throw error;
  return { sessions: count ?? 0 };
}

/**
 * §39 — which scenes are most often left pending.
 *
 * This one is not an aggregation query today: `pending_item_ids` is a text[], and tallying
 * its members across every row would be an `unnest` in an RPC that does not exist yet. The
 * honest options are that RPC, a precomputed counter written at submit time, or a bounded
 * sample.
 *
 * A sample is what this returns, and the page states the sample size next to the result
 * rather than presenting it as the whole organisation. Adding a counter means one extra
 * write per submit — affordable, since submit is already one write per round — but it is
 * a change to the યુવક app's write path, and §94 says not to reach into that app for the
 * panel's convenience. When the product wants organisation-wide certainty here, the
 * counter goes in src/lib/learning.jsx's submit() and this function reads it instead.
 *
 * No individual yuvak is named in the result: aggregate is sufficient, so aggregate is
 * all that is exposed (§39).
 */
export async function pendingHotspots({ sampleSize = 200 } = {}) {
  const { data, error } = await supabase
    .from(SESSIONS)
    .select('remembered_item_ids, pending_item_ids')
    .order('submitted_at', { ascending: false })
    .limit(sampleSize);
  if (error) throw error;

  const pendingCount = new Map();
  const seenCount = new Map();

  for (const row of data || []) {
    const v = fromSessionRow(row);
    const pending = new Set(Array.isArray(v.pendingItemIds) ? v.pendingItemIds : []);
    const remembered = Array.isArray(v.rememberedItemIds) ? v.rememberedItemIds : [];
    for (const id of pending) {
      pendingCount.set(id, (pendingCount.get(id) || 0) + 1);
      seenCount.set(id, (seenCount.get(id) || 0) + 1);
    }
    for (const id of remembered) {
      seenCount.set(id, (seenCount.get(id) || 0) + 1);
    }
  }

  const rows = [...seenCount.entries()]
    .map(([id, seen]) => {
      const missed = pendingCount.get(id) || 0;
      return { id, seen, missed, rememberedPct: seen ? Math.round(((seen - missed) / seen) * 100) : 0 };
    })
    .sort((a, b) => a.rememberedPct - b.rememberedPct);

  // `snap.docs.length` until the Supabase port — a ReferenceError, not a bad number, so
  // every call to this function threw and the page showed the generic dataError sentence.
  return { sample: (data || []).length, rows };
}

// ---------------------------------------------------------------- shaping

function normaliseState(uid, v) {
  const remembered = Array.isArray(v.rememberedItemIds) ? v.rememberedItemIds.length : 0;
  const pending = Array.isArray(v.pendingItemIds) ? v.pendingItemIds.length : 0;
  // totalAtSubmit is the scene count as it stood when this yuvak submitted. Using it
  // rather than today's count means an old row is not re-scored against new content.
  const total = v.totalAtSubmit || remembered + pending;
  return {
    id: uid,
    uid,
    currentStage: safeStage(v.currentStage),
    sessionId: v.sessionId || null,
    remembered,
    pending,
    mastered: Array.isArray(v.masteredItemIds) ? v.masteredItemIds.length : 0,
    completedSessions: v.completedSessions || 0,
    total,
    updatedAt: v.updatedAt || null,
    user: null,
  };
}

function normaliseSession(uid, sessionId, v) {
  const remembered = v.rememberedCount ?? (Array.isArray(v.rememberedItemIds) ? v.rememberedItemIds.length : 0);
  const pending = v.pendingCount ?? (Array.isArray(v.pendingItemIds) ? v.pendingItemIds.length : 0);
  return {
    id: `${uid}/${sessionId}`,
    uid,
    sessionId: v.sessionId || sessionId,
    remembered,
    pending,
    total: v.total || remembered + pending,
    submittedAt: v.submittedAt || null,
    completedAt: v.completedAt || null,
    // Carried through unchanged; the pages label it, they do not re-derive it.
    status: v.status || '',
    user: null,
  };
}

/** Names for a page of rows, in batches of thirty rather than one read each (§84). */
async function attachUsers(rows) {
  const users = await getUsersByIds(rows.map((r) => r.uid)).catch(() => new Map());
  rows.forEach((r) => (r.user = users.get(r.uid) || null));
  return rows;
}
