import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getUser } from '../services/userService';
import { getLearningState, getUserSessions } from '../../learning/services/learningService';
import { AsyncBlock, CardSkeleton, Empty, ErrorState, FormSkeleton, TableSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader, StatusBadge } from '../../../components/StatCard';
import DataTable from '../../../components/DataTable';
import { dateTimeGu, gu, percent } from '../../../lib/format';
import { exportCsv, istDateTime, reportFilename } from '../../../lib/export';
import { STAGE_LABEL } from '../../../lib/domain';
import { subZoneNameEn } from '../../../lib/labels';

/**
 * §15, §19, §20 — one yuvak, read-only.
 *
 * Read-only is the default and stays that way: §19 says so, and hand-editing someone's
 * progress would corrupt the one thing the app exists to record. There is no "log in as
 * this user" (§66) — support means seeing where he is, not becoming him. And nothing
 * here can show a password or a token, because Supabase Auth keeps both in auth.users,
 * which no client key can read and no RLS policy on public.* can reach (§67).
 *
 * Every figure is read from his own rows. Completion is measured against the scene
 * count as it stood when he submitted, not today's, so adding content does not silently
 * reduce a finished yuvak's percentage.
 *
 * The sections
 * ------------
 * Four, and only four, because four is what the data supports:
 *
 *   Basic information   profiles — who he is and how to reach him
 *   Account status      profiles again, but a different question: does the account work,
 *                       and which gates has he passed
 *   Learning progress   learning_state — one row, his live position
 *   Results             learning_sessions — the rounds he has submitted
 *
 * There is still deliberately no attempts section and no timeline **on this page**, and the
 * reasoning has only half changed. The old half was that a timeline would need a per-user
 * event log that nothing writes; something writes one now (`activity_attempts`, and the
 * `attempt_history` view that unions it with `level4_attempts`). The half that stands is the
 * one that decided the shape: two paginated histories with their own date filter are more
 * than a profile carries, and an empty section headed "Timeline" would still read as "this
 * yuvak has done nothing", which is a statement rather than a placeholder (§62). So the
 * record lives at /users/:userId/activity and this page carries a link to it.
 *
 * Three reads, three independent states. A failed learning read does not blank the profile
 * beside it, and vice versa — each block reports its own outcome and carries its own retry.
 */

/** Same three states as the list's Status column — see UsersPage.jsx. Read-only (§19). */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
};

/**
 * The round's own lifecycle, straight from learning_sessions.status (0004_rbac.sql:250) —
 * the same column and the same words the Sessions list uses, so one round cannot be
 * described two ways in one panel. ABANDONED is neutral grey: a round left unfinished is
 * not a failure and nothing here marks it as one (§29).
 */
const SESSION_STATUS = {
  COMPLETED: { label: 'Complete', tone: 'ok' },
  STARTED: { label: 'Started', tone: 'warn' },
  IN_PROGRESS: { label: 'In progress', tone: 'warn' },
  ABANDONED: { label: 'Not finished', tone: 'off' },
};

