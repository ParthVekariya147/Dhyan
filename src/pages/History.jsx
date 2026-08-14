import { useState } from 'react';
import {
  LEVEL_LABEL,
  awardNote,
  summariseRow,
  useHistory,
  usePointLedger,
  usePointSummary,
  usePointTotals,
} from '../lib/history';
import { gu } from '../lib/constants';
import { todayIST } from '../lib/daily';
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
import './history.css';

/**
 * The twelve months, in Gujarati.
 *
 * Local, and deliberately not `Intl.DateTimeFormat('gu-IN')`. The Gujarati locale data is not
 * on every Android in this zone — a phone without it falls back to English month names, so the
 * one screen a યુવક reads most often would say "13 August" on his handset and "૧૩ ઓગસ્ટ" on
 * the reviewer's, and nothing in a test would catch it. Twelve words cost less than that risk.
 *
 * Not in shared/domain/history.js for the reason Profile.jsx's `zoneName()` gives: a helper
 * with one caller belongs beside its caller. It moves down there the day the સંચાલક panel
 * needs to print a Gujarati month too.
 */
const GU_MONTHS = [
  'જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન',
  'જુલાઈ', 'ઓગસ્ટ', 'સપ્ટેમ્બર', 'ઓક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર',
];

/**
 * `2026-08-13` → `આજે`, `૧૩ ઓગસ્ટ`, or `૧૩ ઓગસ્ટ ૨૦૨૫`.
 *
 * Split on the string rather than passed through `new Date()`, which is the whole reason this
 * is four lines and not one: `new Date('2026-08-13')` is parsed as **UTC midnight** and then
 * read back in the device's zone, so a phone anywhere west of Greenwich renders every day of
 * this yuvak's history as the day before. The date is already the IST calendar date the server
 * recorded (src/lib/daily.js) and there is nothing to convert — only to read.
 *
 * The year appears only when the day is not in the current one. Printing it always would put a
 * four-digit number on every heading for the sake of the two days a year it disambiguates;
 * omitting it always would show `૧૩ ઓગસ્ટ` twice, a year apart, with no way to tell which.
 *
 * `આજે` and not today's date, because that is how he would say it — and it is the answer to
 * the question he opened this page with. There is no `ગઈકાલે` beside it on purpose: one
 * relative word is a shortcut, two are a small vocabulary the eye has to translate back into
 * dates while scanning a column of them.
 */
function dayHeading(iso, today) {
  if (iso === today) return 'આજે';

  const [y, m, d] = iso.split('-').map(Number);
  const month = GU_MONTHS[m - 1] ?? '';
  const thisYear = Number(today.slice(0, 4));

  return y === thisYear ? `${gu(d)} ${month}` : `${gu(d)} ${month} ${gu(y)}`;
}

/**
 * `+૨૦૦`, or `-૫૦` — a payment with its direction on it.
 *
 * The plus is not decoration: this column is read down, and a row of bare numbers among which
 * one is a correction the સંચાલક made would be indistinguishable from the rest. A minus is
 * allowed to appear, and appears in the same ink as everything else — the app has nothing red
 * in it, and a deduction is a fact about the ledger rather than a mark against him.
 *
 * **Zero never reaches this function.** Every caller checks first; see the `+૦` note on the
 * day rows, which is the same rule and the same reason.
 */
function signed(n) {
  return n > 0 ? `+${gu(n)}` : gu(n);
}

/**
 * The quiet second line of a payment: when it happened, and what it was for.
 *
 * Assembled from the parts that have something to say and joined with `·`, so a row that has
 * only its date shows only its date rather than a separator hanging off the end. A bonus is
 * **not** in here — it gets a pill of its own with its rule's name, because "legible as a
 * bonus" is not something a fourth clause in a grey line achieves.
 *
 * `પ્રયાસ ૩` appears from the second attempt on. It is the ledger's own attempt_number and it
 * is what makes two payments for one કસોટી on one day tell themselves apart; it is worded as a
 * count of what he did, never as a count of what went wrong (§1 rule 4), and it is absent on
 * the first attempt because `પ્રયાસ ૧` on nearly every row is furniture.
 */
