import { supabase } from '../../../lib/supabase';

/**
 * One yuvak's progress, read from the tables that are actually written.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this file exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * learningService.js reads `learning_state` and `learning_sessions`. Both are empty in
 * production and nothing writes them - the yuvak app records a level attempt in
 * `activity_attempts` / `daily_activity_progress`, a Level 4 sitting in `level4_attempts` /
 * `level4_activity_progress`, and an award in `point_transactions`. A detail page built on
 * the old pair would render four dashes and a "Not started yet" for every yuvak in the
 * project, which is the panel making a statement about people rather than about its own
 * schema.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * One RPC, and why it is not eight selects
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_user_progress_detail()` (0030_admin_progress_live_scenes.sql:584) returns the whole
 * document in one jsonb value. Assembled here instead, it would be: four attempt
 * aggregates, two `unnest`-and-distinct counts that PostgREST cannot express at all, the
 * published config, every Level 4 activity, and `level4_activity_states()` - which is the
 * only correct answer to "what is unlocked", because it carries the ક્રમ rule, the gate and
 * the coverage credit. Re-deriving that in the browser would be a second, weaker copy of a
 * rule the database owns (§44), and it would disagree with the yuvak's own screen the first
 * time either changed.
 *
 * The function is SECURITY DEFINER and opens with `admin_assert_progress_reader()`, so a
 * caller without `progress.read` **and** `users.read` gets a raised 42501 rather than an
 * empty document. That distinction is the point: admin/src/lib/errors.js explains that an
 * RLS read denial is silently an empty result, and a progress page that cannot tell "he has
 * done nothing" from "you may not ask" is one that will eventually be believed about the
 * wrong one. So an error here is a real error and the page shows it as one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The denominator is not in Postgres, so the caller brings it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Both functions below take `p_live_scene_ids`: the ids of the દર્શન collection as the yuvak
 * app currently computes it. The collection is `content/darshan.json` with `public.scenes` as
 * a sparse overlay on top, and the database has never seen the manifest - so only the browser
 * can say what the "of y" in "x of y" is. `admin/src/lib/liveScenes.js` computes it from the
 * same domain functions the yuvak app runs, and the page passes `live.ids` straight through.
 *
 * Passing null is allowed by the SQL and answered with a server estimate, which is why every
 * reply carries `contentSource`. This module never chooses that path: the page refuses to
 * render a report at all until the live collection has loaded, because a percentage measured
 * against a guessed denominator looks exactly like a correct one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is deliberately not here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No attempt list and no points list. `attempt_history` and `point_ledger` are already read
 * by activityService.js's listUserAttempts() / listUserPoints(), already paginated by the
 * house cursor contract, and already `security_invoker` - so the page imports those two
 * rather than growing a third copy of the same two queries here.
 *
 * No per-image figure for levels 1 and 2. Neither records scene ids: watching the વિડિયો
 * and doing દર્શન are not per-દ્રશ્ય acts, so every such attempt carries `total_items = 0`.
 * The document has no field to read and the page says so in words.
 */

/**
 * Counts arriving from jsonb. `typeof`, never `Number()`, for the reason activityService.js
 * gives: `Number(null)` is 0, so a coercing read turns a field the server did not send into
 * a figure the panel then states as fact.
 */
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * A count that may genuinely have no value. `max()` over no rows is null, and null is not
 * zero here: "he has never sat this કસોટી" and "his best sitting selected none" are
 * different sentences, and only the second is a figure. Kept null so the page can render a
 * dash rather than a 0 nobody scored.
 */
const maybeInt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** timestamptz | null, passed straight through - a service does not format (§62). */
const at = (v) => v || null;

/** A jsonb array of scene ids, filtered to the strings it should have held. */
const idList = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);

/**
 * `'app-manifest'` when the caller supplied the live collection, `'server-estimate'` when it
 * did not. Passed through rather than assumed, so the page can say which denominator it is
 * printing instead of the panel quietly presenting a guess as a measurement.
 */
const sourceOf = (v) => (v === 'app-manifest' ? 'app-manifest' : 'server-estimate');

/** A level's aggregate, in the shape all three share. */
const fromLevel = (l = {}) => ({
  status: l.status || 'NOT_STARTED',
  attempts: int(l.attempts),
  lastAt: at(l.lastAt),
  completedAt: at(l.completedAt),
});

/**
 * One Level 4 કસોટી, as the server sees it.
 *
 * `status` is `level4_activity_states()`'s own word and is passed through untranslated:
 * LOCKED, AVAILABLE, IN_PROGRESS, REVISION_REQUIRED, COMPLETED. LOCKED and AVAILABLE are
 * derived server-side and stored nowhere, which is exactly why they must not be re-derived
 * here.
 *
 * `completedAt` may be null on a COMPLETED કસોટી. That is not a missing timestamp to be
 * filled in - it means the કસોટી was credited by coverage rather than by a sitting, so
 * there is no moment to name and the page prints a dash instead of inventing one.
 */
