import { useEffect, useRef, useState } from 'react';
import { gu } from '../../../lib/format';
import {
  REWARD_MODE,
  THRESHOLD_MIN,
  TRIGGER,
  activityOptions,
  bonusRuleProblem,
} from '../services/bonusService';

/**
 * The form that makes a bonus rule, and the form that edits one.
 *
 * One component for both, for CustomItemDialog's reason: a create form and an edit form that are
 * separate components are two forms that drift, and the day a field is added one of them gets it.
 * What differs between the two cases is the title, the button and whether the fields start empty.
 *
 * Built on <dialog> like ConfirmDialog beside it (§56): the browser provides the modal semantics -
 * focus trapped, Escape closes, the page behind it inert - and hand-rolling that is where keyboard
 * accessibility usually goes wrong.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Nothing about the scoring system is written into this dialog
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The level picker is the level configuration the page already loads. The activity picker is
 * `ACTIVITY_LEVEL` for the three fixed keys and `admin_point_activities()` for Level 4, so a 4.5
 * published tomorrow is an option here on the next load and no code in this panel had to learn
 * about it. There is no list of four levels and no list of four કસોટીઓ anywhere below.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the reward mode is a radio group with a worked table under it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Two of the three modes explain themselves from their names. HIGHEST_ONLY does not: "only the
 * highest threshold reached pays" is a sentence about *other rules*, and it is the only control on
 * this page whose effect depends on what else is configured. An admin with rules at 5, 10 and 20
 * who picks it has, without being told, just stopped the 5 and the 10 rules paying a yuvak who is
 * at 12 - which is either exactly what he wanted or a bug he will discover from a complaint.
 *
 * So the mode is chosen beside a table that pays out his own thresholds, at a count he can change,
 * under all three modes at once. It is computed from the rules on screen, never from an example -
 * an invented 5/10/20 would be a second answer that stops matching the moment somebody edits a
 * threshold.
 */

/** What each trigger counts, and what the threshold box is therefore asking for. */
const TRIGGER_TEXT = {
  [TRIGGER.COMPLETION_COUNT]: {
    label: 'Completions',
    hint: 'How many times the activity has been completed - one per submission that counted.',
    unit: 'completions',
  },
  [TRIGGER.ITEM_COUNT]: {
    label: 'Items',
    hint: 'How many items those completions carried - ticked scenes, for example - rather than how many sittings there were.',
    unit: 'items',
  },
  [TRIGGER.POINT_TOTAL]: {
    label: 'Points earned',
    hint: 'How many points this scope has already paid him. The bonus itself is not counted towards the next one.',
    unit: 'points',
  },
};

/** What each mode does. The third one is why the table below this exists. */
const MODE_TEXT = {
  [REWARD_MODE.EVERY]: {
    label: 'Every time the threshold is passed',
    hint: 'Pays again at every multiple: at the threshold, at twice it, at three times it.',
  },
  [REWARD_MODE.FIRST_ONLY]: {
    label: 'The first time only',
    hint: 'Pays once, when the threshold is first reached, and never again for that yuvak.',
  },
  [REWARD_MODE.HIGHEST_ONLY]: {
    label: 'Only the highest threshold reached',
    hint: 'Of the rules on the same scope, only the highest one he has reached pays. The smaller ones pay nothing at all - they are not a ladder he climbs, they are steps he passes.',
  },
};

