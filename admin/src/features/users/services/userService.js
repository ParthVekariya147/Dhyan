import { supabase } from '../../../lib/supabase';

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
  A view over `profiles`, not the table (0011_level4_gate_view.sql).

  It is `profiles.*` plus one derived column, `level4_gate_open` — the લેવલ ૪ gate as the
  *published configuration* defines it now, rather than `profiles.level4_unlocked`, which
  answers 0008's fixed threshold of 80 and stops being the rule the moment a સંચાલક sets
  ૭૫ or ૫૦ (LEVEL4.md decision #3).

  Safe to swap in wholesale because every use below is a read — §19 keeps this panel
  read-only over people, so there is no write here that a view would refuse. The view is
  `security_invoker`, so the profiles and progress policies apply exactly as they did to
  the table; nothing became visible that was not before.
*/
const TABLE = 'profiles_level4';

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

export async function getUser(userId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', userId).maybeSingle();
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
      const { data, error } = await supabase.from(TABLE).select('*').in('id', batch);
      if (error) throw error;
      return data || [];
    })
  );

  const out = new Map();
  for (const rows of results) for (const row of rows) out.set(row.id, toUser(row));
  return out;
}

function toUser(v) {
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
  };
}