function txMeta(tx, today) {
  return [
    dayHeading(tx.activityDate, today),
    tx.attemptNumber > 1 ? `પ્રયાસ ${gu(tx.attemptNumber)}` : '',
    // '' for DAY_FIRST, for BONUS, and — through the same expression, which is the point — for
    // a legacy row whose award_kind is null. See AWARD_NOTE in src/lib/history.js.
    awardNote(tx),
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ────────────────────────────────────────────────────────────────────────────
   The pieces both views share
   ──────────────────────────────────────────────────────────────────────────── */

/** The app's three dots. forms.css owns them; history.css only takes the 70dvh back off. */
function Dots() {
  return (
    <div className="spinner-page">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}

/**
 * A difficulty, said as the app's and never as his (§1 rule 4), with the way out attached.
 *
 * `.notice` is the app's calm panel and `.notice.warn` its warmer amber, which is as far as
 * this app goes — nothing on this screen is red. Whatever was already fetched stays above it,
 * so a failed second page costs him the page and not the screen, and `onRetry` re-asks for
 * exactly the page that failed rather than starting the list again.
 */
function Notice({ text, onRetry }) {
  return (
    <div className="notice">
      <p>{text}</p>
      <button type="button" className="btn btn-quiet" onClick={onRetry}>
        ફરી પ્રયત્ન કરો
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   દિવસ પ્રમાણે — what he did, and when
   ──────────────────────────────────────────────────────────────────────────── */

function DayList({ days, today }) {
  return days.map((day) => (
    <section className="hist-day" key={day.date}>
      <h2 className="hist-date">{dayHeading(day.date, today)}</h2>

      <ul className="hist-list">
        {day.rows.map((row) => (
          /*
            Level and activity_key are unique within a day — that is the *view's* grain, one row
            per (યુવક, day, level, activity), so the key is the row's identity rather than an
            index into an array that re-sorts. It stays true now that a day can hold several
            payments for one activity: `activity_history.points` sums them onto this single row
            (0033), which is why nothing here adds anything up and why the figure below is the
            day's and not one award's.
          */
          <li className="hist-row" key={`${day.date}-${row.levelId}-${row.activityKey}`}>
            <div className="hist-row-main">
              <span className="hist-level">{LEVEL_LABEL[row.levelId]}</span>
              {/* લેવલ ૪ carries the કસોટી's own name; the other three fall back to the
                  fixed label, which normaliseHistoryRow() has already applied. Rendered
                  only when it says something the level label does not. */}
              {row.title && row.title !== LEVEL_LABEL[row.levelId] && (
                <span className="hist-title">{row.title}</span>
              )}
            </div>

            <div className="hist-row-side">
              {/* `summariseRow()` takes the digit renderer as an argument — one figure,
                  three cases, decided in shared/domain/history.js and never here. */}
              <span className="hist-figure">{summariseRow(row, gu)}</span>
              {/* Only when the day actually paid for it. A `+૦` beside an activity he
                  completed would read as a mark against a day that earned nothing simply
                  because it had already been earned this morning (§18). */}
              {row.points > 0 && <span className="hist-points-row">+{gu(row.points)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  ));
}

/* ────────────────────────────────────────────────────────────────────────────
   ગુણ પ્રમાણે — what he was paid, and for what
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The levels he has earned on, and the sum under them.
 *
 * Three refusals, and each is the `+૦` rule arriving from a different side:
 *
 *   * **a level he has never earned on has no line.** `૦` beside લેવલ ૪ is not information, it
 *     is a remark about a કસોટી he has not sat yet, and this screen does not remark on what a
 *     યુવક has not done.
 *   * **a level with no bonus has no bonus line.** The split appears only when the two halves
 *     are actually different numbers; `આધાર ૧૨૦૦ · બોનસ +૦` under a total of ૧૨૦૦ is the same
 *     figure said three times, two of which are noise and one of which is a zero.
 *   * **nothing here is a comparison.** No share of the total, no "highest level", no percent.
 *
 * Every number arrives from `my_point_totals()` already summed off `point_transactions`. There
 * is no arithmetic in this component at all, which is the property that makes it impossible for
 * the grand total to drift away from the ledger it claims to describe.
 */
function LevelTotals({ levels, total }) {
  // A level whose total came to zero. See the first refusal above.
  const rows = levels.filter((l) => l.total !== 0);
  if (!rows.length) return null;

  return (
    <section className="hist-totals">
      <h2 className="hist-head">લેવલ પ્રમાણે</h2>

      <ul className="hist-list">
        {rows.map((l) => (
          <li className="hist-tot" key={l.levelId}>
            <div className="hist-tot-main">
              {/* A payment that belongs to no ladder — a સંચાલક's correction, a project-wide
                  milestone — still has to be somewhere, or the lines would not add to the sum
                  beneath them. `બીજું` is what it is called, without explaining itself. */}
              <span className="hist-level">{LEVEL_LABEL[l.levelId] ?? 'બીજું'}</span>
              {l.bonus !== 0 && (
                <span className="hist-title">
                  આધાર {gu(l.base)} · બોનસ {signed(l.bonus)}
                </span>
              )}
            </div>
            <span className="hist-tot-value">{gu(l.total)}</span>
          </li>
        ))}
      </ul>

      <div className="hist-grand">
        <span className="hist-level">કુલ</span>
        <span className="hist-grand-value">{gu(total)}</span>
      </div>
    </section>
  );
}

/**
 * The ledger itself: one line per payment, newest first.
 *
 * A flat statement and not a second set of day headings. The day view above already groups by
 * date and this is the other reading of the same facts — the question is "what was I paid, and
 * for what", which is answered by a column of payments with their dates on them, the way a
 * passbook answers it. Re-grouping would draw the same fourteen headings twice on one screen
 * and would make the one thing this view exists to show — three payments against one activity
 * on one day — look like the day view again.
 */
function TxList({ rows, today }) {
  return (
    <ul className="hist-list">
      {rows.map((tx, i) => (
        /*
          The transaction id when the function returns one, which is the row's real identity.
          The fallback carries `i` because this list only ever *appends* — વધુ જુઓ adds older
          payments to the end and nothing re-sorts — so an index is stable here in a way it
          would not be in a list that changed order.
        */
        <li className="hist-tx" key={tx.id ?? `${tx.activityDate}-${tx.activityKey}-${i}`}>
          <div className="hist-tx-main">
            <span className="hist-level">{LEVEL_LABEL[tx.levelId] ?? 'બીજું'}</span>
            {tx.title && tx.title !== LEVEL_LABEL[tx.levelId] && (
              <span className="hist-title">{tx.title}</span>
            )}
            <span className="hist-tx-meta">{txMeta(tx, today)}</span>

            {/*
              A bonus, said as one. The rule's own name is the whole point — `૫ દર્શન પૂરાં -
              બોનસ` tells him what he crossed, where a lone `+૩૦૦` among forty other numbers
              tells him nothing and reads as an accounting error. A rule whose name did not
              arrive still gets the pill: that it was a bonus is the fact worth keeping.
            */}
            {tx.isBonus && (
              <span className="hist-tx-bonus">
                {tx.bonusRule ? `${tx.bonusRule} - બોનસ` : 'બોનસ'}
              </span>
            )}
          </div>

          {/* The `+૦` rule again. A ledger row of nothing is not a payment, and a pill saying
              so would be the same misleading zero the day rows refuse. */}
          {tx.points !== 0 && (
            <span className="hist-points-row">{signed(tx.points)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   The page
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The two readings, and what the tabs call them.
 *
 * `days` is the default and stays the default: it is what this page has always been, and it is
 * the question a યુવક opens it with. ગુણ પ્રમાણે is the follow-up, and a follow-up is not
 * something to be landed on.
 */
const VIEW_DAYS = 'days';
const VIEW_POINTS = 'points';
const VIEW_LABEL = Object.freeze({
  [VIEW_DAYS]: 'દિવસ પ્રમાણે',
  [VIEW_POINTS]: 'ગુણ પ્રમાણે',
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — મારી પ્રગતિ (/history)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Answer two questions a યુવક asks in that order: **what have I done, and
 *                when** — a record he can look back over, in the order he lived it — and then
 *                **where did my ગુણ come from**, which since the bonus engine the first
 *                question no longer answers.
 *
 * Input          useHistory() — `activity_history`, paged by day; usePointSummary() — the two
 *                figures, already summed by the server. Both are this page's alone (§27: the
 *                home page must not load history), so opening મુખપૃષ્ઠ costs nothing for them.
 *                Behind the ગુણ પ્રમાણે tab and **not fetched until it is tapped**:
 *                usePointTotals() — `my_point_totals()`, per level and grand — and
 *                usePointLedger() — `my_point_history()`, a page of transactions.
 * Visible        આજે and કુલ, when there is anything to show. Then, when he has ever been paid,
 *                two tabs:
 *                  દિવસ પ્રમાણે (the default) — one block per day, newest first, each holding
 *                    that day's activities with their level, their title, what they came to,
 *                    and what the day paid for them.
 *                  ગુણ પ્રમાણે — every level he has earned on with its total, its base and
 *                    bonus split where there is a bonus, and the grand total under them; then
 *                    the ledger itself, one row per payment, newest first, each naming its
 *                    level, its date, its attempt when there was more than one, and — for a
 *                    milestone award — the rule's own name in a બોનસ pill.
 * Actions        The two tabs, વધુ જુઓ on either list, and retry after a failure. Nothing on
 *                this page writes.
 * Persisted      Nothing at all, not even which tab he was on. This screen is a reader.
 * Completion     None. મારી પ્રગતિ is not a level and nothing here is finished.
 * Next           Nowhere. It is a leaf; the bottom bar is how a યુવક leaves it.
 * Previous       Whatever he was on. No back link, for the same reason મારું has none.
 * Excluded       **Streaks** (§10) — not a consecutive day is counted anywhere on this screen
 *                or in the module behind it. **A ક્રમાંક or any comparison with another યુવક.**
 *                **Anything red, and any word for a day he did not come.** A day with nothing
 *                on it does not appear, because emptiness is not a mark against him; the list
 *                is what he did, never what he skipped. And **no total of દ્રશ્યો is written
 *                here** (§62) — `૮૨ / ૧૦૮` comes off the row, recorded at the moment of the
 *                attempt, which is why an old day keeps reading ૧૦૮ after the collection
 *                grows to ૧૦૯. **No `+૦` and no `૦` level**: a level he has not earned on has
 *                no line, a level with no bonus has no bonus line, and an unpaid activity has
 *                no pill — a zero would read as a mark against a day that earned nothing
 *                simply because the morning had already earned it (§18).
 * Loading        The app's three dots. A later page loads under what is already on screen, so
 *                pressing વધુ જુઓ never blanks what he was reading. The ગુણ tab's first tap is
 *                the one place the dots appear on their own, and only there.
 * Error / empty  Both quiet, and neither is worded as his doing (§1 rule 4). An error keeps
 *                everything already fetched on screen and offers to ask again. If 0033's two
 *                functions are not migrated, the ગુણ tab says `નોંધ હમણાં ખૂલી નથી` and the
 *                day list — the default tab — is untouched.
 * Source of truth  `public.activity_history` and `my_point_summary()` (0021), and
 *                  `my_point_history()` / `my_point_totals()` (0033), all four limited to this
 *                  યુવક's own rows by the server. **Every figure in the ગુણ tab is computed
 *                  from `point_transactions` by those functions** — there is no stored total
 *                  anywhere in this page and none may be introduced, because a second copy of
 *                  a lifetime figure is a copy that will one day disagree with the ledger and
 *                  be believed. Nothing on this screen is derived from anything the phone
 *                  remembers.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the second view is a tab, and not detail under each day
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The obvious alternative was to let a day expand into the payments that made up its figure.
 * Two things rule it out. First, **the level totals have no day to live in** — they are sums
 * across his whole history, so they would need a home of their own on the page anyway, and
 * having built that home there is no reason for the transactions to live somewhere else.
 * Second, a disclosure control on fourteen day headings is fourteen new tap targets on a
 * 320px screen, each hiding one or two lines, and the thing he came to see would be reachable
 * only by opening the days one at a time and reading across them.
 *
 * A tab is one control, and it buys the whole second view its own full-width column. It also
 * keeps the default cost of this page exactly what it was: `active: false` means neither new
 * function is called until he taps, so a યુવક who only ever reads his days pays for nothing
 * else — the same argument as §27, applied inside a route rather than across two.
 *
 * The tabs appear only when `showPoints` does, and on purpose. That flag already means "he has
 * been paid at least once", it is answered by a call this page makes anyway, and a tab leading
 * to an empty panel on a project that never switched points on would be the same permanent
 * piece of furniture the band is suppressed to avoid.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why વધુ જુઓ is a button and not an infinite scroll
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Because the next page costs him data he is paying for. Infinite scroll spends it on his
 * behalf whenever a thumb travels a little too far — on a Surat connection that is a second of
 * stalled scrolling for a fortnight he did not ask to see. A button is the same fetch, made a
 * decision: he reads the two weeks, and asks for the next two if he wants them.
 */
export default function History() {
  const { loading, error, days, hasMore, loadMore, retry } = useHistory();
  const { today: todayPoints, total: totalPoints, loading: summaryLoading } = usePointSummary();
  const today = todayIST();

  /*
    The band is drawn only when there is a number in it.

    Points are off by default (DEFAULT_POINTS: `enabled: false`), and on a project that never
    switched them on `my_point_summary` answers zero honestly for every યુવક forever. A
    scoreboard reading `આજે +૦ / કુલ ૦` at the top of every visit would be a permanent piece of
    furniture announcing a system nobody is running. It is also what an unreadable summary looks
    like — usePointSummary() never reports an error, by design — so the same rule covers both.

    It is the tabs' condition too: a યુવક who has never been paid has nothing for the second
    reading to show, and the same zero that suppresses the band suppresses the way to it.
  */
  const showPoints = !summaryLoading && (todayPoints > 0 || totalPoints > 0);

  /*
    Which reading is on screen. Component state and nothing more — not the URL, not
    localStorage. It is a way of looking at one page rather than a place, so there is nothing
    here worth linking to or worth remembering into his next visit; §21's "no duplicate progress
    systems" applies to a remembered tab as much as to a remembered total, and every extra
    persisted thing is another that can be restored wrong.

    `&& showPoints` is not belt-and-braces. The summary re-reads when the signed-in યુવક
    changes, so the tabs can vanish under a યુવક who is standing on the second one — and without
    this he would be left looking at a panel with no control on the page to leave it by.
  */
  const [view, setView] = useState(VIEW_DAYS);
  const onPoints = view === VIEW_POINTS && showPoints;

  /*
    Neither of 0033's functions is called until he taps ગુણ પ્રમાણે — see the tab note in the
    contract above. The hooks are still mounted unconditionally, because hooks cannot be
    skipped; `active` is what decides whether they fetch, and once true it latches so tapping
    back and forth costs nothing.
  */
  const totals = usePointTotals({ active: onPoints });
  const ledger = usePointLedger({ active: onPoints });

  /*
    One notice for the ગુણ tab, not two.

    The totals and the ledger are two calls against the same ledger and they fail together far
    more often than separately — an unmigrated 0033 fails both — so surfacing each would print
    the same quiet sentence twice under one heading, which reads as two things having gone wrong
    rather than one. Retry re-asks for both, since either may be the one that failed.
  */
  const pointsError = totals.error ?? ledger.error;
  const pointsRetry = () => {
    totals.retry();
    ledger.retry();
  };
  const pointsLoading = totals.loading || ledger.loading;

  return (
    <div className="hist-wrap">
      <header className="site-header">
        <h1>મારી પ્રગતિ</h1>
        <div className="rule" />
      </header>

      <div className="hist-inner">
        {showPoints && (
          <div className="hist-points">
            <div className="hist-point">
              <span className="hist-point-label">આજે</span>
              <span className="hist-point-value">+{gu(todayPoints)}</span>
            </div>
            <div className="hist-point">
              <span className="hist-point-label">કુલ</span>
              <span className="hist-point-value">{gu(totalPoints)}</span>
            </div>
          </div>
        )}

        {showPoints && (
          /*
            Plain buttons with `aria-pressed`, not a role="tablist" — the same choice
            Leaderboard.jsx makes and for the reason it states there: a real tablist owes a
            screen reader arrow-key navigation between the tabs and a labelled panel, and a
            half-built one tells assistive software something untrue. Two buttons that say
            whether they are on is the whole of what this control is.
          */
          <div className="hist-tabs">
            {[VIEW_DAYS, VIEW_POINTS].map((v) => (
              <button
                key={v}
                type="button"
                className={v === view ? 'hist-tab is-on' : 'hist-tab'}
                aria-pressed={v === view}
                onClick={() => setView(v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        )}

        {!onPoints && (
          <>
            <DayList days={days} today={today} />

            {loading && <Dots />}
            {error && !loading && <Notice text={error} onRetry={retry} />}

            {!loading && !error && days.length === 0 && (
              /*
                Nothing recorded yet. Phrased forward: what he does today will be here, which is
                true and is not a remark about what he has not done. No count of missing days, no
                'હજી શરૂ કર્યું નથી', nothing that reads as an accusation - reportService.js's tone
                rules and §1 rule 4 both land on the same sentence.
              */
              <p className="hist-empty">હજી કંઈ નોંધાયું નથી. આજે તમે જે કરશો એ અહીં દેખાશે.</p>
            )}

            {hasMore && !loading && (
              <button type="button" className="btn btn-quiet hist-more" onClick={loadMore}>
                વધુ જુઓ
              </button>
            )}
          </>
        )}

        {onPoints && (
          <>
            <LevelTotals levels={totals.levels} total={totals.total} />

            {ledger.rows.length > 0 && (
              <section className="hist-day">
                <h2 className="hist-head">ક્યાંથી મળ્યા</h2>
                <TxList rows={ledger.rows} today={today} />
              </section>
            )}

            {pointsLoading && <Dots />}
            {pointsError && !pointsLoading && (
              <Notice text={pointsError} onRetry={pointsRetry} />
            )}

            {!pointsLoading && !pointsError && !ledger.rows.length && !totals.levels.length && (
              /*
                He got here because the band said he had been paid, and the ledger came back
                with nothing to show for it — which in practice means the two figures and the
                transactions disagree, and this screen is not the place to say so. Same forward
                phrasing as the day list's empty state, for the same reason.
              */
              <p className="hist-empty">હજી ગુણની નોંધ નથી. આજે તમે જે કરશો એ અહીં દેખાશે.</p>
            )}

            {ledger.hasMore && !pointsLoading && (
              <button type="button" className="btn btn-quiet hist-more" onClick={ledger.loadMore}>
                વધુ જુઓ
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
