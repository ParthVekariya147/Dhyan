import { PERIOD_LABEL, useLeaderboard } from '../lib/leaderboard';
import { gu } from '../lib/constants';
/*
  Two stylesheets, and both are load-bearing.

  Vite ships a chunk's CSS with the chunk, so a class defined in a stylesheet this route has
  not imported is simply *absent* here — see the long note at src/modules/level4/RevisionPage.jsx
  lines 9-21, which is the same trap. This page is its own lazy chunk and borrows four things
  from forms.css: `.spinner-page` and its `.dot`s, `.notice`, `.btn` and `.btn-quiet`. Importing
  it is not tidiness, it is the only way those rules exist on this route at all.

  `.site-header`, `.rule` and the palette come from index.css, which main.jsx imports eagerly
  for every route, so they need no import here.
*/
import '../styles/forms.css';
import './leaderboard.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — ક્રમાંક (/leaderboard)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Show the names on the board for one window of time, and show a યુવક where he
 *                stands in it. One list, one number each, and no second question about anybody.
 *
 * Input          useLeaderboard() — the સંચાલક's `settings['levels'].value.leaderboard`, and
 *                `leaderboard(p_period)` for the window on screen. Both are this page's alone
 *                (§27: the home page must not load a board), so opening મુખપૃષ્ઠ costs nothing
 *                for them.
 * Visible        The period tabs when more than one is configured; then rank, name and points,
 *                with his own row marked; and, when he is not among the names, his own rank and
 *                points pinned at the foot.
 * Actions        Choose a window. Retry after a failure. Nothing on this page writes.
 * Persisted      Nothing at all, on the server or on the phone. This screen is a reader, and
 *                nothing about another યુવક is ever kept here (§13).
 * Completion     None. ક્રમાંક is not a level and nothing here is finished.
 * Next           Nowhere. It is a leaf; the bottom bar is how a યુવક leaves it.
 * Previous       Whatever he was on. No back link, for the same reason મારું has none.
 * Excluded       **Everything except a name and a number** — no SMK, no મોબાઈલ, no સબઝોન, no
 *                email, no dates, no per-activity detail, and no user id, not even an opaque
 *                one. That list is not a style choice: shared/domain/leaderboard.js §13 explains
 *                that an id is what turns a list of names into a key a second request can be
 *                built around, and normaliseLeaderboard() drops anything beyond the three
 *                fields before this page can render it. Also excluded, and for the tone rather
 *                than the policy: **no arrows and no movement** — nothing says he went up or
 *                came down, because a board that reports direction turns a list into a verdict
 *                delivered daily. **No streaks** (§10). **No count of how many are behind him**,
 *                and no participant total beside his rank, because "૩૭મો of ૧૨૩" is a sentence
 *                about the other ૧૨૨. **Nothing red, no bottom of the list marked, no word for
 *                a યુવક who is not on it.** A name that is absent is absent, which is emptiness
 *                and never a mark against anybody (reportService.js's tone rules, §1 rule 4).
 * Loading        The app's three dots, and the tabs stay on screen underneath the header so
 *                pressing one does not make the page jump.
 * Error / empty  Both quiet, both retryable where retrying helps, and neither worded as his
 *                doing. A board the સંચાલક never switched on is the permanent state of any
 *                project that did not want one, so it is drawn as a plain sentence and must
 *                never look like a page that failed.
 * Source of truth  `leaderboard()` (migration 0023) — one SECURITY DEFINER function, the only
 *                  aperture in the whole project through which one યુવક reads another, and no
 *                  RLS policy widened anywhere to build it. Plus `settings['levels']` for
 *                  whether there is a board at all.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The rule every string on this page was written against
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §1 rule 4: this app only ever says ફક્ત આનંદ. A leaderboard is the single most likely place
 * in the project to break that, so the test applied to each sentence below was not "is it
 * accurate?" but "could a યુવક read this and feel measured against his brother?". That is why
 * the yuvak who has earned nothing this week is told what he does today will show here, and not
 * that he is missing; why nobody's position is described as having changed; and why the only
 * row given any emphasis at all is his own, and only so he can find himself without counting
 * down the list with a finger.
 */
export default function Leaderboard() {
  const { loading, error, enabled, periods, period, setPeriod, board, retry } = useLeaderboard();

  /*
    Tabs only when there is a choice to make.

    One configured window is a label pretending to be a control: it can be pressed, it does
    nothing, and it takes 48px of a phone screen to do it. The board's own heading already says
    what he is looking at when there is only one.
  */
  const showTabs = enabled && periods.length > 1;

  const rows = board?.rows ?? [];
  /*
    A board with nobody on it. `participants` is the honest test rather than `rows.length`,
    because the two mean different things: no rows with participants above zero would be a
    board whose names did not arrive, while zero participants is nobody having earned anything
    in this window yet — which is what a brand new project, or a quiet Tuesday morning on the
    આજે tab, actually looks like.
  */
  const emptyWindow = Boolean(board) && rows.length === 0 && board.participants === 0;
  /** He is on the list already, so the pinned row at the foot would be a second copy of him. */
  const meOnBoard = rows.some((r) => r.isMe);

  return (
    <div className="lb-wrap">
      <header className="site-header">
        <h1>ક્રમાંક</h1>
        <div className="rule" />
      </header>

      <div className="lb-inner">
        {showTabs && (
          /*
            Plain buttons with `aria-pressed`, not a role="tablist": the real thing owes a screen
            reader arrow-key navigation between the tabs and a labelled panel, and a half-built
            tablist tells assistive software something untrue. Four buttons that say whether they
            are on is the whole of what this control is.
          */
          <div className="lb-tabs">
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                className={p === period ? 'lb-tab is-on' : 'lb-tab'}
                aria-pressed={p === period}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="spinner-page">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        {/*
          Said as the app's difficulty and never as his (§1 rule 4), never red — `.notice` is the
          app's calm panel, which is as far as this app goes. A board he could not read is worth
          offering to ask for again, because a dropped request on Surat mobile data is the
          likeliest reason he is looking at this.
        */}
        {error && !loading && (
          <div className="notice">
            <p>{error}</p>
            <button type="button" className="btn btn-quiet" onClick={retry}>
              ફરી પ્રયત્ન કરો
            </button>
          </div>
        )}

        {/*
          The board is off, and this is the state a project that never switched it on lives in
          for ever. So it is a finished sentence with somewhere to go, not a placeholder and not
          an apology: nothing here failed, there is simply no list, and his own record is exactly
          where it always was.
        */}
        {!loading && !error && !enabled && (
          <p className="lb-quiet">ક્રમાંક હમણાં ખુલ્લું નથી. તમારી રોજની નોંધ "મારી પ્રગતિ" માં દેખાય છે.</p>
        )}

        {!loading && !error && enabled && emptyWindow && (
          <p className="lb-quiet">આ સમયગાળાની યાદી હજી બની નથી. આજે તમે જે કરશો એ અહીં દેખાશે.</p>
        )}

        {!loading && !error && enabled && rows.length > 0 && (
          /*
            An <ol>, because that is what a ranking is. The number is still printed on every row
            rather than left to the list marker: the marker counts positions on screen, and a
            board is capable of holding two યુવકો at the same rank — the row's `rank` is the
            server's answer and the marker would be the browser's guess at it.
          */
          <ol className="lb-list">
            {rows.map((r) => (
              <li
                className={r.isMe ? 'lb-row is-me' : 'lb-row'}
                /*
                  Rank and name together: there is no id on a row by design (§13), so this is the
                  only identity a row has — and it is stable within one rendered board, which is
                  all a key is for.
                */
                key={`${r.rank}-${r.name}`}
              >
                <span className="lb-rank">{gu(r.rank)}</span>
                <span className="lb-name">
                  {r.name}
                  {/* So he finds himself without running a finger down the column. The only
                      emphasis anywhere on this page, and it is on his own row. */}
                  {r.isMe && <span className="lb-you">તમે</span>}
                </span>
                <span className="lb-points">
                  {gu(r.points)}
                  <span className="lb-unit">ગુણ</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {/*
          His own place, when the names above do not include it.

          Pinned at the foot rather than appended to the list, so it reads as "and here is you"
          and not as a row that came last. It carries the same two figures as every row above -
          a rank and a total - and deliberately nothing else: no distance from the name above
          him, no count of who is behind him, and no note about which way it moved.
        */}
        {!loading && !error && enabled && !emptyWindow && board?.me && !meOnBoard && (
          <div className="lb-me">
            <span className="lb-me-label">તમારો ક્રમાંક</span>
            <span className="lb-rank">{gu(board.me.rank)}</span>
            <span className="lb-points">
              {gu(board.me.points)}
              <span className="lb-unit">ગુણ</span>
            </span>
          </div>
        )}

        {/*
          He has earned nothing in this window, so there is no rank to report - which is a
          different thing from being last, and is said in words rather than given a number.

          Phrased forward: what he does today will be here. No count of what he has not done, no
          'હજી શરૂ કર્યું નથી', nothing that reads as an accusation - the same sentence History's
          empty state settled on, for the same reason.
        */}
        {!loading && !error && enabled && !emptyWindow && !board?.me && (
          <p className="lb-quiet">આ સમયગાળામાં તમારી નોંધ હજી થઈ નથી. આજે તમે જે કરશો એ અહીં ઉમેરાશે.</p>
        )}
      </div>
    </div>
  );
}
