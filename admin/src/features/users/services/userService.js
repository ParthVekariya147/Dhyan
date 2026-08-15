import { supabase } from '../../../lib/supabase';
import { saveError } from '../../../lib/errors';

/**
 * યુવક data access. Every function here is bounded — none can return 2,000 rows (§15, §18).
 *
 * Much of what this file used to contain was Firestore workarounds, and Postgres simply
 * does not need them:
 *
 *   prefix search   was a range query bounded by a private-use code point; now `ilike`
 *   fetch by ids    was chunked into batches of 30, Firestore's `in` limit; now one `in`
 *   counting        was a separate aggregation endpoint; now `count: 'exact', head: true`
 *   search by name  needed a composite index per sort field; now just an ORDER BY
 *
 * Nothing here reads a credential. Passwords live in Supabase Auth, which exposes neither
 * the password nor its hash to any client (§67), and RLS means an unauthorised caller
 * receives an empty result rather than a denial to work around.
 */

/*
  A view over `profiles`, not the table (0038_admins_table.sql).

  It is `public.profiles_level4` — itself `profiles.*` plus one derived column,
  `level4_gate_open`, the લેવલ ૪ gate as the *published configuration* defines it now rather
  than `profiles.level4_unlocked`, which answers 0008's fixed threshold of 80 and stops being
  the rule the moment a સંચાલક sets ૭૫ or ૫૦ (0011, LEVEL4.md decision #3) — MINUS anyone
  holding a `public.admins` row.

  That subtraction is the whole of this line's history and it was a real defect, not a
  tidying. Before 0038 an administrator *was* a `profiles` row: `admin_profiles.id`
  referenced it, so the people running the panel were counted among the people learning.
  "Total registered" on the dashboard, this list, every CSV export and every progress report
  included them, and 104 registered was never 104 yuvaks. An administrator may still be a
  genuine યુવક with a real learning record — the founding account is — which is why the fix
  is a view that excludes the *account*, and not a rule that forces a person to be one thing.

  The exclusion inside the view goes through a SECURITY DEFINER function on purpose, so a
  COORDINATOR (who holds `users.read` but not `admins.read`) excludes exactly the same people
  an ADMIN does; 0038 explains why a plain `not exists` under security_invoker would have
  quietly excluded nobody for him.

  Safe to swap in wholesale because every use below is a read — §19 keeps this panel
  read-only over people, so there is no write here that a view would refuse. It is
  `security_invoker`, so the profiles and progress policies apply exactly as they did to the
  table; nothing became visible that was not before, and one thing stopped being counted that
  never should have been.
*/
const TABLE = 'yuvaks';

/*
  …and the one place that must NOT subtract them: resolving a person who is already on screen.

  These two names look like a distinction without a difference and are not. `TABLE` answers
  "who are the yuvaks" — a question about a population, where an administrator is not one of
  them. `LOOKUP` answers "whose name is on this row" — a question about a record that already
  exists, where the honest answer is the person's name whatever else they also are.

  The founding account is both: a real યુવક with real progress history *and* a SUPER_ADMIN. His
  rows are in `progress`, `point_transactions`, `daily_activity_records` and the leaderboard, and
  they are not going anywhere. Had getUser() and getUsersByIds() been pointed at `yuvaks` along
  with the lists, every one of those rows would have rendered with an empty name and his user
  page would have answered "not found" — the panel refusing to name a person it is at that moment
  displaying the work of.

  So: lists, counts and exports read TABLE. Lookups by id read LOOKUP. Getting this backwards in
  either direction is silent — one over-counts the roll, the other blanks a name — which is why
  it is written down here rather than left to whichever constant was nearer.
*/
const LOOKUP = 'profiles_level4';

/** Callers speak camelCase; the columns are snake_case. One place to translate. */
const COLUMN = {
  createdAt: 'created_at',
  subZoneId: 'sub_zone_id',
  zoneId: 'zone_id',
  level4Unlocked: 'level4_unlocked',
  gatePassedAt: 'gate_passed_at',
  name: 'name',
  smk: 'smk',
  mobile: 'mobile',
  email: 'email',
};

