import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { dateTimeGu } from '../../../lib/format';
import { subZoneNameEn } from '../../../lib/labels';
import { listTestUsers, purgeTestAccount, setTestAccount, testWriteError } from '../services/userService';
import '../users.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The accounts that exist to try the app, and the only screen that lists them
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A test account is a real યુવક account in every mechanical sense: it signs in, it earns
 * points, it writes progress rows, it answers the entry gate. The single thing that is true of
 * it and of nobody else is that `profiles.is_test` is set, which takes it out of
 * `public.counted_profiles` and therefore out of `public.yuvaks`, the leaderboard, every count
 * on the dashboard, all nine report functions and every Excel export (0040).
 *
 * That is why this tab has to exist at all. Once an account is excluded from every list in the
 * panel, the panel has no way to show you that it is there — and an account that behaves like a
 * person, holds points, and appears nowhere is indistinguishable from a bug in whichever total
 * somebody is squinting at. This screen is the ledger of the exclusion: who is excluded, since
 * when, and the two ways back out of it.
 *
 * ── Two actions, two permissions, and the database owns both ────────────────
 *
 * "Return to normal" clears the flag and the account rejoins every figure it had been left out
 * of. "Purge" deletes it and everything it produced, and is the one delete in a codebase whose
 * §7 is "suspend, never delete" — the exemption is that there is no person here and the history
 * is noise that was manufactured on purpose.
 *
 * Each button is rendered only when `can()` says the role holds the permission behind it, and
 * that is *visibility*, exactly as it is in AdminsTab and in AdminShell's sidebar. The boundary
 * is `profiles_guard_test_flag()` and the `users.purge` check inside
 * `admin_purge_test_account()`, which refuse the same two things again with no regard for what
 * this file rendered. Somebody who edits the check out of his own copy of the bundle gets a
 * button that produces a refusal, which is the correct outcome — and the reason the refusal is
 * shown in full rather than swallowed.
 *
 * ── Why every result on this screen is read back rather than assumed ────────
 *
 * The trigger behind the flag *holds* a change it will not allow instead of raising, so a
 * write that was refused answers `200, no error`. setTestAccount() re-reads the row and throws
 * when it comes back unchanged; this screen simply shows what it says. A panel that reported
 * "returned to normal" over an account still excluded from every report would be the worst
 * kind of wrong: confidently, and about something nobody would think to check twice.
 */