const fromActivity = (a = {}) => ({
  activityId: a.activityId,
  code: a.code || '',
  title: a.title || '',
  position: int(a.position),
  // The pass mark, and the pool it is drawn from. `requiredCount` may be absent on an older
  // row; the page falls back to `itemCount` rather than this file guessing which is meant.
  requiredCount: maybeInt(a.requiredCount),
  itemCount: int(a.itemCount),
  status: a.status || 'LOCKED',
  attempts: int(a.attempts),
  revisionCount: int(a.revisionCount),
  completedAt: at(a.completedAt),
  passedAttempts: int(a.passedAttempts),
  bestSelected: maybeInt(a.bestSelected),
  lastAttemptAt: at(a.lastAttemptAt),
});

/**
 * One દ્રશ્ય he has ticked, and when.
 *
 * Ids only, deliberately: the number a yuvak reads and the વર્ણન he reads it by both live in
 * the manifest, so the page joins these rows to `live.scenes` rather than the database
 * inventing a second copy of a collection it cannot see.
 *
 * `firstAt` / `lastAt` are what turn a set of ids into a record - first remembered on one
 * date, last revised on another. `times` counts submissions, not દ્રશ્યો.
 */
const fromScene = (s = {}) => ({
  sceneId: s.sceneId,
  firstAt: at(s.firstAt),
  lastAt: at(s.lastAt),
  times: int(s.times),
  fromLevel3: Boolean(s.fromLevel3),
  fromLevel4: Boolean(s.fromLevel4),
});

/**
 * The latest of everything the document knows a date for.
 *
 * Folded here rather than on the page because it is one fact assembled from five, and every
 * one of them can be null for a yuvak who has not reached that level yet. Null when none of
 * them is set, so the page can say "nothing recorded yet" instead of printing an epoch.
 */
function lastActivityAt(d) {
  const stamps = [d.level1?.lastAt, d.level2?.lastAt, d.level3?.lastAt, d.level4?.lastAt, d.points?.lastAt]
    .filter(Boolean)
    .map((s) => ({ s, t: Date.parse(s) }))
    .filter((x) => Number.isFinite(x.t));
  if (!stamps.length) return null;
  return stamps.reduce((m, x) => (x.t > m.t ? x : m)).s;
}

/**
 * One yuvak's whole progress document, measured against the collection he is actually shown.
 *
 * Returns null when no profile carries that id - a link from an out-of-date list, which the
 * page meets with an empty state rather than an error. Every other failure throws, because
 * the RPC raises rather than returning nothing (see the header).
 *
 * The keys are already camelCase: `jsonb_build_object` names them in the migration, so
 * there is no snake_case mapping to do and this function normalises types rather than
 * spelling.
 *
 * @param {string}   uid         the yuvak
 * @param {string[]} liveIds     `live.ids` from loadLiveScenes(), the live collection
 */
