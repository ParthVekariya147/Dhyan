import { RuleCard } from './RuleFields';
import { gu } from '../../../lib/format';
import { TICK_MODE } from '../../../../../shared/domain/points.js';
import { DEFAULT_EARN, EARN_MODE, TICK_COUNT, TICK_COUNT_KEY, earnKeyFor, isDefaultEarn } from '../services/bonusService';

/**
 * How often each level pays - the one setting on this page that changes what a number means.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why every selector carries a sum and not just a label
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every other control on this page changes a price, and a price is its own explanation: 200 is
 * 200. These five change *how many times* a price is paid, which means the same "200" on the card
 * above is worth 200 a day under one mode and 1000 a day under another - and nothing on any
 * screen would say so. The failure this card exists to avoid is the સંચાલક who reads
 * "Level 2 - 200", chooses EVERY because it sounds generous, and finds out from the leaderboard a
 * week later that the day's darshan collection pays 200 per દર્શન opened.
 *
 * So each selector prints the consequence in the values that are actually configured on this
 * page as he types them - never an example with invented numbers, which would be a second,
 * quietly wrong answer the moment somebody changed a price.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A <select> here, where Level 3's three modes are radios
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Level 3's tick modes are one question with three answers and get three rows. This card asks the
 * same question five times over, and five stacks of three radios is a screenful of controls in
 * which the one that was changed cannot be found. Each selector is therefore one row - a select,
 * and under it the sentence for the option chosen, which is the part a radio group was carrying.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The levels are not listed here
 * ────────────────────────────────────────────────────────────────────────────
 *
 * They come from the level configuration the page already loads, name and all, so a level that is
 * renamed in Levels is renamed here and a level list this panel disagrees with cannot exist. The
 * stored key is derived from the level id (`earnKeyFor`), not typed out beside a hard-coded name.
 */

/** What each mode does, said once, in the words the sums below use. */
const MODE_TEXT = {
  [EARN_MODE.DAY_FIRST]: {
    label: 'Once a day',
    short: 'The first one of the day pays. Anything more that day pays nothing.',
  },
  [EARN_MODE.EVERY]: {
    label: 'Every time',
    short: 'Every valid submission pays, however many there are in a day.',
  },
  [EARN_MODE.ONCE]: {
    label: 'Once ever',
    short: 'Pays the very first time and never again, on any later day.',
  },
};

const TICK_TEXT = {
  [TICK_COUNT.FRESH]: {
    label: 'Only ticks not already counted today',
    short: 'A scene already paid for today is not paid for again in a second submission.',
  },
  [TICK_COUNT.ALL]: {
    label: 'Every tick in the submission',
    short: 'Every ticked scene pays each time it is submitted, whether or not it paid earlier today.',
  },
};

/**
 * The illustration's counts, and only its counts.
 *
 * The *prices* in every sentence below come from the boxes on this page. These three numbers are
 * the story around them - "five completions", "ten ticks of which four already counted" - and
 * they are here rather than inline so the same story is told by every row.
 */
const EXAMPLE_TIMES = 5;
const EXAMPLE_TICKS = 10;
const EXAMPLE_TICKS_SEEN = 4;