export default function TestAccountsTab() {
  const { can } = useAdminAuth();

  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState('');

  // The row an action is about, and which action: { kind: 'unmark' | 'purge', user }. One
  // piece of state for both dialogs, as AdminsTab does with four - only one can be open at a
  // time, and two independent booleans is how both end up open at once.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  // The refusal, rendered inside the dialog that caused it so it sits directly above the
  // button that would be pressed again. Cleared when a dialog opens, never on a timer.
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null); // { tone, text } — the outcome, on the page

  const state = useAsync(() => listTestUsers({ term: applied }), [applied]);

  const rows = state.data?.rows || [];

  const open = (kind, user) => {
    setFailure('');
    // The previous outcome goes when the next dialog opens. It is a statement about a write
    // that has already happened, and leaving "Rakesh has been purged" on screen above a dialog
    // about somebody else is the panel appearing to describe what is in front of you.
    setNote(null);
    setPending({ kind, user });
  };

  const close = () => {
    if (busy) return;
    setPending(null);
    setFailure('');
  };

  /**
   * Both writes go through here, so they cannot disagree about what happens afterwards.
   *
   * The list is re-read on success rather than patched in place. After either action the row
   * has genuinely left `test_yuvaks` - unmarked back into the yuvak list, or deleted outright -
   * and a re-read is the only version of that which is not this component's guess (§62).
   *
   * `fn` returns what to say afterwards, and returns it *after* the write rather than being
   * handed it beforehand, because in one case the sentence depends on what came back: a purge
   * reports how much went with the account, and may have to report that the login did not.
   * A plain string is the ordinary success; an object is a result that needs its own tone.
   */
  const run = async (fn) => {
    setBusy(true);
    setFailure('');
    try {
      const said = await fn();
      setPending(null);
      setNote(typeof said === 'string' ? { tone: 'notice-ok', text: said } : said);
      state.retry();
    } catch (e) {
      // Never swallowed and never generalised. testWriteError() is what turns a held flag and
      // the endpoint's named refusals into a sentence somebody can act on; a bare saveError()
      // would answer both with "please try again", which is the one thing that will not work.
      setFailure(testWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  const unmark = (user) =>
    run(async () => {
      await setTestAccount(user.id, false);
      return `${user.name || 'This account'} is a normal account again. It is back in the yuvak list, the counts, the reports and the leaderboard, with every point it earned while it was excluded.`;
    });

  const purge = (user) =>
    run(async () => {
      const res = await purgeTestAccount(user.id);
      // The endpoint's own summary is preferred over the row this screen was showing: it was
      // read inside the transaction that did the deleting, so it is what was actually removed
      // rather than what this table believed a moment ago (§62). The row is the fallback for
      // the name only, which cannot come back empty from a purge that succeeded.
      const who = res.name || user.name || 'The account';
      const what = `${res.pointsRemoved} point entries and ${res.daysRemoved} daily records went with it.`;

      /*
        The 207: the data was deleted and the GoTrue login was not. Reported as its own outcome
        rather than as a success or a failure, because it is neither and both of the wrong
        readings do harm - "failed" has somebody retry a purge against an account that is
        already gone, and "done" leaves a working credential that nobody knows about. The fix
        is a person opening the Supabase dashboard, so the sentence says exactly that.
      */
      if (!res.authDeleted) {
        const address = res.email || user.email;
        return {
          tone: 'notice-warn',
          text: `The data for ${who} has been deleted - ${what} Its login could not be removed, so the account can still sign in. Ask whoever runs the Supabase project to delete the user${address ? ` ${address}` : ''}. Do not try the purge again - there is nothing left here to delete.`,
        };
      }
      return `${who} has been purged. ${what}`;
    });

  const columns = [
    {
      key: 'name',
      label: 'Name',
      /*
        The column that stays put when the table is swiped on a phone, and the same choice the
        yuvak list makes for the same reason: SMK is absent for a large share of accounts, so
        pinning the first column would hold a stack of dashes on screen while the names scrolled
        away under the thumb. There is no SMK column here at all, but the pin is named rather
        than left to DataTable's "first column" default - the default is an accident of order,
        and the moment anything is put in front of Name it would move silently.

        Linked to the user page like the yuvak list, and it genuinely resolves: getUser() reads
        LOOKUP (`profiles_level4`), which does not subtract test accounts. Checking what a test
        account has actually recorded is most of the reason for looking at this screen.
      */
      pin: true,
      render: (u) => (
        <Link to={`/users/${u.id}`} style={cellLink}>
          <span style={cellLinkText}>{u.name || '-'}</span>
        </Link>
      ),
    },
    { key: 'mobile', label: 'Mobile', render: (u) => <span className="mono">{u.mobile || '-'}</span> },
    // Shown here where the yuvak list hides it below 900px, and never exported from this
    // screen: on a test account the address is the thing you need in order to sign in as it,
    // and it is the thing the 207 above asks somebody to go and delete by hand.
    { key: 'email', label: 'Email' },
    { key: 'subZoneId', label: 'Subzone', render: (u) => subZoneNameEn(u.subZoneId) },
    {
      key: 'testMarkedAt',
      label: 'Marked on',
      /*
        The date and the time, where every other list in the panel shows only the date.

        Marking is an administrative act rather than a fact about a person, several of these
        rows are usually made within the same hour of setting the app up, and "15 Aug 2026" on
        all of them says nothing. It comes from `profiles.test_marked_at`, stamped by the
        trigger from the database clock - see readTestMarks() for why it takes a second query.

        A dash means the column really is null, which is a mark made by a migration or the
        secret key rather than by anybody using this screen.
      */
      render: (u) => dateTimeGu(u.testMarkedAt),
    },
  ];

  /*
    The Actions column exists only for a role that has an action in it. `users.test` is what
    opened this tab, so in practice the column is always built and "Return to normal" is always
    offered - the check is written anyway so that this component depends on the permission it
    actually needs rather than on where somebody happened to mount it. `users.purge` is a
    separate grant and genuinely may be absent.
  */
  const canUnmark = can('users.test');
  const canPurge = can('users.purge');

  if (canUnmark || canPurge) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      render: (u) => (
        <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
          {canUnmark && (
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => open('unmark', u)}>
              Return to normal
            </button>
          )}
          {canPurge && (
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => open('purge', u)}>
              Purge
            </button>
          )}
        </span>
      ),
    });
  }

  return (
    <>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(term.trim());
        }}
      >
        <div className="field">
          <label htmlFor="tst-q">Search</label>
          <input
            id="tst-q"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Mobile, email, SMK or name"
            // Identifiers, in an English panel: an autocapitalised "Pgv" matches no SMK, and a
            // phone offering to correct a name is offering to break the search.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="tst-q-hint"
          />
          <span className="hint" id="tst-q-hint">Full mobile/email/SMK, or the beginning of a name</span>
        </div>

        <button className="btn btn-quiet" type="submit">Search</button>

        {applied && (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              setTerm('');
              setApplied('');
            }}
          >
            Clear search
          </button>
        )}
      </form>

      {note && (
        <div className={`notice ${note.tone}`} role="status">
          {note.text}
        </div>
      )}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && rows.length === 0 }}
        emptyTitle={applied ? 'Nothing matches this search' : 'No test accounts'}
        emptyIcon="🧪"
        /*
          §35 - an empty list is an offer, and here it is also the only place the feature is
          explained. A person who opens this tab for the first time meets exactly this screen,
          so it says what a test account is, what marking one costs, and where the marking is
          done. Sending him to look for a button he has not been told about would be a section
          that documents itself only once it is no longer empty.
        */
        empty={
          applied
            ? 'No test account matches this search.'
            : 'A test account is an ordinary yuvak account that exists to try the app. It signs in, earns points and records progress exactly like any other - and it is left out of every total, ranking, list, report and export, so trying things out never moves a real number. To make one, find the account in the Yuvaks tab and choose "Mark as test" on its row. Nothing is deleted by marking it, and it can be returned to normal here at any time.'
        }
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable caption="Test account list" columns={columns} rows={rows} rowKey={(u) => u.id} />

          {/* Only ever seen if somebody marks two hundred accounts, and stated rather than
              hidden for the same reason every other list in the panel says when it truncated:
              a list that is quietly partial is worse than one that admits it. */}
          {state.data?.truncated && (
            <div className="notice notice-warn" role="status">
              Showing the first {state.data.cap} test accounts. Narrow the search to see the rest.
            </div>
          )}

          <p className="card-note">
            Nobody in this list is counted anywhere else in the panel. They are excluded from the
            yuvak list, the dashboard totals, the leaderboard, every report and every export -
            which is what makes them safe to experiment with, and what makes this the only screen
            that can show you they exist.
          </p>
        </>
      </AsyncBlock>

      {/*
        One ConfirmDialog for both actions (§57), so the two cannot drift into two different
        ways of asking the same question - and, more usefully, so a refusal is rendered in the
        same place for both, right above the button that will be pressed again.
      */}
      <ConfirmDialog
        open={!!pending}
        title={
          pending
            ? pending.kind === 'purge'
              ? `Purge ${pending.user.name || 'this test account'}?`
              : `Return ${pending.user.name || 'this account'} to normal?`
            : ''
        }
        busy={busy}
        // Only the delete is drawn as a danger. Unmarking puts an account *back* into the
        // numbers and is undone by marking it again; there is nothing to warn about.
        danger={pending?.kind === 'purge'}
        confirmLabel={pending?.kind === 'purge' ? 'Yes, delete it permanently' : 'Yes, return it to normal'}
        onCancel={close}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'purge') purge(pending.user);
          else unmark(pending.user);
        }}
        body={pending && <DialogBody pending={pending} failure={failure} />}
      />
    </>
  );
}

