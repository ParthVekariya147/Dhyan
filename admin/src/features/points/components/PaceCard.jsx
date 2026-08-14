import { NumberField, RuleCard, controlRow } from './RuleFields';
import {
  DEFAULT_PACE,
  PACE_GRACE_MAX,
  PACE_GRACE_MIN,
  PACE_MAX_GAP_MAX,
  PACE_MAX_GAP_MIN,
  PACE_SECONDS_MAX,
  PACE_SECONDS_MIN,
  TICK_MODE,
  eligibleTicks,
  requiredSeconds,
} from '../../../../../shared/domain/points.js';

/**
 * Section 5b - the pace rule, which is the only thing on this page that measures a yuvak
 * rather than pricing him.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What the rule actually does, in the one sentence it has to be understood by
 * ────────────────────────────────────────────────────────────────────────────
 *
 *     paid ticks = least( valid ticks, (measured seconds + grace) / seconds per tick )
 *
 * One tick is worth however many seconds of attention the admin sets, and a revision is paid
 * for no more ticks than the clock earned. Everything below is that formula said in words,
 * and the worked example at the foot is that formula run on the numbers actually in the boxes -
 * never a fixed illustration, because a card that explains a rule with somebody else's numbers
 * is a card that stops being true the moment it is edited.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A cap, never a gate, and the card has to say which
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 50 ticks in 45 seconds is paid 45, not nothing. That is the whole difference between this
 * and the rule an admin will assume it is: a gate would punish a yuvak who was half a minute
 * quick exactly as hard as one who flicked to the bottom of the list, and §1 rule 4 refuses
 * that reading. An admin who believes he has installed a gate has installed a rule that will
 * one day be defended in front of a yuvak, so it is stated on the card in plain words rather
 * than left to be discovered.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three facts about the fields that are not visible in the fields
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   * **0 seconds per tick switches the rule off**, which is what every project runs today.
 *     It is not a rate of nothing, and it does not stop anybody being paid.
 *   * **It binds Per tick and nothing else.** The award engine consults it inside the tick
 *     branch, so under Per activity or Per revision these three boxes are stored, kept, and
 *     read by nobody - said here for the same reason Level 3's daily cap says it.
 *   * **The seconds are the database's own.** Nothing in the yuvak app measures or sends a
 *     duration: the server accumulates the gap between one autosave of the draft and the next
 *     against its own clock, and discards any gap longer than the longest counted gap below.
 *     A phone left open on a bus counts as nothing; a yuvak reading a caption for half a
 *     minute counts as half a minute. There is no request he can send that shortens it.
 */

/**
 * The tick counts the worked example is drawn on.
 *
 * Illustrative, and deliberately not the size of the darshan collection - this page never
 * reads the manifest, and a number typed here that looked like the collection total would be
 * wrong the first time a darshan was published or withheld. They are three ordinary sittings:
 * a short one, a middling one, and a full collection's worth as most projects have it.
 */
const EXAMPLE_TICKS = [10, 50, 108];

/**
 * Seconds, said the way an admin would say them out loud.
 *
 * "about 2 minutes" rather than "108 seconds", because the number this card exists to make
 * real is a length of time somebody has to sit through, and a reader converts 108 seconds into
 * minutes in his head before he can judge it. Under a minute stays in seconds, where the
 * conversion would lose more than it gained.
 */
function spellSeconds(s) {
  const n = Math.max(0, Math.round(s));
  if (n === 0) return 'no time at all';
  if (n < 60) return `${n} second${n === 1 ? '' : 's'}`;
  const mins = n / 60;
  // One decimal only where it changes the answer: 90 seconds is "about 1.5 minutes" and 120 is
  // "about 2 minutes", never "about 2.0 minutes".
  const shown = Number.isInteger(mins) ? String(mins) : mins.toFixed(1);
  return `about ${shown} minute${shown === '1' ? '' : 's'}`;
}

