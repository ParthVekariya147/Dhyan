import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getUser } from '../services/userService';
import { Empty, ErrorState, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import { dateTimeGu } from '../../../lib/format';
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
 * The sections
 * ------------
 * Two, and only two, because two is what `profiles` supports:
 *
 *   Basic information   profiles — who he is and how to reach him
 *   Account status      profiles again, but a different question: does the account work,
 *                       and which gates has he passed
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where the "Remembered" tiles, the "Learning progress" card and the results
 * table went
 * ────────────────────────────────────────────────────────────────────────────
 *
 * All three read `learning_state` and `learning_sessions` through
 * `getLearningState()` / `getUserSessions()`. Those tables belong to the 0001 system behind
 * the `/learn` route; nothing links to that route any more, nothing writes them, and in
 * production both hold **zero rows**. So for every real યુવક this page opened with "Not
 * started yet", four zeroes and an empty Results table headed "No rounds submitted yet" —
 * about someone who may have completed લેવલ ૩ and passed every લેવલ ૪ કસોટી. That is not a
 * missing feature; it is the page stating something false about a person, which §29 and §62
 * both forbid.
 *
 * They are not rewritten here. Levels ૧–૪ progress is a document of its own — per-level
 * status, remembered દ્રશ્યો, per-કસોટી results — and it already has a page:
 * /progress/:userId, built on `admin_user_progress_detail()` (0028). Duplicating a shortened
 * version of it beside the account details would be a second copy of the same facts that can
 * disagree with the first. This page links to it instead.
 *
 * Nothing here reads a progress table any more, which is also why there is only one read
 * left. The day-by-day attempt record has its own page too, at /users/:userId/activity: two
 * paginated histories with their own date filter are more than a profile carries.
 */

/** Same three states as the list's Status column — see UsersPage.jsx. Read-only (§19). */
const ACCOUNT_STATUS = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  SUSPENDED: { label: 'Suspended', tone: 'warn' },
  DISABLED: { label: 'Disabled', tone: 'off' },
};

export default function UserDetailPage() {
  const { userId } = useParams();
  const user = useAsync(() => getUser(userId), [userId]);

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
        What stood here was four stat tiles from `learning_state` — "Current stage",
        "Remembered", "Remaining", "Completion" — and they read "Not started yet" and three
        zeroes for every યુવક in the project, because nothing has written that table since
        levels ૧–૪ replaced it. A link is the whole fix: the real figures are one page away,
        measured from the attempts he actually submitted, and this page does not keep a
        shorter copy of them that could disagree.

        Rendered only once there is a user, so the link is never built from an id this page
        could not read.
      */}
      {u && (
        <div className="notice">
          His levels 1-4 progress - per-level status, remembered darshan and every Level 4
          test - is on his progress page.{' '}
          <Link to={`/progress/${u.id}`}>View full progress report</Link>
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
        /*
          Two children and no wrapper around the first, now that the right-hand "Learning
          progress" card has gone. `.detail-cols` is a fixed two-column grid: leaving the two
          profile cards stacked in one <div> would have left the whole right-hand column
          empty, so they take a column each and the grid is full again.
        */
        <div className="detail-cols">
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
      )}

      {/*
        A "Results" table stood here, over `learning_sessions` — the rounds a યુવક submitted
        through the retired `/learn` flow, with a CSV export beside it. That table has no
        writer and no rows, so the block rendered "No rounds submitted yet" on every profile
        in the project, including યુવકો with dozens of real attempts behind them, and the
        export button next to it produced an empty file. An empty state is a statement (§35),
        and this one was false about a person.

        Its two replacements both already exist and neither is duplicated here: the
        day-by-day attempt record is at /users/:userId/activity, reached from the header
        above, and the levels ૧–૪ report with its own export is at /progress/:userId, linked
        at the top of this page.
      */}
    </>
  );
}