/**
 * §11's તારીખવાર અહેવાલ, on the list — the one date this table actually records.
 *
 * `profiles.created_at` is when the યુવક registered, and it is a real timestamptz that the
 * app writes on every insert. It is *not* the date of any dhyan: `public.progress`
 * (0001_init.sql:46) holds the daily level 3/4 scores and nothing in this codebase writes
 * it yet, so there is no per-day score to range over. That gap is stated on the Progress
 * page rather than papered over here.
 *
 * The bounds arrive already resolved to instants by admin/src/lib/export.js istRange(), so
 * this module never has to think about the timezone. Passing a bare 'YYYY-MM-DD' to `gte`
 * on a timestamptz column would compare against midnight UTC and pull 5½ hours of the
 * previous IST evening into the range (§9).
 */
function applyDateRange(q, { fromIso = null, toIsoExclusive = null } = {}) {
  if (fromIso) q = q.gte('created_at', fromIso);
  // `lt` and not `lte`: the upper bound is the start of the *next* IST day, so the whole
  // of the last day is inside the range.
  if (toIsoExclusive) q = q.lt('created_at', toIsoExclusive);
  return q;
}

/**
 * The §17 search predicate, extracted so the list, the search and the export cannot drift.
 *
 * It used to live inline in searchUsers(). An export that re-implemented "a ten-digit
 * string is a mobile" would eventually disagree with the table it claims to be exporting,
 * which is the one thing a report must never do.
 *
 * Returns the query plus whether it wants a name ordering, because only the prefix branch
 * has a name to order by.
 */
function applyTerm(q, termRaw) {
  const term = String(termRaw || '').trim();
  if (!term) return { q, byName: false };

  if (/^\d{10}$/.test(term)) return { q: q.eq('mobile', term), byName: false };
  if (term.includes('@')) return { q: q.eq('email', term.toLowerCase()), byName: false };

  // ilike is case-insensitive; the comma-separated `or` is one round trip.
  const safe = term.replace(/[,()]/g, '');
  return { q: q.or(`smk.eq.${safe.toUpperCase()},name.ilike.${safe}%`), byName: true };
}

/**
 * One page of yuvaks, newest first.
 *
 * `cursor` stays an opaque token to callers, as it was with Firestore's document cursor;
 * here it is simply the row offset. Reading one extra row answers "is there a next page?"
 * without a second query.
 */
export async function listUsers({
  pageSize = 20,
  cursor = null,
  subZoneId = '',
  fromIso = null,
  toIsoExclusive = null,
  sortField = 'createdAt',
  sortDir = 'desc',
} = {}) {
  const offset = Number(cursor) || 0;
  let q = supabase.from(TABLE).select('*');
  if (subZoneId) q = q.eq('sub_zone_id', subZoneId);
  q = applyDateRange(q, { fromIso, toIsoExclusive });

  q = q
    .order(COLUMN[sortField] || 'created_at', { ascending: sortDir === 'asc' })
    .range(offset, offset + pageSize); // one extra row

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data || []).slice(0, pageSize);
  return {
    rows: rows.map(toUser),
    cursor: rows.length ? offset + rows.length : null,
    hasNext: (data || []).length > pageSize,
  };
}

/**
 * §17 — search without downloading everyone and filtering in React.
 *
 * A ten-digit string is a mobile number and an @ is an email — both exact. Anything else
 * is tried as an SMK *and* as a name prefix, because a સંચાલક typing "PGV" means one and
 * typing "પ્રથમ" means the other. One query does both, since `or` is native here.
 *
 * No Algolia, no Elastic. At ~2,000 rows that would be infrastructure with nothing to do.
 *
 * `subZoneId` narrows the search the same way it narrows the list. It used to be accepted
 * by neither the function nor the query, so a search made with "Varachha" selected came
 * back from all three સબઝોન while the select still read Varachha — the panel stating
 * something untrue about its own results. It is an AND alongside the term: PostgREST
 * combines a top-level `eq` with the `or` group below, so both apply to every row returned.
 */