/**
 * What each dialog says.
 *
 * The purge wording is deliberately blunt and lists what goes rather than saying "all its
 * data". §57 exists because nothing that changes production content should happen on one
 * click, and a confirmation that says less than the action does is a click-through disguised
 * as a safeguard - the person needs to be told that the points and the daily records go too,
 * before he presses it, not afterwards when the summary tells him how many there were.
 */
function DialogBody({ pending, failure }) {
  const { kind, user } = pending;
  return (
    <>
      {kind === 'unmark' && (
        <p>
          It becomes an ordinary account again: it returns to the yuvak list, the dashboard
          totals, the leaderboard, the reports and the exports, and it takes every point it
          earned while it was excluded with it. Nothing is deleted, and it will leave this list.
        </p>
      )}

      {kind === 'purge' && (
        <>
          <p>
            This deletes the account and everything it ever produced: its profile, every point
            it earned, every daily record, every level 3 and level 4 attempt and revision, and
            its login. {user.email ? `Its email address, ${user.email}, becomes free to register again.` : ''}
          </p>
          <p>
            <strong>This cannot be undone.</strong> There is no suspended state and no recycle
            bin - the only record left afterwards is the audit entry saying you did it.
          </p>
        </>
      )}

      {failure && (
        <div className="notice notice-danger" role="alert" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
          {failure}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants — module scope, so a search or a re-read does not allocate a fresh style
 * object per row.
 *
 * Copied from UsersTab rather than shared with it, and both are three properties long. The
 * alternative was one tab importing the other's private layout constants, which makes the
 * yuvak list a module this one depends on for reasons that have nothing to do with data. The
 * reasoning behind each property is written out in full there.
 * ------------------------------------------------------------------------- */

/** A link as tall as the row it sits in, so the whole 44px cell is the tap target below 900px. */
const cellLink = { display: 'flex', alignItems: 'center', height: '100%', minWidth: 0 };

/** The block container `.is-pin`'s text-overflow needs, restored inside the flex link. */
const cellLinkText = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
