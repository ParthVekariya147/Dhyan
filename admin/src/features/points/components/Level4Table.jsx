import { NumberField, OnOffField, RuleCard, controlRow } from './RuleFields';
import { StatusBadge } from '../../../components/StatCard';
import { POINT_MAX } from '../../../../../shared/domain/points.js';

/**
 * Section 6 - one row per લેવલ ૪ કસોટી, priced by code.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Where this list comes from, and why it is never written down
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_point_activities()`, which reads the **published** configuration. 4.1 … 4.4 appear
 * nowhere in this panel's source: a 4.5 published next month is a row here on the next load, and
 * a કસોટી that is renamed keeps its price because the price is keyed by `code`.
 *
 * That keying is the whole argument of shared/domain/points.js: `level4_clone_config()` mints new
 * activity uuids on every republication, so a value keyed by id would orphan itself silently and
 * the ledger would go on paying the old number with nothing on any screen able to say which. A
 * code survives republication; an id does not.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Inheriting is a state, not a zero
 * ────────────────────────────────────────────────────────────────────────────
 *
 * An empty price box means the કસોટી has **no value of its own** and is worth the Level 4
 * default. That is deliberately not the same as typing 0, and the difference is the one a
 * સંચાલક cannot see from a number alone: a 0 says "this test is free", where inheriting says
 * "whatever Level 4 is worth". `pointsFor()` falls back to the default for exactly this reason -
 * a new કસોટી nobody has priced yet must not silently become free.
 *
 * So each row says which of the two it is, and clearing a box is how a price is removed. There
 * is no delete button and no confirmation, because nothing is lost: the default is right there.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A price for a કસોટી that is no longer published
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Harmless - the ledger is keyed by code, so a price for a test nobody can sit pays nobody - but
 * it is still shown, at the bottom and marked, because a value nobody can see is a value nobody
 * can remove. The alternative is a stored key that quietly starts paying again the day somebody
 * republishes that code.
 */
