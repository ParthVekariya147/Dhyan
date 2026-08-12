import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { listAudit } from '../services/auditService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import { dateTimeGu } from '../../../lib/format';
import { ACTION_LABELS, actionLabel, changedFields, resourceLabel } from '../../../../../shared/domain/audit.js';

/**
 * §41, §42 — who did what.
 *
 * Read only, and append-only at the database: public.audit_logs has no update and no
 * delete policy for anyone, admins included (0001_init.sql), and since 0004_rbac.sql
 * almost every row is written by a trigger rather than by this bundle. An audit trail an
 * administrator can edit records nothing.
 *
 * No real-time listener (§83). A log is history; it does not need to update itself while
 * being read, and a standing listener per open page is a cost with no benefit (§84).
 */
export default function AuditLogPage() {
  const [pageSize, setPageSize] = useState(50);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const cursors = useRef([null]);

  const state = useAsync(
    () => listAudit({ pageSize, cursor: cursors.current[page], action }),
    [page, pageSize, action]
  );

  const rows = state.data?.rows || [];

  const next = useCallback(() => {
    if (!state.data?.cursor) return;
    cursors.current[page + 1] = state.data.cursor;
    setPage((p) => p + 1);
  }, [state.data, page]);

  const reset = () => {
    cursors.current = [null];
    setPage(0);
  };

  const columns = [
    { key: 'at', label: 'When', render: (r) => dateTimeGu(r.at) },
    {
      key: 'actorName',
      label: 'Who',
      render: (r) => (
        <>
          {r.actorName || <span className="mono">{r.actorId?.slice(0, 8)}…</span>}
          {/* The role he was acting as when he did it, which is not necessarily the role
              his admin_profiles row carries today — that is the whole point of storing
              actor_role on the row instead of joining it at read time. */}
          {r.actorRole && <div style={{ fontSize: 12, opacity: 0.7 }}>{r.actorRole}</div>}
        </>
      ),
    },
    { key: 'action', label: 'Action', render: (r) => actionLabel(r.action) },
    { key: 'resourceType', label: 'Type', render: (r) => resourceLabel(r.resourceType) },
    {
      key: 'targetId',
      label: 'Target',
      render: (r) =>
        // `resource_type` says what the target *is*, so the link no longer has to guess
        // from the shape of the id. The prefix test stays as the fallback for rows written
        // before 0004 added the column — theirs is '' (the NOT NULL default the ALTER
        // gave existing rows), and those દર્શન entries are still worth linking.
        r.resourceType === 'scenes' || r.targetId?.startsWith('darshan-') ? (
          <Link to={`/darshan/${r.targetId}`}>{r.targetId}</Link>
        ) : (
          <span className="mono">{r.targetId || '—'}</span>
        ),
    },
    { key: 'details', label: 'Details', render: (r) => <Details row={r} /> },
  ];

  return (
    <>
      <PageHeader title="Audit Log" sub="Every important change — cannot be deleted or edited" />

      <div className="filters">
        <div className="field">
          <label htmlFor="a">Type</label>
          <select
            id="a"
            value={action}
            onChange={(e) => {
              reset();
              setAction(e.target.value);
            }}
          >
            <option value="">All</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !rows.length }}
        empty="No changes have been recorded yet."
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable caption="Audit Log" columns={columns} rows={rows} rowKey={(r) => r.id} />
          <Pager
            page={page}
            hasNext={!!state.data?.hasNext}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={next}
            pageSize={pageSize}
            onPageSize={(n) => {
              reset();
              setPageSize(n);
            }}
            busy={state.loading}
          />
        </>
      </AsyncBlock>
    </>
  );
}

// ---------------------------------------------------------------- the Details column

/**
 * What the change actually did.
 *
 * This column used to read `meta`, and `meta` has been empty on every trigger-written row
 * since 0004_rbac.sql — the triggers put `to_jsonb(old)` and `to_jsonb(new)` into
 * `before`/`after` and leave `meta` at its '{}' default. So the log recorded that a દર્શન
 * was updated and never which field moved, which is most of the value of keeping it.
 *
 * `changedFields()` (shared/domain/audit.js) does the comparing and drops the keys that
 * differ on every single change — updated_at says nothing about what a સંચાલક did.
 *
 * The whole row is stored on purpose and is deliberately *not* shown whole: a `profiles`
 * diff carries mobile, email and SMK, and a `settings` diff carries an entire jsonb value.
 * Only the fields that moved appear, each value clipped, with the rest counted rather than
 * printed. The full list is in the cell's title for the one row being investigated.
 */
const MAX_FIELDS = 4;

/** A value small enough for a table cell. jsonb values are objects, so stringify first. */
function shortValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

function Details({ row }) {
  // `before` is null for an INSERT — ROLE_ASSIGNED, a first `settings` row — because the
  // row did not exist. Comparing against {} is what makes every populated field of the new
  // row read as a change, which for a creation it is. The two cases are worded apart
  // below: "x → y" for an edit, "x" for something that did not exist a moment ago.
  const created = !row.before && !!row.after;
  const changes = changedFields(row.before || {}, row.after);

  if (!changes.length) {
    // ADMIN_LOGIN is the only action the panel still writes itself (signing in changes no
    // governed table, so no trigger can see it) and it carries `meta`, not a row diff.
    const entries = Object.entries(row.meta || {});
    if (!entries.length) return '—';
    return (
      <span className="mono" style={{ fontSize: 12 }}>
        {entries.map(([k, v]) => `${k}: ${shortValue(v)}`).join(' · ')}
      </span>
    );
  }

  const line = (c) => (created ? `${c.field}: ${shortValue(c.to)}` : `${c.field}: ${shortValue(c.from)} → ${shortValue(c.to)}`);
  const shown = changes.slice(0, MAX_FIELDS);
  const rest = changes.length - shown.length;

  return (
    <span className="mono" style={{ fontSize: 12 }} title={changes.map(line).join('\n')}>
      {shown.map(line).join(' · ')}
      {rest > 0 && ` · +${rest} more`}
    </span>
  );
}
