import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { listAudit } from '../services/auditService';
import DataTable, { Pager } from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
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

/**
 * The pill tone for an action, read off the end of its name.
 *
 * ACTIONS in shared/domain/audit.js is named to a convention — NOUN_VERBPARTICIPLE — and
 * the participle is the part that says what kind of thing happened. Matching on it instead
 * of listing all twenty-two codes here means a new action added to that file arrives with
 * a sensible colour instead of arriving untinted, and one file stays the source of what
 * actions exist.
 *
 * There is no danger tone anywhere in this table. Every row records something a સંચાલક
 * chose to do; a red badge on "user suspended" would read as an accusation against the
 * person who did the suspending, and the log's job is to state, not to judge (§10, §14).
 * The word inside the pill is what carries the meaning — the tint only repeats it (§43).
 */
function actionTone(action) {
  if (/(_PUBLISHED|_ACTIVATED|_ENABLED|_ASSIGNED)$/.test(action)) return 'ok';   // came into effect
  if (/(_DISABLED|_SUSPENDED|_ARCHIVED)$/.test(action)) return 'warn';           // taken out of effect
  if (/(_UPDATED|_CHANGED|_REPLACED|_CLONED)$/.test(action)) return 'info';      // altered in place
  return 'off';                                                                  // ADMIN_LOGIN, and anything new
}
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

  // Six short columns, each answering one of the four questions a trail is read for —
  // when, who, what, and to which thing — plus the diff. Every label is a full phrase
  // because the header is all a reader has to go on and half of these columns are only
  // reached by swiping on a phone: "Type" alone, arriving at the edge of the screen, does
  // not say type of what.
  const columns = [
    {
      key: 'at',
      label: 'When',
      /*
        The column that does not move when the trail is swiped on a phone.

        The candidates were the actor, the action and the time, and only one of them is a
        property of the ROW rather than of a group of rows. "Who did it" repeats down the
        page — one સંચાલક doing an evening's work is thirty rows with his name on them — and
        "Action" repeats harder still and is also the page's one filter, so it is frequently
        the same word on every visible row; a pinned column of thirty identical values is a
        column pinned for nothing. The timestamp is what actually distinguishes one entry
        from the next, it is the key the trail is ordered by (newest first), and it is what a
        person is holding in their head when they read a log at all — "what happened around
        the time the settings changed". Swiping right from it means "tell me more about this
        moment", which is the question this page is opened with.

        It is the first column too, so this changes nothing today. Written anyway, because
        DataTable's fallback is position rather than meaning, and a later column added in
        front of it should not silently take the pin.
      */
      pin: true,
      render: (r) => dateTimeGu(r.at),
    },
    {
      key: 'actorName',
      label: 'Who did it',
      render: (r) => (
        // One inline-block wrapper, so the name and the role stay a single unit rather than
        // two loose children the cell may lay out independently. Alignment is left to the
        // cell, which is why nothing here sets text-align.
        <span style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0 }}>
          <span style={{ display: 'block' }}>
            {r.actorName || <span className="mono">{r.actorId?.slice(0, 8)}…</span>}
          </span>
          {/* The role he was acting as when he did it, which is not necessarily the role
              his admin_profiles row carries today — that is the whole point of storing
              actor_role on the row instead of joining it at read time. A chip rather than
              small grey text: it is a second fact about the actor, not a caption. */}
          {r.actorRole && <span className="chip">{r.actorRole}</span>}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      // The label is the sentence; the tone only repeats what it already says.
      render: (r) => <StatusBadge tone={actionTone(r.action)}>{actionLabel(r.action)}</StatusBadge>,
    },
    { key: 'resourceType', label: 'Kind of record', render: (r) => resourceLabel(r.resourceType) },
    {
      key: 'targetId',
      label: 'Which record',
      render: (r) =>
        // `resource_type` says what the target *is*, so the link no longer has to guess
        // from the shape of the id. The prefix test stays as the fallback for rows written
        // before 0004 added the column — theirs is '' (the NOT NULL default the ALTER
        // gave existing rows), and those દર્શન entries are still worth linking.
        r.resourceType === 'scenes' || r.targetId?.startsWith('darshan-') ? (
          // `cellLink`, for the same reason UsersTab gives it to the name: admin.css gives
          // every `tbody td` the --tap floor on a phone, and a bare `a` is a 20px line of
          // text sitting inside a 44px row, so most of the target a thumb aims at is dead
          // space beside the link rather than the link. Filling the cell makes the row's
          // height the link's height.
          <Link className="mono" style={cellLink} to={`/darshan/${r.targetId}`}>{r.targetId}</Link>
        ) : (
          // A uuid is 36 unbroken characters. On a desk `overflow-wrap: break-word` is
          // inherited from the td (admin.css) so it breaks inside the id rather than
          // widening the column; on a phone the cell is nowrap and the id is simply one of
          // the things the sideways swipe pays for. max-width keeps it inside its cell in
          // both cases.
          <span className="mono" style={{ maxWidth: '100%' }}>{r.targetId || '-'}</span>
        ),
    },
    { key: 'details', label: 'What changed', render: (r) => <Details row={r} /> },
  ];

  /*
    An empty trail has two causes and the page must not pick one for the reader.

    The select policy on audit_logs is `has_permission('audit.read')`, and a policy that
    refuses a read returns **zero rows, not an error** — so "no entry was found" and "this
    account may not read the trail" arrive looking exactly alike. Saying only the first
    would tell a સંચાલક whose role cannot see the log that nothing has ever happened, which
    is the one wrong thing an audit page can say. Both are stated, and neither is presented
    as the certain one.
  */
  const emptyMessage = action
    ? 'No entry matches this action, or this account is not permitted to read the trail.'
    : 'No change has been recorded yet, or this account is not permitted to read the trail.';

  return (
    <>
      <PageHeader title="Audit Log" sub="Every important change - cannot be deleted or edited" />

      {/* One filter, and it is a real WHERE clause — listAudit() passes it to
          `.eq('action', …)`. Nothing on this page filters rows the browser has already
          been sent (§28). */}
      <div className="filters" role="group" aria-label="Filter the trail">
        <div className="field">
          <label htmlFor="a">Action</label>
          <select
            id="a"
            value={action}
            onChange={(e) => {
              reset();
              setAction(e.target.value);
            }}
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="hint">Newest first. Entries are never edited or removed.</span>
        </div>
      </div>

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !rows.length }}
        emptyIcon="▤"
        emptyTitle="Nothing to show here"
        empty={emptyMessage}
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
  if (v === null || v === undefined || v === '') return '-';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/**
 * One changed field, as a chip.
 *
 * Chips instead of one long mono line, for a phone as much as for a desk: a run of forty
 * characters, a dot, another forty is a single unbreakable-looking string that no eye finds
 * a boundary in. Each field is now its own box, `max-width: 100%` keeps the widest one
 * inside its cell, and the `.chip` border gives the eye the separation between two fields
 * that a middle dot never did.
 *
 * They are inline-level, so they follow the cell's own alignment, which is why nothing here
 * sets text-align either.
 */