export async function searchUsers(
  termRaw,
  { pageSize = 50, subZoneId = '', fromIso = null, toIsoExclusive = null } = {}
) {
  const term = String(termRaw || '').trim();
  if (!term) return finish([]);

  let q = supabase.from(TABLE).select('*').limit(pageSize);
  if (subZoneId) q = q.eq('sub_zone_id', subZoneId);
  // The date range narrows a search exactly as it narrows the list — same reason the
  // સબઝોન filter had to: a page that says "registered 1–31 July" above results drawn
  // from every month is stating something untrue about its own results.
  q = applyDateRange(q, { fromIso, toIsoExclusive });

  const applied = applyTerm(q, term);
  q = applied.byName ? applied.q.order('name') : applied.q;

  const { data, error } = await q;
  if (error) throw error;
  return finish((data || []).map(toUser));
}

const finish = (rows) => ({ rows, cursor: null, hasNext: false });

/**
 * §11 — every યુવક the સંચાલક is currently looking at, for the Excel export.
 *
 * The export must cover the *filtered set*, not the visible page. A file that quietly
 * contained only the twenty rows on screen would be worse than no export at all: someone
 * acts on a report, and "we have 20 yuvaks in Varachha" is a decision made on a lie.
 *
 * So this pages through the same predicate the list uses — same applyTerm(), same
 * applyDateRange(), same સબઝોન `eq` — in chunks, until the server runs out of rows or the
 * cap is reached. At the ~2,000 users §12 sizes for, that is two round trips.
 *
 * `truncated` is returned rather than swallowed, and the page shows it. A silently
 * truncated report is the same failure as a silently paginated one.
 */
export const EXPORT_CAP = 5000;

export async function fetchAllUsers({
  subZoneId = '',
  term = '',
  fromIso = null,
  toIsoExclusive = null,
  cap = EXPORT_CAP,
  chunk = 1000,
} = {}) {
  const rows = [];
  let offset = 0;

  for (;;) {
    let q = supabase.from(TABLE).select('*');
    if (subZoneId) q = q.eq('sub_zone_id', subZoneId);
    q = applyDateRange(q, { fromIso, toIsoExclusive });

    const applied = applyTerm(q, term);
    // Ordered so the chunks tile the same list without overlap or gaps. `created_at` is
    // the list's own default order, and a name ordering is used when the term branch asks
    // for one, so the file comes out in the order the સંચાલક saw on screen.
    q = (applied.byName ? applied.q.order('name') : applied.q.order('created_at', { ascending: false }))
      .range(offset, offset + chunk - 1);

    const { data, error } = await q;
    if (error) throw error;

    const batch = data || [];
    rows.push(...batch.map(toUser));

    // A short batch means the server has no more rows; anything else would loop forever
    // against an empty tail.
    if (batch.length < chunk) return { rows, truncated: false, cap };
    if (rows.length >= cap) return { rows: rows.slice(0, cap), truncated: true, cap };
    offset += chunk;
  }
}