export default function EarningModeCard({
  levels,
  earn,
  storedEarn,
  values,
  tick,
  switchedOff = [],
  onChange,
  disabled,
}) {
  // The badge reports what is *stored*, not what is in the form: it is the answer to "what is
  // running right now", which is the question somebody opening this page has.
  const storedChanged = !isDefaultEarn(storedEarn);

  /*
    Only the levels that have an earning mode to configure.

    `earn` holds one key per level and the level list is data, so the two can disagree: a row that
    named a level this build has no key for would render a selector bound to `undefined`, which is
    a blank <select> and a thrown TypeError on the sentence under it - a white screen for the whole
    page. Rendering the ones that exist is the honest half of that, and there is nothing to
    configure for the other half anyway.
  */
  const shown = levels.filter((l) => earnKeyFor(l.levelId) in DEFAULT_EARN);

  // The warning below is about the levels only. Changing which ticks Level 3 counts is a change of
  // the same kind but not the same sentence, and a notice that says "a level no longer pays once a
  // day" when no level changed is a notice nobody will read the second time.
  const levelsChanged = shown.some((l) => earn[earnKeyFor(l.levelId)] !== DEFAULT_EARN[earnKeyFor(l.levelId)]);

  return (
    <RuleCard
      id="pts-earn"
      title="How often each level pays"
      badge={storedChanged ? 'Changed from the standard' : 'Once a day'}
      badgeTone={storedChanged ? 'warn' : 'ok'}
      intro="The values above say what a level is worth. These say how many times that value is paid. Both are needed to know what a yuvak earns in a day - and this is the half that is easy to get wrong, because nothing on the cards above changes when it is."
    >
      <div className="pts-earn-grid">
        {shown.map((lvl) => (
          <LevelMode
            key={lvl.levelId}
            level={lvl}
            mode={earn[earnKeyFor(lvl.levelId)]}
            storedMode={storedEarn[earnKeyFor(lvl.levelId)]}
            worth={values[earnKeyFor(lvl.levelId)]}
            off={switchedOff.includes(earnKeyFor(lvl.levelId))}
            onChange={(m) => onChange({ [earnKeyFor(lvl.levelId)]: m })}
            disabled={disabled}
          />
        ))}
      </div>

      {/*
        The tick question is a property of Level 3's per-tick mode and reads as a fifth level if
        it sits in the grid above, so it is inset on the sunken surface with the same brand rule
        Level3Card uses to mark "this belongs to that".
      */}
      <div className="pts-earn-sub">
        <div className="field">
          <label htmlFor="pts-earn-tickcount">Which ticks a Level 3 submission is paid for</label>
          <select
            id="pts-earn-tickcount"
            value={earn[TICK_COUNT_KEY]}
            onChange={(e) => onChange({ [TICK_COUNT_KEY]: e.target.value })}
            disabled={disabled}
            aria-describedby="pts-earn-tickcount-help"
          >
            {Object.values(TICK_COUNT).map((m) => (
              <option key={m} value={m}>
                {TICK_TEXT[m].label}
                {m === DEFAULT_EARN[TICK_COUNT_KEY] ? ' (today)' : ''}
              </option>
            ))}
          </select>
          <span className="hint" id="pts-earn-tickcount-help">
            {TICK_TEXT[earn[TICK_COUNT_KEY]].short}
          </span>
        </div>

        <p className="card-note pts-earn-sum">{tickSentence(earn[TICK_COUNT_KEY], tick)}</p>

        {tick?.mode !== TICK_MODE.TICK && (
          <p className="hint">
            Level 3 is not counted per tick at the moment, so this decides nothing today. It is
            kept, and it applies the moment Per tick is chosen on the Level 3 card above.
          </p>
        )}
      </div>

      {levelsChanged && (
        /*
          One warning for the whole card rather than one per row. It is not about any single mode
          being wrong - it is the fact these settings, unlike a price, change what yesterday's
          habits are worth from the next submission onwards, which is the sentence an admin needs
          before he saves and not after.
        */
        <div className="notice notice-warn" role="status">
          At least one level no longer pays once a day. This applies from the next submission
          onwards and never rewrites what anybody has already earned - but the day it is saved,
          the same amount of work starts being worth a different number of points.
        </div>
      )}

      <p className="card-note">
        <strong>Once a day</strong> is what the app does with nothing configured, and it is what
        every level does today. Nothing here changes what a level is worth; it changes how many
        times that value is paid.
      </p>
    </RuleCard>
  );
}

/**
 * One level's selector, with the arithmetic for the option currently chosen.
 *
 * The level's own price is read from the same draft the cards above are editing, so the sum moves
 * with the box: type 250 into Level 2 and this line says 1250 before the keystroke has left the
 * page. A worked example that did not do that would be worse than none, because it would be
 * believable and wrong.
 */
