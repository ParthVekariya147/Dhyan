import { SelectField } from './Field';
import { gu } from '../lib/constants';
import { levelKey } from '../lib/dailyRecord';

/**
 * One ladder's row on આજની પ્રગતિ — a figure, or the sittings it is made of.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is a component and not part of the page
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The same row is now drawn in two places: the /daily page a યુવક goes to, and the sheet
 * ક્રમાંક puts in front of him when today has not been written down yet. They are the same
 * question and must be the same control — a dropdown that ran 0..27 on one screen and 0..108 on
 * the other would be two different claims about what the સંચાલક configured.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The sittings, and why any level may have them
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A લેવલ ૩ day is several sittings — morning, after work, at night — and what a યુવક knows at
 * each of those moments is *how many this time*, not the running total. So a level can be split
 * into rows, each with its own count, and the total is their sum.
 *
 * The invitation is offered on **every** level rather than on લેવલ ૩ alone, and that is a
 * deliberate refusal to hardcode. `'video'`, `'darshan'` and `'revision'` are 0021's vocabulary
 * and §62's rule is that a level's shape is the સંચાલક's data rather than this file's opinion —
 * a component that drew a different control for `levelId === 3` would be asserting which ladder
 * is done in sittings, which is a habit of this સંઘ and not a fact about the app. A યુવક who
 * does લેવલ ૨ twice in a day gets the same affordance, and nobody has to ship a release for it.
 *
 * It is also what answers "the system found nothing": a level the app recorded ૦ against still
 * has the link, so he can add the sittings it missed rather than being shown a ૦ he cannot
 * explain.
 */

/** The dropdown's options, `0 … top`. `top` is never a number this file chose — see below. */
const optionRange = (top) => Array.from({ length: top + 1 }, (_, i) => i);

/**
 * What the reserved slot under a level says.
 *
 * A figure above the recorded one is stated as **his own record** beside what the app happened
 * to see — §7's decision that a યુવક may report more than the app observed, because ધ્યાન done
 * away from the phone still happened. It is not a warning, it asks him to justify nothing, and
 * the app's number stays visible because the સંચાલક's report shows both.
 */
export function levelHint(recorded, chosen) {
  return chosen > recorded
    ? `તમારી પોતાની નોંધ - એપ્લિકેશનમાં ${gu(recorded)}`
    : `એપ્લિકેશનમાં નોંધાયું: ${gu(recorded)}`;
}

/** `+૨૦૦`, or `-૫૦`. Zero never reaches this — every caller checks first. See the `+૦` rule. */
const signed = (n) => (n > 0 ? `+${gu(n)}` : gu(n));

/**
 * @param {object} props
 * @param {object} props.level     one entry of `record.levels`
 * @param {object} props.row       `{ value, sessions }` from useDailyDraft().rowFor()
 * @param {object} props.draft     useDailyDraft()'s api — setValue, split, addSession, …
 * @param {string} [props.error]   the validation message for this level, if any
 * @param {boolean} props.disabled saving, or a window that has closed
 */
export default function DailyLevelField({ level: l, row, draft, error, disabled }) {
  const key = levelKey(l);
  const chosen = row.value;

  /*
    A level whose maximum has not arrived gets no control at all.

    §7 says the bound is the સંચાલક's setting and that nothing is hardcoded, so there is no
    range to fall back to — inventing one would silently cap a યુવક at a number nobody chose,
    and would do it invisibly. What the record holds is shown as text instead, with one line
    saying the limit is not set yet. The count is still sent on save, unchanged, so nothing is
    lost by the level being read-only for a while.
  */
  if (l.max === null) {
    return (
      <div className="daily-level is-fixed">
        <p className="daily-fixed-label">{l.label}</p>
        <p className="daily-fixed-value">{gu(chosen)}</p>
        <p className="daily-fixed-note">આ લેવલની મર્યાદા હજી ગોઠવાઈ નથી.</p>
      </div>
    );
  }

  /*
    The ceiling. The સંચાલક's maximum, or the figure already saved when that is the larger —
    which is not a wider range invented here but the record's own number: a maximum lowered
    after a save must not make the screen show a smaller count than the server holds.
  */
  const top = Math.max(l.max, l.reported);

  const name = (
    <>
      <span className="daily-level-name">{l.label}</span>
      {/* The `+૦` rule. A level that earned nothing gets no pill: a zero beside it would read
          as a mark against a day that earned nothing simply because the morning had already
          earned it (§18). */}
      {l.points !== 0 && <span className="daily-level-points">{signed(l.points)}</span>}
    </>
  );

  // ── one figure ────────────────────────────────────────────────────────────
  if (row.sessions === null) {
    return (
      <div className="daily-level">
        <SelectField
          id={`daily-level-${key}`}
          label={name}
          hint={levelHint(l.recorded, chosen)}
          error={error}
          value={String(chosen)}
          onChange={(ev) => {
            // `Number(...)`, never `gu()`. The option's VALUE is the Latin digit string and its
            // TEXT is the Gujarati one; Gujarati numerals are display only and are never a value
            // sent to, compared in or parsed from the database.
            const n = Number(ev.target.value);
            draft.setValue(key, Number.isFinite(n) ? Math.trunc(n) : 0);
          }}
          disabled={disabled}
        >
          {optionRange(top).map((n) => (
            <option key={n} value={String(n)}>
              {gu(n)}
            </option>
          ))}
        </SelectField>

        {!disabled && (
          <button type="button" className="daily-split" onClick={() => draft.split(key)}>
            એક કરતાં વધુ વાર કર્યું?
          </button>
        )}
      </div>
    );
  }

  // ── sittings ──────────────────────────────────────────────────────────────
  return (
    <div className="daily-level is-split">
      <div className="daily-level-head">
        <p className="daily-level-title">{name}</p>
        {/* The day's figure, as it stands, so the sum is on screen while he edits the parts.
            Read from the draft, which the hook keeps equal to the sittings on every keystroke —
            nothing here adds anything up. */}
        <span className="daily-level-total">{gu(chosen)}</span>
      </div>

      <ul className="daily-sessions">
        {row.sessions.map((v, i) => (
          // The index IS the identity here: a sitting has nothing else about it, and the list
          // only ever grows at the end or loses a row the યુવક pointed at. React re-keys the
          // rows after it, which is correct — the fourth sitting becoming the third is exactly
          // what removing the third means.
          // eslint-disable-next-line react/no-array-index-key
          <li className="daily-session" key={i}>
            <SelectField
              id={`daily-level-${key}-${i}`}
              label={`${gu(i + 1)}${i === 0 ? 'લી' : 'જી'} વાર`}
              value={String(v)}
              onChange={(ev) => {
                const n = Number(ev.target.value);
                draft.setSession(key, i, Number.isFinite(n) ? Math.trunc(n) : 0);
              }}
              disabled={disabled}
            >
              {optionRange(top).map((n) => (
                <option key={n} value={String(n)}>
                  {gu(n)}
                </option>
              ))}
            </SelectField>

            {!disabled && (
              <button
                type="button"
                className="daily-session-remove"
                onClick={() => draft.removeSession(key, i)}
                // The row it removes, named — a screen reader reaching a column of identical
                // ✕ buttons is told which one it is on.
                aria-label={`${gu(i + 1)}મી વાર કાઢી નાખો`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* The hint the single-figure control carries, kept here too: what the app recorded is
          about the level and not about any one sitting, and losing it when he splits would take
          away the one number he is checking his own memory against. */}
      <p className="daily-session-hint">{error || levelHint(l.recorded, chosen)}</p>

      {!disabled && (
        <div className="daily-session-actions">
          <button type="button" className="daily-split" onClick={() => draft.addSession(key)}>
            + બીજી વાર ઉમેરો
          </button>
          <button type="button" className="daily-split" onClick={() => draft.unsplit(key)}>
            એક જ આંકડો રાખો
          </button>
        </div>
      )}
    </div>
  );
}