/** Total registered. A head request — the rows are never transferred (§15). */
export async function countUsers(filter = {}) {
  let q = supabase.from(TABLE).select('id', { count: 'exact', head: true });
  if (filter.subZoneId) q = q.eq('sub_zone_id', filter.subZoneId);
  // The published gate, not 0008's fixed 80 — see TABLE and toUser(). The filter key is
  // named for what it now asks so a caller cannot pass the old meaning by accident.
  if (filter.level4Open !== undefined) q = q.eq('level4_gate_open', filter.level4Open);
  if (filter.createdAfter) q = q.gte('created_at', filter.createdAfter);

  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** LOOKUP, not TABLE: an administrator who is also a યુવક has a user page and it must open. */
export async function getUser(userId) {
  const { data, error } = await supabase.from(LOOKUP).select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? toUser(data) : null;
}

/**
 * Names for a page of progress rows — one query per batch of ids, not one per row (§84).
 *
 * Batched at 200 because PostgREST reads `in` from the query string, and a UUID costs ~38
 * characters there. A page of twenty rows was always one request; an export asking for the
 * names behind 5,000 sessions would have built a ~190 KB URL, which servers and proxies
 * reject with a 414 long before Postgres sees it. The batches go out together, so the cost
 * is round trips in parallel rather than in sequence.
 */
const ID_BATCH = 200;

export async function getUsersByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();

  const batches = [];
  for (let i = 0; i < unique.length; i += ID_BATCH) batches.push(unique.slice(i, i + ID_BATCH));

  const results = await Promise.all(
    batches.map(async (batch) => {
      // LOOKUP: these ids came from progress, ledger and session rows that already exist. A
      // name that resolves for everyone except the one person who also administers would read
      // as missing data, not as a policy.
      const { data, error } = await supabase.from(LOOKUP).select('*').in('id', batch);
      if (error) throw error;
      return data || [];
    })
  );

  const out = new Map();
  for (const rows of results) for (const row of rows) out.set(row.id, toUser(row));
  return out;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Test accounts (0040)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Some accounts exist only to try the app. They behave exactly like a real યુવક — they sign
 * in, they earn points, they write progress — and they must appear in no total, no ranking,
 * no list and no export, because a report is a thing people act on and three invented yuvaks
 * in it is three yuvaks that were never there.
 *
 * Almost none of that is this file's problem, and that is the point of how 0040 was built.
 * `public.yuvaks` — the TABLE constant at the top, which the list, the counts and the export
 * already read — gained one more term and now excludes test accounts too. So the yuvak list
 * became correct without a line of admin/src changing, and nothing above this comment had to
 * be touched.
 *
 * What is left is the other side of it: the one screen that *does* list them, and the two
 * writes that move an account between the two populations.
 */

/*
  The view that lists only test accounts. Same columns as `yuvaks`, deliberately, so one
  DataTable and one row mapper serve both screens.

  It is NOT a table and it does NOT carry `is_test`. Both halves matter here. `test_yuvaks` is
  `profiles_level4` filtered by id against the marked rows, and `profiles_level4` is a 0014
  view defined as `select p.*, …` — a view freezes the column list that `*` expanded to on the
  day it was created, so the three columns 0040 added to `profiles` in 2026 are simply not in
  it and never will be. 0040 says so in a comment beside the view and explains why re-creating
  it is a `drop … cascade` through every dependent view rather than a one-line fix.

  The consequence is small but has to be handled honestly rather than assumed: selecting
  `is_test` or `test_marked_at` from this view is a 42703 (undefined column) at runtime, not a
  null. Which is why listTestUsers() reads the marks separately — see readTestMarks().
*/
const TEST_TABLE = 'test_yuvaks';

/*
  …and the table the flag actually lives on.

  A third constant beside TABLE and LOOKUP, and for a third reason. TABLE is the population
  that counts, LOOKUP is how a person already on screen is named, and MARKS is where the two
  columns that say "this one does not count" are physically stored. Only the marking screen
  touches it, and only for those columns.

  This is also the one write in the whole of userService. §19 keeps the panel read-only over
  people and that has not changed: nothing here edits a name, a mobile number or a score. It
  sets a flag that decides whether an account is counted, which is bookkeeping about the
  account rather than an edit of the person's record.
*/
const MARKS = 'profiles';

/**
 * The whole list of test accounts, and it fits.
 *
 * No pager, for the same reason listAdmins() has none: this is a handful of rows by
 * construction — if it ever holds hundreds, something has gone wrong that a Pager would
 * politely help you page through. The cap exists anyway, because "there are only ever a few"
 * is an assumption, and it is reported rather than silently applied.
 */
export const TEST_LIST_CAP = 200;

export async function listTestUsers({ term = '' } = {}) {
  const q = supabase.from(TEST_TABLE).select('*');

  // The same predicate the yuvak list and the export use, not a second one written here. A
  // search that means "a ten-digit string is a mobile" on one tab and something else on the
  // next is how two lists of the same people start disagreeing.
  const applied = applyTerm(q, term);

  // One extra row, exactly as listAdmins() does, so "the cap was reached" is answered without
  // a second count query.
  const { data, error } = await (applied.byName
    ? applied.q.order('name')
    : applied.q.order('created_at', { ascending: false })
  ).range(0, TEST_LIST_CAP);
  if (error) throw error;

  const all = data || [];
  const page = all.slice(0, TEST_LIST_CAP);
  const marks = await readTestMarks(page.map((r) => r.id));

  return {
    // `isTest: true` is stated rather than read, and it is not a shortcut: every row here came
    // out of a view whose entire definition is "the profiles where is_test", so it is true of
    // all of them by construction — and the column itself is not in the view to be read. See
    // TEST_TABLE above.
    rows: page.map((r) => toUser(r, { isTest: true, testMarkedAt: marks.get(r.id) || null })),
    truncated: all.length > TEST_LIST_CAP,
    cap: TEST_LIST_CAP,
  };
}

/**
 * When each of these accounts was marked — the one column the list needs and the view cannot
 * give it.
 *
 * A second round trip is a real cost and it is paid deliberately. The alternative was reading
 * the whole screen from `profiles` instead of from `test_yuvaks`, which would mean this tab
 * computing "who is a test account" for itself out of a raw table while every other screen
 * asks the view — two definitions of the same population, and the moment they disagree the
 * panel is showing somebody in a list he is not in. One extra `in` over a handful of ids is
 * cheaper than that in every sense that matters.
 *
 * Not batched, unlike getUsersByIds(): TEST_LIST_CAP is 200, which is exactly ID_BATCH, so
 * this can never build a URL longer than the one that function already sizes for.
 *
 * A failure here is thrown rather than shrugged off. It cannot realistically happen on its
 * own — `test_yuvaks` is security_invoker over the same `profiles` policy this reads, so a
 * refusal would have emptied the list one line above — and a "Marked on" column silently full
 * of dashes would read as "nobody knows", which is a different and untrue statement.
 */
async function readTestMarks(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from(MARKS).select('id, test_marked_at').in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.id, r.test_marked_at || null]));
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Marking an account, and reading back what actually happened
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The re-read is the whole function. Everything else is one UPDATE.
 *
 * `profiles_guard_test_flag()` (0040) is a BEFORE UPDATE trigger that *holds* `is_test` when
 * the caller does not hold `users.test`: it copies the old value back over the new one and
 * returns the row. It does not raise. That is the right behaviour for the trigger — it matches
 * `profiles_guard_status()`, and the યુવક app sends whole profile rows, so raising would break
 * saves that are perfectly legitimate and touched nothing — but it means PostgREST answers
 * `200, no error` to a write that was refused.
 *
 * The RLS policy can produce the same silence from the other direction: `own profile updatable`
 * is `id = auth.uid() or has_permission('users.update')`, and an UPDATE that matches no row
 * under the policy is zero rows affected, not a 403.
 *
 * So a client that treated "no error" as "saved" would tell a COORDINATOR his colleague is now
 * a test account, leave him counted in every report, and give nobody a reason to look again.
 * This reads the row back and answers from the row.
 *
 * The permission is still enforced entirely in the database — this is the panel finding out
 * what the database decided, not the panel deciding.
 */
