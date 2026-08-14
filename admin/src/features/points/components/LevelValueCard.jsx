import { NumberField, OnOffField, RuleCard, controlRow } from './RuleFields';

/**
 * Sections 3 and 4 - one fixed level, its value and its own on/off.
 *
 * One component for both because they are the same rule with a different word in it: a level
 * with exactly one activity key, worth a flat amount, paid at most once per business day. Level
 * 3 is not here (it has the tick block) and neither is Level 4 (its values are a table built
 * from the published configuration).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The on/off is not a second `enabled`, and it is not a zero
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Switching a level off is membership of the `disabled` list, stored as the token `level1` or
 * `level2`. `point_rule_live()` reads it before anything else and returns nothing at all for the
 * award - so the value in the box is kept, untouched, and comes back the moment the level is
 * switched on again.
 *
 * That is the whole reason it is a switch rather than "set it to 0". A 0 and a switched-off level
 * both pay nothing today, but a 0 is a decision about *what the level is worth* and cannot be
 * undone without remembering what the number used to be. This lets a સંચાલક stop paying for a
 * level for a fortnight without retyping anything afterwards.
 */
export default function LevelValueCard({
  id,
  levelId,
  title,
  intro,
  valueLabel,
  valueHint,
  value,
  off,
  storedOff,
  onChange,
  disabled,
}) {
  return (
    <RuleCard
      id={id}
      title={title}
      badge={storedOff ? 'Switched off' : 'On'}
      badgeTone={storedOff ? 'off' : 'ok'}
      intro={intro}
    >
      <div style={controlRow}>
        <OnOffField
          id={`${id}-live`}
          label={`Pay for Level ${levelId}`}
          checked={!off}
          onChange={(on) => onChange({ off: !on })}
          disabled={disabled}
          onHint="Awarded once per business day, however many times it is done."
          offHint="Off - nothing is awarded for this level. The value beside it is kept and is paid again the moment this is switched back on."
        />

        <NumberField
          id={`${id}-value`}
          label={valueLabel}
          value={value}
          onChange={(v) => onChange({ value: v })}
          disabled={disabled}
          hint={valueHint}
        />
      </div>
    </RuleCard>
  );
}
