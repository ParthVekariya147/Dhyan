import { LEVEL_LABEL, summariseRow, useHistory, usePointSummary } from '../lib/history';
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
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — મારી પ્રગતિ (/history)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Answer one question: what have I done, and when. A record he can look back
 *                over, in the order he lived it.
 *
 * Input          useHistory() — `activity_history`, paged by day; usePointSummary() — the two
 *                figures, already summed by the server. Both are this page's alone (§27: the
 *                home page must not load history), so opening મુખપૃષ્ઠ costs nothing for them.
 * Visible        આજે and કુલ, when there is anything to show; then one block per day, newest
 *                first, each holding that day's activities with their level, their title, what
 *                they came to, and what they were paid.
 * Actions        વધુ જુઓ, and retry after a failure. Nothing on this page writes.
 * Persisted      Nothing at all. This screen is a reader.
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
 *                grows to ૧૦૯.
 * Loading        The app's three dots. A later page loads under the days already on screen,
 *                so pressing વધુ જુઓ never blanks what he was reading.
 * Error / empty  Both quiet, and neither is worded as his doing (§1 rule 4). An error keeps
 *                every day already fetched on screen and offers to ask again.
 * Source of truth  `public.activity_history` and `my_point_summary()` (migration 0021), both
 *                  limited to this યુવક's own rows by RLS. Nothing on this screen is derived
 *                  from anything the phone remembers.
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
  */
  const showPoints = !summaryLoading && (todayPoints > 0 || totalPoints > 0);

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

        {days.map((day) => (
          <section className="hist-day" key={day.date}>
            <h2 className="hist-date">{dayHeading(day.date, today)}</h2>

            <ul className="hist-list">
              {day.rows.map((row) => (
                /*
                  Level and activity_key are unique within a day — that is the ledger's own
                  unique index (points.js), so the key is the row's identity rather than an
                  index into an array that re-sorts.
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
        ))}

        {loading && (
          <div className="spinner-page">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}

        {/*
          Said as the app's difficulty, never as his (§1 rule 4), and never red — `.notice` is
          the app's calm panel and `.notice.warn` its warmer amber, which is as far as this app
          goes. Everything already fetched stays above it, so a failed second page costs him the
          page and not the screen.
        */}
        {error && !loading && (
          <div className="notice">
            <p>{error}</p>
            <button type="button" className="btn btn-quiet" onClick={retry}>
              ફરી પ્રયત્ન કરો
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