export async function setTestAccount(userId, isTest) {
  const want = !!isTest;

  /*
    Exactly the one column, and never `test_marked_at` or `test_marked_by` alongside it. The
    trigger stamps both from `now()` and `auth.uid()`, which is the only clock and the only
    identity that cannot be lied to; sending our own would be a client asserting who did
    something and when.
  */
  const { error } = await supabase.from(MARKS).update({ is_test: want }).eq('id', userId);
  if (error) throw error;

  const { data, error: readError } = await supabase
    .from(MARKS)
    .select('id, is_test, test_marked_at')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw readError;

  if (!data) {
    throw refusal(
      'This account could not be read back after the change, so there is no way to say whether it was applied. Reload the list and look again before trying a second time.'
    );
  }

  if (!!data.is_test !== want) {
    // The silent hold, said out loud. Worded for both routes into it - the trigger and the
    // policy - because from here they are indistinguishable and both mean the same thing to
    // the person reading: the change did not happen and pressing the button again will not
    // make it happen.
    throw refusal(
      want
        ? 'The database refused to mark this account. Marking one needs the Super Admin permission for test accounts, and this session does not hold it. Nothing was changed.'
        : 'The database refused to return this account to normal. It needs the Super Admin permission for test accounts, and this session does not hold it. Nothing was changed.'
    );
  }

  return { id: data.id, isTest: !!data.is_test, testMarkedAt: data.test_marked_at || null };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Purging one, which takes two systems
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This was written first as a plain `supabase.rpc('admin_purge_test_account')`, and that was
 * wrong in a way worth recording rather than quietly fixing.
 *
 * The RPC does delete the profile and, by cascade, every point transaction, daily record,
 * attempt, revision and progress row behind it — all of the application's data, and it is
 * where the entire safety argument lives (it refuses unless the caller holds `users.purge`
 * AND the row is already marked `is_test`, so a real યુવક cannot be reached by it at all).
 *
 * What it cannot touch is the `auth.users` row, which belongs to GoTrue in a schema this
 * application does not own. Left behind, that is not a tidy-up job: the credential still
 * works, `src/lib/auth.jsx` sees a signed-in user with no profile — the *unregistered* state —
 * and the account registers itself again and takes a fresh place in everybody's numbers.
 * "Purged" has to mean the account is gone.
 *
 * So it goes through netlify/functions/purge-test-account.js, which calls the RPC with the
 * caller's own token (the database checks the permission, the is_test guard and writes the
 * audit row against the person actually signed in) and only then deletes the login with the
 * secret key. Same shape as createAdmin() next door, and for the same reason: a secret key in
 * a browser bundle is a secret key published on the internet (§50).
 *
 * ── 207 is not a failure ────────────────────────────────────────────────────
 *
 * If the data went and the login did not, the endpoint answers 207 with the summary. That is
 * returned, not thrown, and `authDeleted: false` is how the caller knows. Calling it an error
 * would have somebody retry a purge against an account that no longer exists; calling it a
 * success would leave a working credential that nobody knows about. It is its own outcome and
 * the screen says so in its own words.
 */