export default function Level4Table({
  rows,
  defaultValue,
  repeatEnabled,
  repeatDefault,
  levelOff,
  storedLevelOff,
  onDefaultChange,
  onLevelChange,
  onRowChange,
  activitiesDenied,
  disabled,
}) {
  const retired = rows.filter((r) => !r.inConfig);
  const live = rows.filter((r) => r.inConfig);

  return (
    <RuleCard
      id="pts-l4"
      title="Level 4 - Tests"
      badge={storedLevelOff ? 'Switched off' : 'On'}
      badgeTone={storedLevelOff ? 'off' : 'ok'}
      intro="What each test is worth the first time it is passed on a given day. The list is the published Level 4 configuration - a new test appears here on its own, and none of these codes is written into the panel."
    >
      <div style={controlRow}>
        <OnOffField
          id="pts-l4-live"
          label="Pay for Level 4"
          checked={!levelOff}
          onChange={(on) => onLevelChange({ off: !on })}
          disabled={disabled}
          onHint="Each test below is awarded under its own switch as well as this one."
          offHint="Off - no test awards anything, whatever its own switch says. Every price is kept."
        />

        <NumberField
          id="pts-l4-default"
          label="Level 4 default"
          value={defaultValue}
          onChange={onDefaultChange}
          disabled={disabled}
          hint="What a test with no price of its own is worth. This value is always stored."
        />
      </div>

      {activitiesDenied ? (
        /*
          The list could not be read, and the prices still can. `admin_point_activities()` asserts
          a progress reader - `progress.read` and `users.read` - which a settings-only role does
          not hold, and it raises rather than answering with an empty list. Printing "no tests"
          here would be this panel stating something untrue about the configuration, so it says
          which of the two happened.
        */
        <div className="notice notice-warn" role="status">
          The list of tests could not be read: it needs the <strong>progress.read</strong> and{' '}
          <strong>users.read</strong> permissions, which this role does not hold. Any price already
          stored is shown below and can still be changed.
        </div>
      ) : (
        <p className="card-note" style={listNote}>
          Leave a price empty to use the Level 4 default. An empty box and a typed 0 are different
          things: 0 means the test is free, empty means it is worth whatever Level 4 is worth.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="card-note">
          No test is published yet, so there is nothing to price. The default above still applies
          to every test that appears later.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dt p4-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Test</th>
                <th scope="col">First award</th>
                <th scope="col">Repeat</th>
                <th scope="col">Points on</th>
              </tr>
            </thead>
            <tbody>
              {[...live, ...retired].map((r) => (
                <ActivityRow
                  key={r.code}
                  row={r}
                  defaultValue={defaultValue}
                  repeatEnabled={repeatEnabled}
                  repeatDefault={repeatDefault}
                  onChange={(patch) => onRowChange(r.code, patch)}
                  disabled={disabled}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="card-note">
        Every price is a whole number between 0 and <span className="mono">{POINT_MAX}</span>, and
        the same range is checked in the database. A test pays its first award at most once per
        business day; a further pass on the same day is priced by the repeat rules below, and only
        while those are switched on.
      </p>
    </RuleCard>
  );
}

/**
 * One કસોટી.
 *
 * The two prices are the same shape and mean different things, so each carries what it falls back
 * to rather than a shared note at the bottom of the table - by the time somebody has scrolled to
 * a note he has stopped reading it.
 */
function ActivityRow({ row, defaultValue, repeatEnabled, repeatDefault, onChange, disabled }) {
  const inheritsFirst = row.value === '';
  const inheritsRepeat = row.repeat === '';

  return (
    <tr>
      <td className="mono">{row.code}</td>
      <td>
        <span style={titleCell}>
          <span>{row.title || '-'}</span>
          <span style={badgeRow}>
            {/* Whether the કસોટી is offered to a યુવક at all is a different question from whether
                its points are on, and both belong on the row: a price on a test nobody can sit is
                not an error, but it is worth being able to see. */}
            {!row.inConfig && <StatusBadge tone="warn">Not in the published configuration</StatusBadge>}
            {row.inConfig && !row.active && <StatusBadge tone="off">Test inactive</StatusBadge>}
          </span>
        </span>
      </td>
      <td>
        <NumberField
          id={`p4-first-${row.code}`}
          ariaLabel={`First award for ${row.code}`}
          value={row.value}
          onChange={(v) => onChange({ value: v })}
          disabled={disabled}
          compact
          placeholder={defaultValue === '' ? 'default' : defaultValue}
          hint={inheritsFirst ? 'Using the Level 4 default' : 'Priced on its own'}
        />
      </td>
      <td>
        <NumberField
          id={`p4-repeat-${row.code}`}
          ariaLabel={`Repeat award for ${row.code}`}
          value={row.repeat}
          onChange={(v) => onChange({ repeat: v })}
          disabled={disabled}
          max={POINT_MAX}
          compact
          placeholder={repeatDefault === '' ? 'default' : repeatDefault}
          hint={
            !repeatEnabled
              ? 'Repeat awards are off'
              : inheritsRepeat
                ? 'Using the repeat default'
                : 'Priced on its own'
          }
        />
      </td>
      <td>
        {/* Per-activity on/off is membership of the `disabled` list, stored as the code itself.
            Switching one test off keeps both its prices exactly where they are. */}
        <label className="check" htmlFor={`p4-on-${row.code}`}>
          <input
            id={`p4-on-${row.code}`}
            type="checkbox"
            checked={!row.off}
            onChange={(e) => onChange({ off: !e.target.checked })}
            disabled={disabled}
          />
          <span className="sr-only">Award points for {row.code}</span>
          <span aria-hidden="true">{row.off ? 'Off' : 'On'}</span>
        </label>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ layout */

const listNote = { marginTop: 0, marginBottom: 'var(--sp-3)' };

const titleCell = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };

const badgeRow = { display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' };
