/**
 * §54, §55 — one table, used by every list page.
 *
 * On a wide screen it is a table. Below ~820px the same rows render as cards, one
 * label-and-value pair per line: a ten-column table squeezed into a phone is unreadable,
 * and horizontal scrolling hides exactly the column you were looking for.
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
 */
export default function DataTable({
  columns, rows, rowKey, sort, onSort, caption, onRowClick, wrapClassName = '',
}) {
  const sortable = typeof onSort === 'function';
  const cls = (...parts) => parts.filter(Boolean).join(' ');

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
                  className={cls(c.align === 'right' && 'ta-r', c.className)}
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
                  className={cls(c.align === 'right' && 'ta-r', c.className)}
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