export async function purgeTestAccount(userId) {
  /*
    getSession() rather than a token kept in a module variable: supabase-js refreshes the
    access token in the background, and a copy taken at sign-in would be an hour stale by the
    time somebody purges an account — which the endpoint would correctly answer as
    not-authenticated, on a screen where the session is plainly fine.
  */
  const { data: auth, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = auth?.session?.access_token;
  // Refused here rather than sent anonymously, so the sentence read is about a lapsed session
  // and not about a permission the person does hold.
  if (!token) throw apiError('not-authenticated');

  const res = await fetch('/api/purge-test-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId }),
  });

  const body = await res.json().catch(() => ({}));

  // The half-done state, before the !res.ok branch: 207 is not ok, and falling through would
  // turn "the data is gone" into "something went wrong, try again".
  if (res.status === 207) return { ...purgeSummary(body?.summary), authDeleted: false };

  if (!res.ok) {
    // `code` with `error` as a fallback, exactly as createAdmin() reads it - the two endpoints
    // answer with the same envelope and a client that reads one spelling turns every named
    // refusal into the generic sentence.
    const code = body?.code ?? body?.error;
    console.error('[admin] purge-test-account refused', res.status, code || '', body?.detail || '');
    throw apiError(code, body?.detail);
  }

  return { ...purgeSummary(body), authDeleted: body?.authDeleted !== false };
}