export default function UserDetailPage() {
  const { userId } = useParams();
  const user = useAsync(() => getUser(userId), [userId]);
  const learning = useAsync(() => getLearningState(userId), [userId]);
  const sessions = useAsync(() => getUserSessions(userId), [userId]);

  // The way back up, on every state this page can be in — including the two below, which
  // return before the main layout is reached.
  const crumbs = [{ to: '/users', label: 'Users' }, { label: 'Profile' }];

  if (user.error) {
    return (
      <>
        <PageHeader title="User" crumbs={crumbs} />
        <ErrorState message={user.error} onRetry={user.retry} />
      </>
    );
  }

  if (!user.loading && !user.data) {
    return (
      <>
        <PageHeader title="User not found" crumbs={crumbs} />
        <Empty
          icon="🔍"
          title="No user with this ID"
          message="The link may be out of date, or the user may have been removed from the list you came from."
          action={<Link className="btn" to="/users">Back to the user list</Link>}
        />
      </>
    );
  }

  const u = user.data;
  const l = learning.data;
  const rounds = sessions.data || [];
  // His best round, from the rounds already on screen. Only meaningful once that read has
  // actually returned — see the cell below.
  const best = rounds.reduce((m, s) => Math.max(m, s.remembered), 0);

  const account = ACCOUNT_STATUS[u?.status] || { label: u?.status || '-', tone: 'off' };

  return (
    <>
      <PageHeader
        crumbs={u ? [{ to: '/users', label: 'Users' }, { label: u.name || 'Profile' }] : crumbs}
        title={u?.name || 'User'}
        sub={u ? `${u.smk || 'No SMK'} · ${subZoneNameEn(u.subZoneId)}` : 'Loading this profile…'}
        actions={
          <>
            {/*
              The way to this user's day-by-day record, and it is a separate page rather than
              another section here for the reason this file already gives about a timeline:
              a section is only honest once something writes the data behind it, and once
              something does, two paginated histories are more than a profile page should
              carry. Offered only when there is a user to have a history — a link built from
              an id this page could not read would go nowhere.
            */}
            {u && (
              <Link className="btn btn-quiet" to={`/users/${u.id}/activity`}>
                Activity &amp; points
              </Link>
            )}
            <Link className="btn btn-quiet" to="/users">← Back to list</Link>
          </>
        }
      />

      {/*
        A failed read is not a fact about the યુવક. `learning.error` was never consulted, so
        an expired JWT (PGRST301), a denied policy (42501) or a dropped connection rendered
        four dashes under the words "Not started yet" — the panel asserting he had never
        begun. The session card beside it already showed the error through AsyncBlock, so
        one page stated both at once. The stats now report the failure and offer the same
        Try again the rest of the panel does (§53).
      */}
      {learning.error ? (
        <ErrorState message={learning.error} onRetry={learning.retry} />
      ) : learning.loading ? (
        <CardSkeleton count={4} />
      ) : (
        <div className="grid-stats">
          <StatCard
            label="Current stage"
            value={l ? STAGE_LABEL[l.currentStage] || l.currentStage : '-'}
            // Only once the read has actually returned nothing. While it is in flight there
            // is no ground for saying anything about where he has reached.
            sub={l ? null : 'Not started yet'}
          />
          <StatCard label="Remembered" value={gu(l?.remembered ?? 0)} sub={l?.total ? `of ${gu(l.total)} darshan` : null} />
          <StatCard label="Remaining" value={gu(l?.pending ?? 0)} />
          <StatCard label="Completion" value={l?.total ? percent(l.remembered, l.total) : '-'} />
        </div>
      )}

      {user.loading ? (
        // Form-shaped, because that is the shape of the two label/value cards below: the
        // rows arrive into the space the placeholder was holding (§33).
        <div className="detail-cols">
          <FormSkeleton fields={6} />
          <FormSkeleton fields={5} />
        </div>
      ) : (
        <div className="detail-cols">
          <div>
            <section className="card" aria-labelledby="s-basic">
              <h2 id="s-basic">Basic information</h2>
              <dl className="kv">
                <dt>Name</dt><dd>{u?.name || '-'}</dd>
                <dt>SMK</dt><dd className="mono">{u?.smk || '-'}</dd>
                {/* Contact details, shown under the same users.read the route is gated on
                    (App.jsx) and the same policy the row came through. Nothing here widens
                    who may see them (§13). */}
                <dt>Email</dt><dd>{u?.email || '-'}</dd>
                <dt>Mobile</dt><dd className="mono">{u?.mobile || '-'}</dd>
                <dt>Subzone</dt><dd>{subZoneNameEn(u?.subZoneId)}</dd>
                <dt>Registered</dt><dd>{dateTimeGu(u?.createdAt)}</dd>
              </dl>
            </section>

            <section className="card" aria-labelledby="s-account">
              <h2 id="s-account">Account status</h2>
              <dl className="kv">
                {/* profiles.status (0004_rbac.sql:175) — §7 suspends, never deletes. Shown
                    separately from the entry gate below: one is whether the account works,
                    the other is whether he answered §5's honour-system questions. */}
                <dt>Account</dt>
                <dd><StatusBadge tone={account.tone}>{account.label}</StatusBadge></dd>

                <dt>Entry gate</dt>
                <dd>{u?.gatePassedAt ? dateTimeGu(u.gatePassedAt) : <StatusBadge tone="warn">Pending</StatusBadge>}</dd>

                {/* Honour-system answers (§5) — recorded so the સંચાલક can see who said હા.
                    Plain words rather than a green/grey pill: "No" here is an answer, not a
                    state to be flagged. */}
                <dt>Liked</dt><dd>{u?.likeAnswer ? 'Yes' : 'No'}</dd>
                <dt>Commented</dt><dd>{u?.commentAnswer ? 'Yes' : 'No'}</dd>

                {/*
                  Both facts, because on this page the difference is the useful part: "Open"
                  is the gate the published configuration defines now (0011), and the note
                  beside it is 0008's fixed-80 record. With a threshold of ૫૦ the first is
                  true at ૫૦ while the second waits for ૮૦, and a સંચાલક looking at one યુવક
                  is exactly the reader who needs to see which of the two he is asking about.
                */}
                <dt>Level 4</dt>
                <dd>
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    {u?.level4GateOpen
                      ? <StatusBadge tone="ok">Open</StatusBadge>
                      : <StatusBadge tone="off">Not yet</StatusBadge>}
                    {u?.level4Unlocked && !u?.level4GateOpen && (
                      <StatusBadge tone="off">Reached 80 at Level 3</StatusBadge>
                    )}
                  </span>
                </dd>
              </dl>
              <p className="card-note">
                This page is read-only. An account is suspended or restored from the database,
                never from here, and a user's progress cannot be changed from the panel at all.
              </p>
            </section>
          </div>

          <section className="card" aria-labelledby="s-progress">
            <h2 id="s-progress">Learning progress</h2>
            {learning.error ? (
              <p className="card-note">His progress could not be read - see the message above.</p>
            ) : (
              <dl className="kv">
                <dt>Current stage</dt>
                <dd>{learning.loading ? '-' : l ? STAGE_LABEL[l.currentStage] || l.currentStage : 'Not started yet'}</dd>
                {/* Both come from the same read as the stat cards. When it failed, a hard
                    "0" here would be the same false statement the cards used to make. */}
                <dt>Rounds completed</dt>
                <dd className="mono">{learning.loading ? '-' : l?.completedSessions ?? 0}</dd>
                <dt>Best score</dt>
                {/* From the rounds table below, so it says nothing until that read lands —
                    a "0" while it is in flight would be a claim, not a blank. */}
                <dd className="mono">{sessions.loading || sessions.error ? '-' : best || '-'}</dd>
                <dt>Last activity</dt>
                <dd>{l ? dateTimeGu(l.updatedAt) : '-'}</dd>
              </dl>
            )}
          </section>
        </div>
      )}

      <h2 className="section-title">Results</h2>
      {/* No card around this one: `.table-wrap` is already a surface with its own border,
          and the empty and error states below are cards in their own right. Wrapping them
          would draw a frame inside a frame. */}
      <AsyncBlock
        state={{ ...sessions, isEmpty: !sessions.loading && !sessions.error && !rounds.length }}
        emptyTitle="No rounds submitted yet"
        emptyIcon="📋"
        empty="Nothing appears here until this yuvak submits his first learning round."
        onRetry={sessions.retry}
        skeleton={<TableSkeleton cols={6} />}
      >
        <>
          <DataTable
            caption="Submitted rounds, newest first"
            columns={[
              { key: 'sessionId', label: 'Session', render: (s) => <span className="mono">{s.sessionId}</span> },
              { key: 'submittedAt', label: 'Submitted', render: (s) => dateTimeGu(s.submittedAt) },
              { key: 'remembered', label: 'Remembered', align: 'right', render: (s) => <span className="mono">{s.remembered}</span> },
              { key: 'pending', label: 'Remaining', align: 'right', render: (s) => <span className="mono">{s.pending}</span> },
              { key: 'pct', label: 'Completion', align: 'right', render: (s) => (s.total ? percent(s.remembered, s.total) : '-') },
              {
                key: 'status',
                label: 'Status',
                // The column the export already carries, now on screen too — a file and a
                // table describing the same round must not disagree about what it is. A
                // value the CHECK constraint does not know about can only come from a
                // later migration: show it raw rather than as a blank or a wrong badge.
                render: (s) => {
                  const st = SESSION_STATUS[s.status];
                  return st ? (
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  ) : (
                    <StatusBadge tone="off">{s.status || '-'}</StatusBadge>
                  );
                },
              },
            ]}
            rows={rounds}
            rowKey={(s) => s.id}
          />

          <div className="form-actions">
            {/*
              §11 — the same Excel export, for one યુવક.

              No fetch behind it: these are the rounds already on screen, so the file is
              exactly the table above it and the note can say "the last N rounds" without
              a second read that might disagree. The file carries this one person's SMK
              and name and no contact detail (§13).
            */}
            <button
              className="btn btn-quiet"
              type="button"
              disabled={!rounds.length}
              onClick={() =>
                exportCsv({
                  filename: reportFilename(`yuvak-${u?.smk || 'rounds'}`.toLowerCase(), {}),
                  columns: [
                    { label: 'SMK', value: () => u?.smk || '' },
                    { label: 'Name / નામ', value: () => u?.name || '' },
                    { label: 'Session', value: (s) => s.sessionId },
                    { label: 'Submitted', value: (s) => istDateTime(s.submittedAt) },
                    { label: 'Remembered', value: (s) => s.remembered },
                    { label: 'Remaining', value: (s) => s.pending },
                    { label: 'Total', value: (s) => s.total },
                    // Derived here too, from the two counts in the same row (§62).
                    { label: 'Completion %', value: (s) => (s.total ? Math.floor((s.remembered / s.total) * 1000) / 10 : '') },
                    { label: 'Status', value: (s) => s.status },
                    { label: 'Memory Darshan finished', value: (s) => istDateTime(s.completedAt) },
                  ],
                  rows: rounds,
                })
              }
            >
              Export these rounds (CSV)
            </button>
            <span className="save-state">Showing the last {gu(rounds.length)} rounds.</span>
          </div>
        </>
      </AsyncBlock>
    </>
  );
}
