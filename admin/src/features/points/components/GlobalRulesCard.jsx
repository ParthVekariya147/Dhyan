import { NumberField, OnOffField, RuleCard, controlRow } from './RuleFields';
import { RULE_VERSION_MAX } from '../../../../../shared/domain/points.js';

/**
 * Section 2 - the master switch, the rule version, and the day the rules start applying.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What each of the three actually does
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   **Award points.** `enabled: false` is worth 0 everywhere, not "keep the values but pause
 *   Level 3": `pointsFor()` returns 0 for every level before it looks at any value, and the SQL
 *   mirrors it. So this is the one switch that stops the system, and the four levels' values stay
 *   where they are while it is off - which is why the boxes below are still readable.
 *
 *   **Version.** Stamped onto every new transaction as `rule_version` and never used to decide
 *   an amount. It is there so that a ledger row can be read back against the rules that were in
 *   force when it was written: raise it when the meaning of the rules changes, and every row
 *   after that is distinguishable from every row before. Nothing recalculates when it moves.
 *
 *   **Start date.** A day, or nothing. An award for a business day *before* this date is not
 *   made at all - `point_rule_live()` compares the attempt's own day, not today, so backdating
 *   it does not retrospectively pay anybody and setting it forward stops awards until then.
 *   Empty means "in force since forever", which is also what the field's absence means.
 *
 * None of the three reaches backwards. The ledger stores the number that was paid rather than a
 * pointer to the rule that decided it, so nothing on this card can change what anybody has
 * already earned (§1 rule 4).
 */
export default function GlobalRulesCard({ enabled, version, effectiveFrom, storedEnabled, onChange, disabled }) {
  return (
    <RuleCard
      id="pts-global"
      title="Points system"
      badge={storedEnabled ? 'On' : 'Off'}
      badgeTone={storedEnabled ? 'ok' : 'off'}
      intro="The master switch, and the two facts every award is stamped against. The badge shows what is stored right now, not what is typed below."
    >
      <div style={controlRow}>
        <OnOffField
          id="pts-enabled"
          label="Award points"
          checked={enabled}
          onChange={(v) => onChange({ enabled: v })}
          disabled={disabled}
          onHint="Every value on this page is paid as it is set."
          offHint="Off - every activity is worth 0, whatever the values below say."
        />
      </div>

      <div style={controlRow}>
        <NumberField
          id="pts-version"
          label="Rule version"
          value={version}
          onChange={(v) => onChange({ version: v })}
          disabled={disabled}
          min={0}
          /*
            int4's ceiling, and all three layers now hold it.

            This box was once the only guard. `settings_check_points()` stated no upper bound
            while `point_rules()` cast the value with `::integer`, so a number above int4 stored
            happily and then made every subsequent read of the rules raise - which is every award
            path in the app, for everybody, from one number typed into one field. 0031 now states
            the bound and `validatePointRules()` mirrors it, so a save is refused with a sentence
            naming the ceiling even if this attribute is bypassed. The attribute stays because
            being told before typing is better than being told after saving.
          */
          max={RULE_VERSION_MAX}
          placeholder="0"
          hint="Stamped on each new transaction so a row can be read against the rules of its day. It never changes an amount. Leave it empty to store no version at all."
        />

        {/* A real date input rather than a text box: the stored value is a plain YYYY-MM-DD and
            the browser's own picker is the only thing that produces one without a parser. */}
        <div className="field" style={dateField}>
          <label htmlFor="pts-from">Rules start on</label>
          <input
            id="pts-from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => onChange({ effectiveFrom: e.target.value })}
            disabled={disabled}
            aria-describedby="pts-from-help"
          />
          <span className="hint" id="pts-from-help">
            Awards for days before this are not made. Leave it empty for "in force since forever".
            The day compared is the day the work was done, in India time - not today.
          </span>
        </div>
      </div>
    </RuleCard>
  );
}

/** Wide enough for a date picker's own control, which is wider than a number box. */
const dateField = { marginBottom: 'var(--sp-3)', flex: '0 1 230px' };