/** snake_case off the wire, camelCase above it — the same translation toUser() does. */
const purgeSummary = (s) => ({
  id: s?.id || null,
  name: s?.name || '',
  email: s?.email || '',
  pointsRemoved: Number(s?.points_removed) || 0,
  daysRemoved: Number(s?.days_removed) || 0,
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * What was refused, said in a sentence
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Shaped after adminWriteError() in adminService.js beside it, and needed for the same reason:
 * saveError() words a SQLSTATE, and neither of the two failures that matter here is one.
 *
 * A refusal that arrived as a *held value* has no code at all — it is this file noticing that
 * the row came back unchanged — and saveError() would answer it with "There was a problem
 * saving. Please try again.", which is wrong twice over: nothing went wrong, and trying again
 * is the one thing guaranteed not to help.
 *
 * A refusal from the purge endpoint arrives as an HTTP code in a JSON envelope, which
 * saveError() has never heard of either.
 *
 * Everything genuinely from Postgres — a 42501 from the policy on a direct write, a dead
 * network — still falls through to errors.js, which already words all of it.
 */
const refusal = (text) => Object.assign(new Error(text), { refusal: text });

const apiError = (code, detail) =>
  Object.assign(new Error(`purge-test-account: ${code || 'unknown'}`), {
    apiCode: code || '',
    apiDetail: detail || '',
  });

/** The endpoint's codes, worded for the person who pressed the button. */
const PURGE_ERRORS = {
  'not-authenticated': 'Your session has expired. Please log in again and try once more. Nothing was deleted.',
  'not-permitted': 'You do not have permission to purge an account. Nothing was deleted.',
  // The guard that makes this feature safe, and the message says which half is missing rather
  // than sounding like a fault: the account has to be marked as a test account first.
  'not-a-test-account':
    'This is not a test account, so it cannot be purged. Only an account already marked as a test account can be deleted this way - which is what stops a real yuvak from ever being reached by it.',
  'no-such-account': 'This account no longer exists. It may already have been purged - reload the list.',
  'bad-request': 'The account could not be identified. Reload the list and try again.',
  'setup-incomplete': 'Purging is not switched on for this deploy yet. Please inform whoever built the panel.',
  'server-error':
    'The server could not complete the purge. Reload the list to see what state the account is in, and tell whoever built the panel if it keeps happening.',
};

export function testWriteError(e) {
  // First, because it is the only one of the three that carries its own finished sentence.
  if (e?.refusal) return e.refusal;

  if (e?.apiCode && Object.prototype.hasOwnProperty.call(PURGE_ERRORS, e.apiCode)) {
    return PURGE_ERRORS[e.apiCode];
  }
  return saveError(e);
}

/**
 * @param {object} v      a row from `yuvaks`, `test_yuvaks` or `profiles_level4`
 * @param {object} extra  facts the row cannot carry - see `isTest` below
 */
function toUser(v, extra = {}) {
  return {
    id: v.id,
    smk: v.smk || '',
    name: v.name || '',
    email: v.email || '',
    mobile: v.mobile || '',
    zoneId: v.zone_id || '',
    subZoneId: v.sub_zone_id || '',
    likeAnswer: !!v.like_answer,
    commentAnswer: !!v.comment_answer,
    gatePassedAt: v.gate_passed_at || null,
    // 0004_rbac.sql:175 — the account's lifecycle (ACTIVE / SUSPENDED / DISABLED), §7's
    // "suspend, never delete". It was never mapped, so the list derived a green "Active"
    // pill from gate_passed_at and a suspended yuvak read as a healthy one. Those are two
    // separate facts and both are kept: this is whether the account works, gatePassedAt is
    // whether he answered the §5 entry gate.
    //
    // Read-only here by design. §19 keeps this panel read-only and a suspend/disable write
    // path is a product decision, not a mapping fix.
    status: v.status || 'ACTIVE',
    /*
      Two facts, deliberately both kept, because they answer different questions.

      `level4GateOpen` is whether લેવલ ૪ is open to this યુવક *now*, under the threshold the
      સંચાલક has published — the thing the app enforces and the thing the panel should show.
      `level4Unlocked` is 0008's fixed-80 record, which stays true once earned and is what
      src/lib/progress.js still reads. With the default configuration they agree; with a
      threshold of ૫૦ the first goes true at ૫૦ and the second waits for ૮૦.
    */
    level4GateOpen: !!v.level4_gate_open,
    level4Unlocked: !!v.level4_unlocked,
    createdAt: v.created_at || null,
    /*
      0040's two facts about whether this account is counted, and the one pair of fields here
      that usually cannot come from the row.

      All three views this mapper is pointed at are built on `profiles_level4`, which is a
      `select p.*` whose column list was frozen by 0014, long before 0040 added `is_test` to
      `profiles` — so `v.is_test`
      and `v.test_marked_at` are `undefined` for every row that arrives from a view, and
      *selecting* them would be a 42703 rather than a null. `extra` is how a caller that knows
      better supplies them: listTestUsers() reads the marks from `profiles` and passes them in.

      Defaulting from the row anyway, rather than from `extra` alone, so that pointing this
      mapper at `profiles` itself one day does the obvious thing instead of quietly reporting
      every account as a real one.

      Both are kept even though the second is nearly implied by the first: `isTest` is whether
      the account counts, `testMarkedAt` is when somebody decided that, and the Test accounts
      screen shows the second precisely because a mark nobody can date is a mark nobody can
      question.
    */
    isTest: extra.isTest ?? !!v.is_test,
    testMarkedAt: extra.testMarkedAt ?? v.test_marked_at ?? null,
  };
}
