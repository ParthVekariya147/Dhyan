import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getUser } from '../services/userService';
import { getLearningState, getUserSessions } from '../../learning/services/learningService';
import { AsyncBlock, ErrorState } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import DataTable from '../../../components/DataTable';
import { dateTimeGu, gu, percent } from '../../../lib/format';
import { exportCsv, istDateTime, reportFilename } from '../../../lib/export';
import { STAGE_LABEL } from '../../../lib/domain';
import { subZoneNameEn } from '../../../lib/labels';

/**
 * §19, §20 — one yuvak, read-only.
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
 */

/** Same three states as the list's Status column — see UsersPage.jsx. Read-only (§19). */
const accountPill = (status) =>
  ({
    ACTIVE: { label: 'Active', tone: 'pill-ok' },
    SUSPENDED: { label: 'Suspended', tone: 'pill-warn' },
    DISABLED: { label: 'Disabled', tone: 'pill-off' },
  })[status] || { label: status || '—', tone: 'pill-off' };

export default function UserDetailPage() {
  const { userId } = useParams();
  const user = useAsync(() => getUser(userId), [userId]);
  const learning = useAsync(() => getLearningState(userId), [userId]);
  const sessions = useAsync(() => getUserSessions(userId), [userId]);

  if (user.error) return <ErrorState message={user.error} onRetry={user.retry} />;
  if (!user.loading && !user.data) {
    return (
      <>
        <PageHeader title="User not found" />
        <div className="card">
          <p>There is no user with this ID.</p>
          <p className="card-note"><Link to="/users">Back to the list</Link></p>
        </div>
      </>
    );
  }

  const u = user.data;
  const l = learning.data;
  const rounds = sessions.data || [];
  const best = rounds.reduce((m, s) => Math.max(m, s.remembered), 0);

  return (
    <>
      <PageHeader
        title={u?.name || 'User'}
        sub={u ? `${u.smk} · ${subZoneNameEn(u.subZoneId)}` : ''}
        actions={<Link className="btn btn-quiet" to="/users">← List</Link>}
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
      ) : (
        <div className="grid-stats">
          <StatCard
            label="Current stage"
            value={l ? STAGE_LABEL[l.currentStage] || l.currentStage : '—'}
            // Only once the read has actually returned nothing. While it is in flight there
            // is no ground for saying anything about where he has reached.
            sub={!learning.loading && !l ? 'Not started yet' : null}
            loading={learning.loading}
          />
          <StatCard label="Remembered" value={gu(l?.remembered ?? 0)} sub={l?.total ? `of ${gu(l.total)}` : null} loading={learning.loading} />
          <StatCard label="Remaining" value={gu(l?.pending ?? 0)} loading={learning.loading} />
          <StatCard
            label="Completion"
            value={l?.total ? gu(percent(l.remembered, l.total)) : '—'}
            loading={learning.loading}
          />
        </div>
      )}

      <div className="detail-cols">
        <div className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Name</dt><dd>{u?.name || '—'}</dd>
            <dt>SMK</dt><dd className="mono">{u?.smk || '—'}</dd>
            <dt>Email</dt><dd>{u?.email || '—'}</dd>
            <dt>Mobile</dt><dd className="mono">{u?.mobile || '—'}</dd>
            <dt>Subzone</dt><dd>{subZoneNameEn(u?.subZoneId)}</dd>
            <dt>Registered</dt><dd>{dateTimeGu(u?.createdAt)}</dd>
            {/* profiles.status (0004_rbac.sql:175) — §7 suspends, never deletes. Shown
                separately from the entry gate below: one is whether the account works,
                the other is whether he answered §5's honour-system questions. */}
            <dt>Account</dt>
            <dd>{u ? <span className={`pill ${accountPill(u.status).tone}`}>{accountPill(u.status).label}</span> : '—'}</dd>
            <dt>Entry gate</dt>
            <dd>{u?.gatePassedAt ? dateTimeGu(u.gatePassedAt) : <span className="pill pill-warn">Pending</span>}</dd>
            {/* Honour-system answers (§5) — recorded so the સંચાલક can see who said હા. */}
            <dt>Liked</dt><dd>{u?.likeAnswer ? 'Yes' : 'No'}</dd>
            <dt>Commented</dt><dd>{u?.commentAnswer ? 'Yes' : 'No'}</dd>
            {/*
              Both facts, because on this page the difference is the useful part: "Open" is
              the gate the published configuration defines now (0011), and the note beside
              it is 0008's fixed-80 record. With a threshold of ૫૦ the first is true at ૫૦
              while the second waits for ૮૦, and a સંચાલક looking at one યુવક is exactly the
              reader who needs to see which of the two he is asking about.
            */}
            <dt>Level 4</dt>
            <dd>
              {u?.level4GateOpen
                ? <span className="pill pill-ok">Open</span>
                : <span className="pill pill-off">Not yet</span>}
              {u?.level4Unlocked && !u?.level4GateOpen && (
                <span className="pill pill-off" style={{ marginLeft: 8 }}>reached 80 at Level 3</span>
              )}
            </dd>
            {/* Both come from the same read as the stat cards. When it failed, a hard "0"
                here would be the same false statement the cards used to make. */}
            <dt>Rounds completed</dt>
            <dd className="mono">{learning.loading || learning.error ? '—' : l?.completedSessions ?? 0}</dd>
            <dt>Best score</dt><dd className="mono">{best || '—'}</dd>
            <dt>Last activity</dt><dd>{l ? dateTimeGu(l.updatedAt) : '—'}</dd>
          </dl>
          <p className="card-note">
            This page is read-only. A user's progress cannot be changed from here.
          </p>
        </div>

        <div className="card">
          <h2>Session history</h2>
          <AsyncBlock
            state={{ ...sessions, isEmpty: !sessions.loading && !sessions.error && !rounds.length }}
            empty="No learning session available yet."
            onRetry={sessions.retry}
          >
            <>
              <DataTable
                caption="Session history"
                columns={[
                  { key: 'sessionId', label: 'Session', render: (s) => <span className="mono">{s.sessionId}</span> },
                  { key: 'submittedAt', label: 'Submitted', render: (s) => dateTimeGu(s.submittedAt) },
                  { key: 'remembered', label: 'Remembered', align: 'right', render: (s) => <span className="mono">{s.remembered}</span> },
                  { key: 'pending', label: 'Remaining', align: 'right', render: (s) => <span className="mono">{s.pending}</span> },
                  { key: 'pct', label: 'Completion', align: 'right', render: (s) => (s.total ? percent(s.remembered, s.total) : '—') },
                ]}
                rows={rounds}
                rowKey={(s) => s.id}
              />
              <p className="card-note">Showing the last {gu(rounds.length)} rounds.</p>

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
            </>
          </AsyncBlock>
        </div>
      </div>
    </>
  );
}
