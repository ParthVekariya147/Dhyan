/**
 * §33, §34, §35 — every data page has four states, and all four are spelled out here so no
 * page quietly forgets one. Raw Supabase codes and English Postgres messages never reach
 * these; the callers pass a sentence from admin/src/lib/errors.js.
 *
 * The skeletons are shaped like the thing they stand in for — a table skeleton has rows, a
 * card skeleton has cards — because a placeholder of the wrong shape moves the layout when
 * the data lands, which is the jump the skeleton existed to prevent.
 */

export function PageLoading({ label = 'Loading data…' }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/**
 * §35 — an empty list is an offer, not a blank page.
 *
 * `message` stays the first positional concern because every existing caller passes it and
 * AsyncBlock forwards it; `title` and `icon` are additive, so a page that says nothing more
 * than it did before renders exactly as it did before.
 */
export function Empty({ message = 'No data found.', title = null, icon = null, action = null }) {
  return (
    <div className="state state-empty">
      {icon && <span className="state-icon" aria-hidden="true">{icon}</span>}
      {title && <p className="state-title">{title}</p>}
      <p>{message}</p>
      {action}
    </div>
  );
}

/**
 * §34 — what went wrong in a sentence, and a way out of it.
 *
 * The message is always one of ours. A database code or a Postgres sentence reaching this
 * screen would tell the સંચાલક nothing and tell everyone else too much.
 */
export function ErrorState({ message = 'There was a problem loading the data.', onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon" aria-hidden="true">⚠</span>
      <p className="state-title">Something went wrong</p>
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

/** Stat-tile placeholder for a dashboard's top row. */
export function CardSkeleton({ count = 4 }) {
  return (
    <div className="sk-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-card" key={i}>
          <span className="sk-line short" />
          <span className="sk-line tall" />
        </div>
      ))}
    </div>
  );
}

/** Form-shaped placeholder: label-and-input pairs, not a spinner over an empty card. */
export function FormSkeleton({ fields = 4 }) {
  return (
    <div className="card" aria-hidden="true">
      {Array.from({ length: fields }, (_, i) => (
        <div className="field" key={i}>
          <span className="sk-line short" />
          <span className="sk-line tall" />
        </div>
      ))}
    </div>
  );
}

/**
 * The one place that decides which of the four to show. Pages call this instead of
 * writing the same ternary nine times.
 */
export function AsyncBlock({ state, empty, emptyTitle, emptyIcon, emptyAction, children, onRetry, skeleton }) {
  if (state.loading) return skeleton || <PageLoading />;
  if (state.error) return <ErrorState message={state.error} onRetry={onRetry} />;
  if (state.isEmpty) return <Empty message={empty} title={emptyTitle} icon={emptyIcon} action={emptyAction} />;
  return children;
}