export default function BonusRuleDialog({
  open,
  rule,
  levels,
  level4Activities = [],
  activitiesDenied = false,
  siblings = [],
  busy = false,
  serverError = '',
  onSave,
  onCancel,
}) {
  const ref = useRef(null);
  const editing = Boolean(rule?.id);

  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const [activityKey, setActivityKey] = useState('');
  const [trigger, setTrigger] = useState(TRIGGER.COMPLETION_COUNT);
  const [threshold, setThreshold] = useState('');
  const [points, setPoints] = useState('');
  const [mode, setMode] = useState(REWARD_MODE.FIRST_ONLY);
  const [enabled, setEnabled] = useState(true);
  // Nothing is marked wrong before he has had a chance to type. A form that opens with a red
  // notice is complaining about a field he has not filled in yet (§31).
  const [touched, setTouched] = useState(false);

  /*
    The fields are seeded on the dialog going from closed to open, not on `rule` changing identity.

    The card hands this a fresh object on every render of its list - reloading the rules rebuilds
    the array - so depending on `rule` would reset the form to the stored values on the first
    keystroke, which is the classic version of "the input will not let me type".
  */
  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? '');
    setLevelId(Number.isInteger(rule?.levelId) ? String(rule.levelId) : '');
    setActivityKey(rule?.activityKey ?? '');
    setTrigger(Object.values(TRIGGER).includes(rule?.trigger) ? rule.trigger : TRIGGER.COMPLETION_COUNT);
    setThreshold(Number.isFinite(rule?.threshold) && rule.threshold ? String(rule.threshold) : '');
    setPoints(Number.isFinite(rule?.points) && rule.points ? String(rule.points) : '');
    setMode(Object.values(REWARD_MODE).includes(rule?.mode) ? rule.mode : REWARD_MODE.FIRST_ONLY);
    setEnabled(rule?.enabled !== false);
    setTouched(false);
    // `rule` is intentionally not a dependency - see the note above. Reading it here without
    // depending on it is the point: these values are a starting point taken once, not a binding
    // that follows the row while he types.
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const level = levelId === '' ? null : Number(levelId);
  const acts = level === null ? [] : activityOptions(level, level4Activities);

  const candidate = {
    id: rule?.id || null,
    name: name.replace(/\s+/g, ' ').trim(),
    levelId: level,
    // An activity without a level cannot be resolved, so clearing the level clears the activity
    // rather than leaving a key behind that would be sent with a null level and refused.
    activityKey: level === null ? null : activityKey || null,
    trigger,
    threshold: parseWhole(threshold),
    points: parseSigned(points),
    mode,
    enabled,
  };

  const problem = bonusRuleProblem(candidate);

  /*
    The preview's rules: the ones already configured on the same scope and trigger, plus the one
    being typed. That is what makes the table an answer about *this* project rather than an
    illustration - the thresholds in it are the thresholds a yuvak will actually meet.
  */
  const previewRules = [
    ...siblings.filter(
      (s) =>
        s.id !== candidate.id &&
        s.trigger === candidate.trigger &&
        s.levelId === candidate.levelId &&
        (s.activityKey || null) === candidate.activityKey
    ),
    ...(Number.isFinite(candidate.threshold) && Number.isFinite(candidate.points)
      ? [{ id: 'draft', name: candidate.name || 'This rule', threshold: candidate.threshold, points: candidate.points }]
      : []),
  ];

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (problem || busy) return;
    onSave(candidate);
  }

  return (
    <dialog
      className="confirm pts-bonus-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="pts-bonus-dialog-title"
    >
      {/* A real <form>, so Enter in any field submits. `noValidate` because every message here is
          written in this app's voice and in full sentences; the browser's bubble would say
          "Please fill in this field" over the top of one of them. */}
      <form onSubmit={submit} noValidate>
        <h2 id="pts-bonus-dialog-title">{editing ? 'Edit this bonus' : 'New bonus'}</h2>

        <p className="hint pts-bonus-lead">
          A bonus is paid on top of the ordinary award when a yuvak reaches a count you choose. It
          is saved on its own, the moment you press the button below - the page's Save button has
          nothing to do with it.
        </p>

        <div className="field">
          <label htmlFor="pts-bonus-name">Name</label>
          <input
            id="pts-bonus-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            aria-describedby="pts-bonus-name-help"
          />
          <span className="hint" id="pts-bonus-name-help">
            What this bonus is for, in the words you would use to explain it - it is how the list
            below is read, and it is not shown to a yuvak.
          </span>
        </div>

        <div className="pts-bonus-row">
          <div className="field">
            <label htmlFor="pts-bonus-level">Level</label>
            <select
              id="pts-bonus-level"
              value={levelId}
              onChange={(e) => {
                setLevelId(e.target.value);
                // The activity list belongs to the level, so a level change cannot keep a key
                // from the level before it - that would be a rule scoped to an activity that
                // does not belong to it, which nothing could ever pay.
                setActivityKey('');
              }}
              disabled={busy}
              aria-describedby="pts-bonus-level-help"
            >
              <option value="">Every level</option>
              {levels.map((l) => (
                <option key={l.levelId} value={String(l.levelId)}>
                  Level {l.levelId}
                  {l.name ? ` - ${l.name}` : ''}
                </option>
              ))}
            </select>
            <span className="hint" id="pts-bonus-level-help">
              {level === null
                ? 'Counts work from every level together.'
                : 'Counts only work at this level.'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="pts-bonus-activity">Activity</label>
            <select
              id="pts-bonus-activity"
              value={activityKey}
              onChange={(e) => setActivityKey(e.target.value)}
              disabled={busy || level === null}
              aria-describedby="pts-bonus-activity-help"
            >
              <option value="">All activities of this level</option>
              {acts.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <span className="hint" id="pts-bonus-activity-help">
              {level === null
                ? 'Choose a level first. An activity belongs to one level, so it cannot be picked without one.'
                : acts.length === 0
                  ? activitiesDenied
                    ? 'The activity list could not be read: it needs the progress.read and users.read permissions. The rule can still count every activity of this level.'
                    : 'Nothing is published at this level yet, so this rule can only count the level as a whole.'
                  : 'Narrows the rule to one activity. Leave it on all if the level as a whole is what counts.'}
            </span>
          </div>
        </div>

        <div className="pts-bonus-row">
          <div className="field">
            <label htmlFor="pts-bonus-trigger">What it counts</label>
            <select
              id="pts-bonus-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              disabled={busy}
              aria-describedby="pts-bonus-trigger-help"
            >
              {Object.values(TRIGGER).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_TEXT[t].label}
                </option>
              ))}
            </select>
            <span className="hint" id="pts-bonus-trigger-help">
              {TRIGGER_TEXT[trigger].hint}
            </span>
          </div>

          <div className="field">
            {/* The label follows the trigger, so the box never asks for "threshold" in the
                abstract - a number whose unit is on a different control is the number that gets
                typed in the wrong one. */}
            <label htmlFor="pts-bonus-threshold">How many {TRIGGER_TEXT[trigger].unit}</label>
            <input
              id="pts-bonus-threshold"
              type="number"
              inputMode="numeric"
              min={THRESHOLD_MIN}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={busy}
              aria-describedby="pts-bonus-threshold-help"
            />
            <span className="hint" id="pts-bonus-threshold-help">
              {THRESHOLD_MIN} or more. Reaching this many is what pays the bonus.
            </span>
          </div>

          <div className="field">
            {/* Not the shared NumberField: that box floors at 0 and this one may hold a negative,
                which is the only way to configure a rule that takes points away. No ceiling is
                declared here because the contract for this column declares none, and a bound the
                panel enforces and the database does not is the one disagreement a rules screen
                may not have. */}
            <label htmlFor="pts-bonus-points">Bonus points</label>
            <input
              id="pts-bonus-points"
              type="number"
              inputMode="numeric"
              step={1}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              disabled={busy}
              aria-describedby="pts-bonus-points-help"
            />
            <span className="hint" id="pts-bonus-points-help">
              Paid on top of the ordinary award. A minus sign takes points away; 0 is not allowed,
              because a rule worth nothing writes no ledger row and only looks configured.
            </span>
          </div>
        </div>

        <fieldset className="pts-bonus-modes">
          <legend>How often it pays</legend>
          {Object.values(REWARD_MODE).map((m) => (
            <label className="check pts-bonus-mode" key={m} htmlFor={`pts-bonus-mode-${m}`}>
              <input
                id={`pts-bonus-mode-${m}`}
                type="radio"
                name="pts-bonus-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                disabled={busy}
              />
              <span className="pts-bonus-mode-text">
                <strong>{MODE_TEXT[m].label}</strong>
                <span className="hint">{MODE_TEXT[m].hint}</span>
              </span>
            </label>
          ))}

          <ModePreview rules={previewRules} highlight={mode} unit={TRIGGER_TEXT[trigger].unit} />
        </fieldset>

        <div className="field">
          <label className="check" htmlFor="pts-bonus-enabled">
            <input
              id="pts-bonus-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />
            Pay this bonus
          </label>
          <span className="hint">
            Switching it off keeps the rule and stops it paying. Every bonus it has already paid
            stays in the ledger either way.
          </span>
        </div>

        {touched && problem && (
          <div className="notice notice-danger" role="alert">
            {problem}
          </div>
        )}

        {/* The server's own refusal, in its own words. It names the bound it refused, which is
            more specific than anything this form could say about it. */}
        {serverError && (
          <div className="notice notice-danger" role="alert">
            {serverError}
          </div>
        )}

        <div className="confirm-actions">
          <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn${busy ? ' is-busy' : ''}`} type="submit" disabled={busy || !!problem}>
            {busy ? 'Saving…' : editing ? 'Save this bonus' : 'Add this bonus'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/* ---------------------------------------------------------------------------
 * The three modes, paid out
 * ------------------------------------------------------------------------- */

/**
 * What a yuvak at a given count would earn from these rules, under each of the three modes.
 *
 * The whole table is one argument about HIGHEST_ONLY. With thresholds at 5, 10 and 20 and a yuvak
 * at 19, EVERY pays the 5-rule three times over, FIRST_ONLY pays the 5 and the 10 once each, and
 * HIGHEST_ONLY pays the 10 alone - the 5 pays nothing, which is the part nobody expects from the
 * name and the part that turns up as a complaint rather than as a bug report.
 *
 * The count is editable because the interesting number is different for every set of thresholds,
 * and it opens on one just under the top threshold, which is where the three modes disagree most.
 * `at` is state rather than a prop for the same reason: it is a question the સંચાલક asks of the
 * table, not a value the rule is saved with, and nothing here is ever sent anywhere.
 */
export function ModePreview({ rules, highlight, unit, id = 'pts-bonus-preview' }) {
  const usable = rules.filter((r) => Number.isFinite(r.threshold) && r.threshold > 0);
  const [at, setAt] = useState('');

  const suggested = suggestCount(usable.map((r) => r.threshold));
  const count = at === '' ? suggested : parseWhole(at);

  if (usable.length === 0) {
    return (
      <p className="hint pts-bonus-preview-empty">
        Type a threshold and a bonus above, and this will show what each of the three modes would
        pay - including the ones already configured on the same scope.
      </p>
    );
  }

  return (
    <div className="pts-bonus-preview">
      {/* The id is a prop because this table appears twice on one page - once beside the list and
          once inside the editor - and two controls sharing an id is a label that points at the
          wrong box for everybody using a screen reader (§56). */}
      <div className="field pts-bonus-preview-at">
        <label htmlFor={`${id}-at`}>If a yuvak reaches</label>
        <input
          id={`${id}-at`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={at === '' ? String(suggested) : at}
          onChange={(e) => setAt(e.target.value)}
          /* Inside the editor this box sits in the rule's own <form>, where Enter means submit.
             This one is a question asked of the table and nothing else, so Enter in it must not
             save a rule the સંચાલક was still thinking about. */
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          aria-describedby={`${id}-at-help`}
        />
        <span className="hint" id={`${id}-at-help`}>
          {unit}. Change it to see where the three modes stop agreeing. Nothing here is saved.
        </span>
      </div>

      <div className="table-wrap">
        <table className="dt pts-bonus-preview-table">
          <caption className="sr-only">
            What each reward mode would pay at the count above, from the rules on this scope
          </caption>
          {/*
            Hand-built rather than a DataTable - three rows computed on the spot from what is
            being typed, not a list with a key, a pager or an export - but it carries the same
            `.dt` styling, so it carries the same two obligations on a phone.

            `data-label` on the header cells as well as the body ones: the pair is what a hide
            rule selects on, and a `td` dropped without its `th` would put "What pays" under the
            heading "Mode". `.is-pin` on the mode, because this table is at its narrowest inside a
            bottom sheet and the mode is the only thing on a row that says which of the three
            answers it is - the other two cells are that answer, and answers with no question
            attached are what the whole table exists to stop.
          */}
          <thead>
            <tr>
              <th scope="col" className="is-pin" data-label="Mode">Mode</th>
              <th scope="col" data-label="What pays">What pays</th>
              <th scope="col" className="ta-r" data-label="Total bonus">
                Total bonus
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.values(REWARD_MODE).map((m) => {
              const paid = payouts(usable, m, count);
              const total = paid.reduce((sum, p) => sum + p.times * p.rule.points, 0);
              const paying = paid.filter((p) => p.times > 0);
              return (
                <tr key={m} className={m === highlight ? 'is-on' : ''}>
                  <td className="is-pin" data-label="Mode">
                    {MODE_TEXT[m].label}
                    {m === highlight ? ' (chosen)' : ''}
                  </td>
                  <td data-label="What pays">
                    {paying.length === 0
                      ? 'Nothing yet'
                      : paying
                          .map(
                            (p) =>
                              `${p.rule.name || 'Rule'} at ${gu(p.rule.threshold)}${p.times > 1 ? ` × ${gu(p.times)}` : ''}`
                          )
                          .join(', ')}
                  </td>
                  <td data-label="Total bonus" className="ta-r mono">
                    {gu(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint">
        Every rule on one scope is shown under one mode at a time, which is how the engine reads
        them: the mode decides which of the thresholds a yuvak has passed are still worth paying.
      </p>
    </div>
  );
}

/**
 * How many times each rule pays at `count`, under one mode.
 *
 * EVERY is a multiple count, FIRST_ONLY is a threshold test, and HIGHEST_ONLY is the only one that
 * needs the other rules to answer at all - it is what makes this a table rather than three
 * sentences.
 */
function payouts(rules, mode, count) {
  const at = Number.isFinite(count) ? count : 0;

  if (mode === REWARD_MODE.HIGHEST_ONLY) {
    const reached = rules.filter((r) => at >= r.threshold);
    const top = reached.reduce((best, r) => (best === null || r.threshold > best.threshold ? r : best), null);
    return rules.map((rule) => ({ rule, times: top && rule === top ? 1 : 0 }));
  }

  return rules.map((rule) => ({
    rule,
    times:
      mode === REWARD_MODE.EVERY
        ? Math.floor(at / rule.threshold)
        : at >= rule.threshold
          ? 1
          : 0,
  }));
}

/**
 * The count the table opens on: just under the highest threshold, or well past a lone one.
 *
 * Chosen so the first thing on screen is a case where the three modes disagree. Opening on 0 - or
 * on a number past every threshold - would show three identical rows and teach nothing, which is
 * the same as not having the table.
 */
function suggestCount(thresholds) {
  if (thresholds.length === 0) return 0;
  const sorted = [...thresholds].sort((a, b) => a - b);
  const top = sorted[sorted.length - 1];
  if (sorted.length === 1) return top * 2 + 1;
  return Math.max(top - 1, sorted[sorted.length - 2]);
}

/* ---------------------------------------------------------------------------
 * The boxes
 * ------------------------------------------------------------------------- */

/**
 * A box of digits → a number, and anything else → NaN.
 *
 * Deliberately not `Number(text)`: `Number('')` and `Number(' ')` are both 0, and 0 is a value
 * both of these fields refuse - a threshold of 0 is met by everybody and a bonus of 0 pays
 * nothing. NaN is passed through rather than swallowed, because that is what the validator tests.
 */
function parseWhole(textValue) {
  const t = String(textValue ?? '').trim();
  return t === '' || !/^\d+$/.test(t) ? NaN : Number(t);
}

/** The same, keeping a leading minus: the bonus is the one field here where it is a real value. */
function parseSigned(textValue) {
  const t = String(textValue ?? '').trim();
  return t === '' || !/^-?\d+$/.test(t) ? NaN : Number(t);
}
