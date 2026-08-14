import { NumberField, OnOffField, RuleCard, controlRow } from './RuleFields';
import { POINT_MAX, TICK_DAILY_CAP_MAX, TICK_MODE } from '../../../../../shared/domain/points.js';

/**
 * Section 5 - Level 3, which is the one level that can be paid three different ways.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The three modes are exclusive, and the form has to say so
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `award_points()` (0031:502) branches on the mode **before** it reaches the flat value:
 *
 *   Per activity   the flat value below, once per business day, however many times he submits.
 *                  This is what the app did before the engine and what an absent `tick` key
 *                  still means.
 *   Per tick       points per દ્રશ્ય newly brought to mind today - the ticks in this submission,
 *                  minus withheld ones, minus every દ્રશ્ય an earlier submission today already
 *                  named. The flat value is **not** paid.
 *   Per revision   points per submission. The flat value is **not** paid.
 *
 * An admin who reads "Level 3: 300" at the top of this card and then chooses Per tick has, from
 * that moment, a Level 3 that pays nothing like 300 - and there is no screen anywhere else that
 * would tell him. So the exclusivity is written on the card in the state it applies to, rather
 * than left to be discovered in a week of unpaid પુનરાવર્તન.
 *
 * The daily cap is the same kind of fact and gets the same treatment: it is read only in per-tick
 * mode (0031:545), so under per-revision it is a box that does nothing and says as much.
 *
 * Two rules the database refuses outright, mirrored by `validatePointRules()` and stated here as
 * hints rather than as a second verdict: per-tick mode needs points per tick above 0, and
 * per-revision mode needs points per revision above 0 (0031:957-967). A mode that pays nothing
 * is a mode that switches Level 3 off while looking configured.
 */

const MODE = {
  ACTIVITY: {
    label: 'Per activity',
    hint: 'The flat value, once a day. This is what an unconfigured system does.',
  },
  TICK: {
    label: 'Per tick',
    hint: 'Points for each scene brought to mind for the first time that day. The flat value is not paid.',
  },
  REVISION: {
    label: 'Per revision',
    hint: 'Points for each submission. The flat value is not paid.',
  },
};

export default function Level3Card({ value, off, storedOff, tick, storedMode, onChange, onTickChange, disabled }) {
  const mode = tick.mode;
  const usingTicks = mode !== 'ACTIVITY';

  return (
    <RuleCard
      id="pts-l3"
      title="Level 3 - Revision"
      badge={storedOff ? 'Switched off' : MODE[storedMode]?.label || storedMode}
      badgeTone={storedOff ? 'off' : 'ok'}
      intro="What a submitted revision is worth. Choose how it is counted first: the three ways are alternatives, never a total."
    >
      <div style={controlRow}>
        <OnOffField
          id="pts-l3-live"
          label="Pay for Level 3"
          checked={!off}
          onChange={(on) => onChange({ off: !on })}
          disabled={disabled}
          onHint="Awarded under whichever rule is chosen below."
          offHint="Off - nothing is awarded for Level 3, under any of the three rules. Every value here is kept."
        />

        <NumberField
          id="pts-l3-value"
          label="Flat value for a day"
          value={value}
          onChange={(v) => onChange({ value: v })}
          disabled={disabled}
          hint={
            usingTicks
              ? 'Not paid while a tick rule is chosen. Kept, and paid again if you go back to Per activity.'
              : 'One submitted revision, once per business day, however many times he submits.'
          }
        />
      </div>

      {/*
        A radio group rather than a select: three options, each of which needs a sentence to
        choose between them, and a select shows one line at a time. `fieldset`/`legend` so the
        three read as one question to a screen reader without any aria being invented for it.
      */}
      <fieldset style={modeBlock}>
        <legend style={legendText}>How Level 3 is counted</legend>
        <div style={modeStack}>
          {Object.values(TICK_MODE).map((m) => (
            <label className="check" key={m} htmlFor={`pts-mode-${m}`} style={modeRow}>
              <input
                id={`pts-mode-${m}`}
                type="radio"
                name="pts-tick-mode"
                value={m}
                checked={mode === m}
                onChange={() => onTickChange({ mode: m })}
                disabled={disabled}
              />
              <span style={modeText}>
                <strong>{MODE[m].label}</strong>
                <span className="hint">{MODE[m].hint}</span>
              </span>
            </label>
          ))}
        </div>

        {usingTicks && (
          <div className="notice notice-warn" role="status">
            <strong>{MODE[mode].label}</strong> is chosen, so the flat value above is not paid at
            all. Level 3 pays only what the boxes below decide, and nothing is added to it.
          </div>
        )}

        <div style={controlRow}>
          <NumberField
            id="pts-per-tick"
            label="Points per tick"
            value={tick.perTick}
            onChange={(v) => onTickChange({ perTick: v })}
            disabled={disabled}
            max={POINT_MAX}
            placeholder="0"
            hint={
              mode === 'TICK'
                ? 'Per scene newly brought to mind today. Must be above 0 in this mode.'
                : 'Used only in Per tick. Kept, and applied if you choose that mode.'
            }
          />
          <NumberField
            id="pts-per-revision"
            label="Points per revision"
            value={tick.perRevision}
            onChange={(v) => onTickChange({ perRevision: v })}
            disabled={disabled}
            max={POINT_MAX}
            placeholder="0"
            hint={
              mode === 'REVISION'
                ? 'Per submission. Must be above 0 in this mode.'
                : 'Used only in Per revision. Kept, and applied if you choose that mode.'
            }
          />
          <NumberField
            id="pts-daily-cap"
            label="Most Level 3 points in a day"
            value={tick.dailyCap}
            onChange={(v) => onTickChange({ dailyCap: v })}
            disabled={disabled}
            max={TICK_DAILY_CAP_MAX}
            placeholder="0"
            hint={
              mode === 'TICK'
                ? '0 means no cap. Counted from the ledger, so two phones cannot spend the same headroom twice.'
                : 'Read only in Per tick. It does nothing under the mode chosen above.'
            }
          />
        </div>
      </fieldset>

      <p className="card-note">
        Every value on this card is a whole number between 0 and{' '}
        <span className="mono">{POINT_MAX}</span> - the ordinary range for an award - except the
        daily cap, which goes up to <span className="mono">{TICK_DAILY_CAP_MAX}</span> because a
        per-tick rule multiplies a small number by however many scenes the collection holds. The
        same bounds are checked in the database, so a value outside them cannot be stored by any
        route.
      </p>
    </RuleCard>
  );
}

/* ------------------------------------------------------------------ layout */

/** The tick block reads as a property of Level 3, not as a fifth level - inset, on the sunken
 *  surface, with the same brand rule the sidebar uses to mark "this belongs to that". */
const modeBlock = {
  marginTop: 'var(--sp-4)',
  marginBottom: 'var(--sp-3)',
  padding: 'var(--sp-4)',
  background: 'var(--surface-sunken)',
  borderInlineStart: '3px solid var(--brand-200)',
  borderRadius: 'var(--r-md)',
  border: 0,
};

const legendText = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-semi)',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  padding: 0,
  marginBottom: 'var(--sp-3)',
};

const modeStack = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' };

/** The radio sits beside a two-line label, so the row aligns at the top rather than centring a
 *  16px control against a paragraph. */
const modeRow = { alignItems: 'flex-start' };

const modeText = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };
