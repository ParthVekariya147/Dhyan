import { NumberField, OnOffField, RuleCard, controlRow } from './RuleFields';
import { POINT_MAX, REPEAT_DAILY_LIMIT_MAX } from '../../../../../shared/domain/points.js';

/**
 * Section 7 - what a second pass of the same કસોટી on the same day is worth.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Exactly what this changes, stated in the words the engine uses
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `award_points()` reaches the repeat branch only after the day-scoped award has written
 * **nothing** (0031:579) - either the day's first award for that કસોટી is already in the ledger,
 * or the test is worth nothing. So this is not a second payment on top of the first; it is what
 * the second and every later pass of a day is worth, where today that is zero.
 *
 * લેવલ ૪ only, and the code says why: sitting the કસોટી again is the act the સંચાલક asked to be
 * able to price. A second દર્શન in one day is a different question and is left alone.
 *
 * The daily limit counts **repeat awards**, not attempts and not tests: at most this many repeat
 * rows for one યુવક on one business day, across every કસોટી together. It is counted from the
 * ledger inside the award, so two phones cannot spend the same allowance twice. 0 means no limit,
 * which is what an unconfigured system already means.
 *
 * A repeat price of 0 pays nothing at all - the ledger never stores a zero row, because a rule
 * worth 0 has not paid a યુવક 0, it has not paid him.
 */
export default function RepeatCard({ enabled, defaultValue, dailyLimit, storedEnabled, onChange, disabled }) {
  return (
    <RuleCard
      id="pts-repeat"
      title="Repeat awards"
      badge={storedEnabled ? 'On' : 'Off'}
      badgeTone={storedEnabled ? 'ok' : 'off'}
      intro="Repeat pricing applies to Level 4 re-attempts: what a test is worth when a yuvak passes it again on a day it has already paid him. It changes nothing about the first award, and nothing about Levels 1, 2 and 3."
    >
      <div style={controlRow}>
        <OnOffField
          id="pts-repeat-on"
          label="Pay for a repeat attempt"
          checked={enabled}
          onChange={(v) => onChange({ enabled: v })}
          disabled={disabled}
          onHint="A further pass on the same day is worth the price below."
          offHint="Off - a test pays once a business day and a further pass is worth nothing. This is what the app did before."
        />

        <NumberField
          id="pts-repeat-default"
          label="Repeat default"
          value={defaultValue}
          onChange={(v) => onChange({ default: v })}
          disabled={disabled}
          max={POINT_MAX}
          placeholder="0"
          hint="What a repeat is worth for a test with no repeat price of its own. 0 pays nothing."
        />

        <NumberField
          id="pts-repeat-limit"
          label="Most repeats a day"
          value={dailyLimit}
          onChange={(v) => onChange({ dailyLimit: v })}
          disabled={disabled}
          max={REPEAT_DAILY_LIMIT_MAX}
          placeholder="0"
          hint="How many repeat awards one yuvak may earn in a day, counting every test together. 0 means no limit."
        />
      </div>

      <p className="card-note">
        Repeat prices are whole numbers between 0 and <span className="mono">{POINT_MAX}</span>,
        and the limit between 0 and <span className="mono">{REPEAT_DAILY_LIMIT_MAX}</span>. Per-test
        repeat prices are set in the Level 4 table above, on the same row as the first award.
      </p>
    </RuleCard>
  );
}