export default function PaceCard({ pace, storedPace, mode, onChange, disabled }) {
  /*
    The boxes hold strings and the arithmetic needs numbers, so the example is computed from a
    resolved copy rather than from the form. A half-typed box reads as the value that is
    actually in force for it - which is what the resolver answers and what the server would
    apply - so the example never shows a rule nobody configured.
  */
  const live = {
    secondsPerTick: readBox(pace.secondsPerTick, DEFAULT_PACE.secondsPerTick),
    graceSeconds: readBox(pace.graceSeconds, DEFAULT_PACE.graceSeconds),
    maxGapSeconds: readBox(pace.maxGapSeconds, DEFAULT_PACE.maxGapSeconds),
  };

  const on = live.secondsPerTick > 0;
  const storedOn = (storedPace?.secondsPerTick ?? 0) > 0;
  const bindsHere = mode === TICK_MODE.TICK;

  return (
    <RuleCard
      id="pts-pace"
      title="Level 3 - pace"
      badge={storedOn ? `1 tick = ${storedPace.secondsPerTick}s` : 'Off'}
      badgeTone={storedOn ? 'ok' : 'off'}
      intro="How much measured attention one tick has to be worth. It caps what a revision is paid for; it never refuses to pay."
    >
      <div style={controlRow}>
        <NumberField
          id="pts-pace-rate"
          label="Seconds per tick"
          value={pace.secondsPerTick}
          onChange={(v) => onChange({ secondsPerTick: v })}
          disabled={disabled}
          min={PACE_SECONDS_MIN}
          max={PACE_SECONDS_MAX}
          placeholder={String(DEFAULT_PACE.secondsPerTick)}
          hint={
            on
              ? 'A revision is paid for no more ticks than the measured time buys. 0 switches the rule off.'
              : '0 - no pace rule. Every valid tick is paid, however quickly it was ticked. This is what an unconfigured system does.'
          }
        />
        <NumberField
          id="pts-pace-grace"
          label="Free seconds"
          value={pace.graceSeconds}
          onChange={(v) => onChange({ graceSeconds: v })}
          disabled={disabled}
          min={PACE_GRACE_MIN}
          max={PACE_GRACE_MAX}
          placeholder={String(DEFAULT_PACE.graceSeconds)}
          hint="Added to the measured time before it is divided, for the yuvak who opened the page and read before ticking."
        />
        <NumberField
          id="pts-pace-gap"
          label="Longest counted gap"
          value={pace.maxGapSeconds}
          onChange={(v) => onChange({ maxGapSeconds: v })}
          disabled={disabled}
          min={PACE_MAX_GAP_MIN}
          max={PACE_MAX_GAP_MAX}
          placeholder={String(DEFAULT_PACE.maxGapSeconds)}
          hint={`A silence longer than this counts as nothing at all - a phone left on a table is not attention. Between ${PACE_MAX_GAP_MIN} and ${PACE_MAX_GAP_MAX} seconds; ${DEFAULT_PACE.maxGapSeconds} when nothing is set.`}
        />
      </div>

      {/*
        The one thing an admin can get wrong here without any field refusing him: setting a
        rate while Level 3 is counted some other way. The engine reads these numbers inside the
        per-tick branch and nowhere else, so under Per activity or Per revision they are stored
        and inert - which is the same fact the daily cap states on the card above, and it is
        stated for the same reason.
      */}
      {on && !bindsHere && (
        <div className="notice notice-warn" role="status">
          Level 3 is not counted per tick at the moment, so this rule is not applied to anything.
          It is kept, and it starts working the moment <strong>Per tick</strong> is chosen above.
        </div>
      )}

      {/* ── the worked example ──────────────────────────────────────────────
          Recomputed from the boxes on every keystroke, through the very functions the award
          engine's own arithmetic is mirrored from - so a figure here is the figure the server
          will pay and not a second calculation that agrees today. */}
      <div style={exampleBlock}>
        <h3 style={exampleHead}>What this asks of a yuvak</h3>
        {on ? (
          <>
            <ul style={exampleList}>
              {EXAMPLE_TICKS.map((n) => {
                const need = requiredSeconds(n, live);
                const half = eligibleTicks(n, (need * 1000) / 2, live);
                return (
                  <li key={n} style={exampleRow}>
                    <span className="mono">{n} ticks</span> need{' '}
                    <strong>{spellSeconds(need)}</strong> of measured attention. A revision of{' '}
                    {n} ticked in half that time is paid for <span className="mono">{half}</span>{' '}
                    of them, never 0.
                  </li>
                );
              })}
            </ul>
            <p className="hint">
              {live.graceSeconds > 0
                ? `The first ${live.graceSeconds} second${live.graceSeconds === 1 ? '' : 's'} are free, so a short revision can be paid in full without meeting the rate.`
                : 'No free seconds are granted, so the clock starts at the first autosave.'}
            </p>
          </>
        ) : (
          <p className="hint">
            Nothing is asked. With 0 seconds per tick every valid tick is paid whatever the
            clock says, which is how this project has always worked. Set a rate above to see
            what it would require.
          </p>
        )}
      </div>

      <p className="card-note">
        This is a <strong>cap and not a gate</strong>. A yuvak who ticks 50 darshan in 45
        seconds is paid for 45 of them, not for none - being a little quick is not the same act
        as flicking to the foot of the list, and the rule does not treat them alike. The seconds
        are counted by the database from the revision's own autosaves and never sent by the
        phone, so there is no figure here a yuvak can report on his own behalf. The same bounds
        are checked in the database, so a value outside them cannot be stored by any route.
      </p>
    </RuleCard>
  );
}

/**
 * A box of digits → a number the example can use, or the default in force.
 *
 * Not `Number(text)`: `Number('')` is 0, and a 0 in the rate box is a real, honoured value
 * meaning "no pace rule" - so a coercing read would show the example switching itself off
 * while a box is half-typed. An empty box means the key is not written, and an unwritten key
 * resolves to its default, which is exactly what this returns.
 */
function readBox(textValue, fallback) {
  const t = String(textValue ?? '').trim();
  if (t === '' || !/^\d+$/.test(t)) return fallback;
  return Number(t);
}

/* ------------------------------------------------------------------ layout */

/** The example reads as a consequence of the boxes above it, so it is inset under them in the
 *  same way Level 3's tick block is inset under its level - sunken surface, brand rule. */
const exampleBlock = {
  marginTop: 'var(--sp-4)',
  marginBottom: 'var(--sp-3)',
  padding: 'var(--sp-4)',
  background: 'var(--surface-sunken)',
  borderInlineStart: '3px solid var(--brand-200)',
  borderRadius: 'var(--r-md)',
};

const exampleHead = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-semi)',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 'var(--sp-3)',
};

const exampleList = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' };

const exampleRow = { fontSize: 'var(--fs-table)', color: 'var(--text-body)' };