/**
 * The one box every chip lives in.
 *
 * This is the last column of the widest table in the panel, so on a phone it is the far end
 * of the swipe and on a desk it is whatever room the five columns before it left. A single
 * inline-block wrapper is what keeps the diff one shrinkable unit in both cases: the cell
 * can size itself against the whole group rather than against each chip in turn, and
 * `min-width: 0` is what allows that group to shrink past its widest chip instead of
 * pushing the table wider than it has to be (§36).
 */
function Changes({ children }) {
  return <span style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0 }}>{children}</span>;
}

function Change({ text, title }) {
  return (
    <span
      className="chip mono"
      title={title}
      style={{ maxWidth: '100%', marginInlineEnd: 'var(--sp-1)', marginBlockEnd: 'var(--sp-1)' }}
    >
      {text}
    </span>
  );
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
    if (!entries.length) return '-';
    return (
      <Changes>
        {entries.map(([k, v]) => (
          <Change key={k} text={`${k}: ${shortValue(v)}`} />
        ))}
      </Changes>
    );
  }

  const line = (c) => (created ? `${c.field}: ${shortValue(c.to)}` : `${c.field}: ${shortValue(c.from)} → ${shortValue(c.to)}`);
  const shown = changes.slice(0, MAX_FIELDS);
  const rest = changes.length - shown.length;

  return (
    <Changes>
      {/* The full list stays in the title of every chip rather than only the first, so
          hovering anywhere in the cell answers "and what else moved?" — the question a row
          with a +N is read for. */}
      {shown.map((c) => (
        <Change key={c.field} text={line(c)} title={changes.map(line).join('\n')} />
      ))}
      {rest > 0 && <span className="hint">+{rest} more</span>}
    </Changes>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so paging through the trail does not allocate a fresh
 * style object per row.
 * ------------------------------------------------------------------------- */

/**
 * A link that is as tall as the row it sits in.
 *
 * admin.css gives every `tbody td` a height of --tap below 900px so that a row is a
 * thumb-sized target. An `a` inside one is an inline box the height of its text — measured
 * at 20px — so the row was tall enough and the part of it that navigated was not, and a
 * thumb aimed at the middle of the row landed beside the link. `align-items: center` keeps
 * the id optically where it was rather than riding the top of a 44px box, and `height: 100%`
 * rather than a floor of its own means the link only ever matches whatever the cell settled
 * on, including on a desk where there is no floor at all.
 */
const cellLink = { display: 'flex', alignItems: 'center', height: '100%' };