export async function getUserProgressDetail(uid, liveIds = null) {
  const { data, error } = await supabase.rpc('admin_user_progress_detail', {
    p_user: uid,
    p_live_scene_ids: liveIds,
  });
  if (error) throw error;

  const d = data || {};
  // `user` is the only field that can be absent for a well-formed reply: every other
  // subquery aggregates and returns a row whatever the yuvak has done.
  if (!d.user) return null;

  const u = d.user;
  const l4 = d.level4 || {};
  const activities = Array.isArray(l4.activities) ? l4.activities.map(fromActivity) : [];

  return {
    user: {
      userId: u.userId,
      name: u.name || '',
      mobile: u.mobile || '',
      // Email is deliberately NOT carried through. The RPC returns it, because the same
      // document serves anything an authorised સંચાલક may need, but this panel has no screen
      // that should show it: it is the only route password recovery takes (§2.1) and it
      // answers no question a progress report asks. Dropping it here rather than in the page
      // means a future section cannot render it by reaching for `user.email` and finding it
      // sitting there. See the note beside the Summary list in UserProgressDetailPage.
      smk: u.smk || '',
      // `cityId` is profiles.zone_id and `zoneId` is profiles.sub_zone_id - the column names
      // and the words the panel uses for them diverged in 0030 and the RPC settles it. The
      // page labels them with zoneNameEn() and subZoneNameEn() respectively; swapping the two
      // would put Surat under "Zone" and read as a plausible sentence, which is why the
      // mapping is stated here once rather than re-decided at each call site.
      cityId: u.cityId || '',
      zoneId: u.zoneId || '',
      status: u.status || '',
      registeredAt: at(u.registeredAt),
      gatePassedAt: at(u.gatePassedAt),
      level4Unlocked: Boolean(u.level4Unlocked),
    },

    // The size of the live collection. `cardinality(p_live_scene_ids)` when the caller
    // supplied it, and only otherwise the server's older estimate - which is why
    // `contentSource` travels beside it and the page shows the estimate as an estimate.
    contentTotal: int(d.contentTotal),
    contentSource: sourceOf(d.contentSource),
    gateOpen: Boolean(d.gateOpen),

    level1: fromLevel(d.level1),
    level2: { ...fromLevel(d.level2), days: int(d.level2?.days) },
    level3: {
      ...fromLevel(d.level3),
      days: int(d.level3?.days),
      best: int(d.level3?.best),
      latest: maybeInt(d.level3?.latest),
      reportedTotal: int(d.level3?.reportedTotal),
    },

    /*
      The authoritative "remembered" set, already intersected with the live collection.

      `profiles.level3_score` is upserted straight from the phone with no trigger behind it -
      0028's header records a production profile carrying a score larger than the collection
      it was scored against. These ids come from `selected_scene_ids` on the attempts, on
      two tables that
      revoke insert, update and delete from `authenticated`. So the count is a fact about
      what was submitted rather than about what a browser reported.

      `remembered` is the server's own count of that intersection and is read rather than
      re-derived from the array: one number, computed once, so the headline and the list can
      never print two different figures.

      The two halves are returned beside the union because they answer different questions -
      a લેવલ ૩ id was recalled from the વર્ણન, a લેવલ ૪ id from the number alone - and a scene
      can be in both, which is why they may sum to more than the union.
    */
    remembered: int(d.remembered),
    rememberedSceneIds: idList(d.rememberedSceneIds),
    rememberedFromLevel3: int(d.rememberedFromLevel3),
    rememberedFromLevel4: int(d.rememberedFromLevel4),
    sceneDetail: Array.isArray(d.sceneDetail) ? d.sceneDetail.map(fromScene) : [],

    level4: {
      configId: l4.configId || null,
      total: int(l4.total),
      attempts: int(l4.attempts),
      passed: int(l4.passed),
      lastAt: at(l4.lastAt),
      activities,
    },

    points: {
      total: int(d.points?.total),
      lastAt: at(d.points?.lastAt),
    },

    lastActivityAt: lastActivityAt(d),
  };
}

/**
 * "Why does this yuvak read one short of the whole collection?" - the reconciliation behind
 * the headline.
 *
 * `admin_verify_user_progress()` walks the same path the report walks and reports every step
 * of it: what he submitted, what survived each gate, and exactly which દ્રશ્યો fell out where.
 *
 *   submitted   distinct ids across લેવલ ૩ and લેવલ ૪, exactly as stored
 *   counted     those that are in the live collection - this is what the report prints
 *   withheld    submitted, but the સંચાલક has since taken the દ્રશ્ય out of the collection
 *   unknown     submitted, in neither the live collection nor the withheld set
 *   missing     live દ્રશ્યો he has never ticked
 *
 * Called on demand and never on page load: it is a second full scan of both attempt tables
 * to answer a question nobody has asked yet on most visits.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The two identities are asserted here, not trusted
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `counted + withheld + unknown = submitted` and `counted + missing = contentTotal` must both
 * hold. The SQL returns its own verdict on each, and this function ANDs it with the same sum
 * computed over the numbers it is about to hand the page - which is the whole point of the
 * panel showing them. A flag that says "balances" beside figures that visibly do not would be
 * the reconciliation tool needing a reconciliation tool, so a disagreement between the two
 * sources fails closed and the page says so loudly.
 *
 * A false here is a real signal about the data and never about the yuvak, and the page words
 * it that way.
 *
 * @param {string}   uid      the yuvak
 * @param {string[]} liveIds  `live.ids` from loadLiveScenes(), the live collection
 */
export async function verifyUserProgress(uid, liveIds = null) {
  const { data, error } = await supabase.rpc('admin_verify_user_progress', {
    p_user: uid,
    p_live_scene_ids: liveIds,
  });
  if (error) throw error;

  const v = data || {};

  const contentTotal = int(v.contentTotal);
  const submitted = int(v.submitted);
  const counted = int(v.counted);
  const withheldCount = int(v.withheldCount);
  const unknownCount = int(v.unknownCount);
  const missingCount = int(v.missingCount);

  return {
    userId: v.userId || uid,
    contentTotal,
    contentSource: sourceOf(v.contentSource),

    submitted,
    counted,
    withheldCount,
    unknownCount,
    missingCount,

    withheldIds: idList(v.withheldIds),
    unknownIds: idList(v.unknownIds),
    missingIds: idList(v.missingIds),

    // `!== false` rather than `=== true` on the server's half: a field a later migration
    // stops sending should not be read as a failed identity, while an explicit false must
    // always survive. The arithmetic beside it is this module's own check.
    submittedBalances: v.submittedBalances !== false && counted + withheldCount + unknownCount === submitted,
    totalBalances: v.totalBalances !== false && counted + missingCount === contentTotal,
  };
}