function LevelMode({ level, mode, storedMode, worth, off, onChange, disabled }) {
  const id = `pts-earn-${level.levelId}`;
  const price = whole(worth?.price);
  const changed = mode !== storedMode;

  return (
    <div className="field pts-earn-cell">
      <label htmlFor={id}>
        Level {level.levelId}
        {level.name ? ` - ${level.name}` : ''}
      </label>
      <select
        id={id}
        value={mode}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={`${id}-help`}
      >
        {Object.values(EARN_MODE).map((m) => (
          <option key={m} value={m}>
            {MODE_TEXT[m].label}
            {m === DEFAULT_EARN[earnKeyFor(level.levelId)] ? ' (today)' : ''}
          </option>
        ))}
      </select>
      <span className="hint" id={`${id}-help`}>
        {MODE_TEXT[mode].short}
      </span>

      {/* The sum, in its own line and its own weight, because it is the only thing on this card
          that is specific to what this project actually pays. */}
      <p className="pts-earn-sum">{levelSentence(mode, price)}</p>

      {/* A level that has no single price says which number the sum above used. Level 4 is the
          one that does: each test can be priced on its own, so the sum is drawn on the default
          and would otherwise be quietly wrong for every test that carries a price. */}
      {worth?.note && <span className="hint">{worth.note}</span>}

      {off && (
        <span className="hint">
          Level {level.levelId} is switched off above, so nothing is paid under any of these
          today.
        </span>
      )}
      {changed && !off && <span className="hint">Not saved yet. Stored: {MODE_TEXT[storedMode].label}.</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The sums
 * ------------------------------------------------------------------------- */

/**
 * A box of digits → a number, and anything else → NaN.
 *
 * The same read PointsPage makes, and deliberately not `Number(text)`: `Number('')` is 0, and a
 * half-typed box must not make this card claim a yuvak earns nothing.
 */
function whole(textValue) {
  const t = String(textValue ?? '').trim();
  return t === '' || !/^\d+$/.test(t) ? NaN : Number(t);
}

/** What this level would actually pay, in the configured value. Never an invented one. */
function levelSentence(mode, price) {
  if (!Number.isFinite(price)) {
    return 'Set a value for this level above, and this line will say what it pays.';
  }
  if (price === 0) {
    return 'This level is worth 0, so every option here pays the same: nothing.';
  }

  const times = EXAMPLE_TIMES;
  if (mode === EARN_MODE.EVERY) {
    return `${gu(times)} completions in one day earn ${gu(times)} × ${gu(price)} = ${gu(times * price)}.`;
  }
  if (mode === EARN_MODE.ONCE) {
    return `${gu(times)} completions in one day earn ${gu(price)} - once, ever. Tomorrow's earn nothing.`;
  }
  return `${gu(times)} completions in one day earn ${gu(price)} in total. The first pays; the other ${gu(times - 1)} pay nothing.`;
}

/** The same treatment for the tick question, in points per tick. */
function tickSentence(countMode, tick) {
  const perTick = whole(tick?.perTick);
  if (!Number.isFinite(perTick) || perTick === 0) {
    return 'Set points per tick on the Level 3 card above, and this line will say what a submission pays.';
  }

  const fresh = EXAMPLE_TICKS - EXAMPLE_TICKS_SEEN;
  if (countMode === TICK_COUNT.ALL) {
    return `A submission of ${gu(EXAMPLE_TICKS)} ticks pays ${gu(EXAMPLE_TICKS)} × ${gu(perTick)} = ${gu(EXAMPLE_TICKS * perTick)}, even if ${gu(EXAMPLE_TICKS_SEEN)} of them were already paid for earlier today.`;
  }
  return `A submission of ${gu(EXAMPLE_TICKS)} ticks of which ${gu(EXAMPLE_TICKS_SEEN)} were already counted today pays ${gu(fresh)} × ${gu(perTick)} = ${gu(fresh * perTick)}.`;
}
