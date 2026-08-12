/**
 * §53 — every data page has four states, and all four are spelled out here so no page
 * quietly forgets one. Raw Supabase codes and English Postgres messages never reach these;
 * the callers pass a sentence from admin/src/lib/errors.js.
 */

export function PageLoading({ label = 'Loading data…' }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function Empty({ message = 'No data found.', action = null }) {
  return (
    <div className="state state-empty">
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message = 'There was a problem loading the data.', onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Table-shaped placeholder, so the layout does not jump when rows arrive. */
export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="sk-row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <span className="sk-cell" key={c} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The one place that decides which of the four to show. Pages call this instead of
 * writing the same ternary nine times.
 */
export function AsyncBlock({ state, empty, children, onRetry, skeleton }) {
  if (state.loading) return skeleton || <PageLoading />;
  if (state.error) return <ErrorState message={state.error} onRetry={onRetry} />;
  if (state.isEmpty) return <Empty message={empty} />;
  return children;
}
