/**
 * §54, §55 — one table, used by every list page.
 *
 * It is a table at every width. Below 900px it becomes a *dense* table that scrolls
 * sideways with its identity column pinned, rather than the stack of label/value cards it
 * used to become — admin.css carries the full reasoning at that breakpoint, and the short
 * version is that a card per row cost eight lines and 230px per યુવક and made it impossible
 * to read a column downwards, which is the one thing a list is for.
 *
 * Sorting is opt-in per column and is *reported*, not performed — the caller decides
 * whether that means a new query or an in-memory sort of the current page.
 * Sorting a paginated list client-side would only sort the page you can see, which is
 * worse than not offering it.
 */
/**
 * `wrapClassName` and a per-column `className` were added for the progress report, which is
 * the first table here wide enough for column sizing to matter. Both are additive: every
 * existing caller passes neither and renders exactly as before.
 *
 *   wrapClassName   extra classes on `.table-wrap` — `is-tall` turns on the sticky header
 *                   by making the wrap the vertical scroll container (see admin.css).
 *   column.className  applied to that column's `th` AND its `td`, so a min-width or a
 *                   `white-space: nowrap` is declared once and cannot drift between the two.
 *   column.pin      names this column the row's identity: below 900px it is the one that
 *                   stays put while the rest scroll under the thumb. At most one, and if no
 *                   column claims it the first is used — see `pinnedKey` below for why that
 *                   default is worth overriding on most pages.
 */
import { useAdminAuth } from '../lib/adminAuth';

export default function DataTable({
  columns: given, rows, rowKey, sort, onSort, caption, onRowClick, wrapClassName = '',
}) {
  const { can } = useAdminAuth();
  const sortable = typeof onSort === 'function';
  const cls = (...parts) => parts.filter(Boolean).join(' ');

  /*
    The SMK column, dropped here rather than in each of the seven pages that has one.

    `users.smk.read` (0046) decides whether a સંચાલક is shown membership numbers in bulk. Seven
    tables carry the column — યુવકો, Progress, the Point Ledger, Daily Activity, Daily Records,
    the લેવલ ૩ report and the Leaderboard — and filtering it seven times would be seven places
    that have to agree, which is how the eighth table written next year quietly ships without
    the check. One rule, applied where the column is rendered.

    This does put a permission check inside an otherwise presentational component, and that is
    a real cost, paid deliberately: the alternative is a rule about one field enforced in seven
    files by convention. The coupling is contained — DataTable is used by the panel and by
    nothing else, and the યુવક app has no import path to it (§8).

    Matched on `key`, which all seven use. A column rendering an SMK under some other key would
    slip past, which is why the key is the thing the migration, the access map and this all
    name — and why scripts/test-permission-catalogue.mjs asserts those first two agree.

    Not a security boundary, and 0046 says so at length: `users.read` governs public.profiles
    and `smk` is a column of it, so the number is readable over the API either way. This
    governs bulk exposure on a screen, which is the thing that was asked for.
  */
  const columns = can('users.smk.read') ? given : given.filter((c) => c.key !== 'smk');

  /*
    Which column does not move when the table is swiped.

    The first column is only the default, not the rule, and the difference matters: on
    /users the first column is SMK, which a large share of યુવકો simply do not have, so
    pinning it would hold a column of dashes on screen and scroll the names away — the exact
    failure the pin exists to prevent. A page that knows better says so with `pin: true`.

    Resolved by key rather than by index so it survives a column being hidden, reordered or
    dropped from the picker, and falls back rather than pinning nothing if a `pin` is left
    behind on a column that no longer renders.
  */
  const pinnedKey = (columns.find((c) => c.pin) || columns[0])?.key;

  return (
    <div className={cls('table-wrap', wrapClassName)}>
      <table className="dt">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.field === c.key;
              const canSort = sortable && c.sortable;
              return (
                <th
                  key={c.key}
                  scope="col"
                  /* The same `data-label` the cells carry. A per-page rule that hides a
                     bookkeeping column on a phone has to hide the header with it — a `td`
                     dropped on its own shifts every column after it under the wrong
                     heading — and one attribute on both halves is what lets a single
                     selector do that without the two ever drifting apart. */
                  data-label={c.label}
                  className={cls(c.align === 'right' && 'ta-r', c.key === pinnedKey && 'is-pin', c.className)}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {canSort ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => onSort(c.key, active && sort.dir === 'asc' ? 'desc' : 'asc')}
                    >
                      {c.label}
                      {/* An arrow alone would be colour-free but shape-only; the
                          aria-sort above carries it for screen readers (§56). */}
                      <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'is-clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label}
                  className={cls(c.align === 'right' && 'ta-r', c.key === pinnedKey && 'is-pin', c.className)}
                >
                  {c.render ? c.render(row) : row[c.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Cursor pagination controls (§18).
 *
 * Deliberately next/previous rather than numbered pages. Under Firestore a cursor could
 * not jump to "page 7" at all; Postgres could, but numbered pages also need a total count
 * on every list, and the services deliberately answer "is there a next page?" by reading
 * one extra row instead. Keeping the contract also kept the migration honest (§43).
 */
export function Pager({ page, hasNext, onPrev, onNext, pageSize, onPageSize, busy }) {
  return (
    <div className="pager">
      <label className="page-size">
        Per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} disabled={busy}>
          {[20, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="pager-btns">
        <button className="btn btn-quiet" type="button" onClick={onPrev} disabled={page === 0 || busy}>
          ← Previous
        </button>
        <span className="pager-n">Page {page + 1}</span>
        <button className="btn btn-quiet" type="button" onClick={onNext} disabled={!hasNext || busy}>
          Next →
        </button>
      </div>
    </div>
  );
}
