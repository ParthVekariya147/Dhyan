import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { AsyncBlock, CardSkeleton, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import {
  ACTIVITY_CODE_RE,
  DEFAULT_POINT_RULES,
  TICK_MODE,
  resolvePointRules,
  resolvePoints,
  validatePointRules,
  validatePoints,
} from '../../../../../shared/domain/points.js';
import { resolveLevels } from '../../../../../shared/domain/settings.js';
import {
  getPointActivities,
  getPointsConfig,
  getPointsOverview,
  isPermissionDenied,
  pointsSaveError,
  savePointRules,
  stableJson,
} from '../services/pointsService';
import { EARN_KEY, earnKeyFor, isDefaultEarn, resolveEarn } from '../services/bonusService';
import OverviewStrip from '../components/OverviewStrip';
import GlobalRulesCard from '../components/GlobalRulesCard';
import LevelValueCard from '../components/LevelValueCard';
import Level3Card from '../components/Level3Card';
import Level4Table from '../components/Level4Table';
import EarningModeCard from '../components/EarningModeCard';
import RepeatCard from '../components/RepeatCard';
import BonusRulesCard from '../components/BonusRulesCard';
import ManualAdjustCard from '../components/ManualAdjustCard';
import ConfigHistoryCard from '../components/ConfigHistoryCard';
import { RuleError } from '../components/RuleFields';
import '../points.css';

/**
 * §36 - Point Management. Every value, rule and limit the point engine reads, on one screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Nothing about the scoring system is written into this page
 * ────────────────────────────────────────────────────────────────────────────
 *
 * No level is listed, no activity code appears, no point value is suggested and no item count is
 * assumed. The લેવલ ૪ table is built from `admin_point_activities()` - the published
 * configuration - so a 4.5 created next month is a row here on the next load and a code that is
 * retired stops being offered without anybody editing this file. The four fixed levels are fixed
 * in the *schema* (`point_transactions.level_id`, and the three activity keys in
 * shared/domain/points.js), not in a list this panel decided on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This page writes configuration. It never writes a point
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every award is calculated server-side by `award_points()` from the rules stored here; the
 * ledger has no write policy and this panel has no path to it. The single exception is the manual
 * adjustment in section 8, which goes through a SECURITY DEFINER function that **appends** a row -
 * so even that cannot edit history. No total on this screen is computed in the browser.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three reads, three outcomes, and only one of them may stop the page
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   the rules      `settings['levels'].value.points`, read raw. Needs `settings.read`, which is
 *                  what the route is gated on, so a failure here is a real failure and the page
 *                  is an ErrorState with a Try again.
 *   the totals     `admin_points_overview()` asserts a *progress reader* - `progress.read` and
 *                  `users.read` - and raises 42501 for a role that holds neither. A
 *                  CONTENT_MANAGER holds `settings.read` and reaches this page legitimately, so
 *                  that refusal hides section 1 and nothing else.
 *   the tests      `admin_point_activities()` asserts the same thing, which the brief did not
 *                  say and the migration does (0032:754). Same treatment: the Level 4 card says
 *                  the list could not be read and still shows every stored price, because a
 *                  price nobody can see is a price nobody can remove.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The save is read-modify-write, and it preserves what it does not render
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The whole `points` object is composed from the slice that was loaded, so a key this page has
 * never heard of survives untouched - at the **top level**, which is the only place it can. The
 * database refuses an unknown key inside `repeat` (only `enabled`, `default`, `dailyLimit` and
 * activity codes) and inside `tick` (only `mode`, `perTick`, `perRevision`, `dailyCap`), so a
 * stray key there cannot be round-tripped: keeping it would mean every save from this page being
 * refused. Those two objects are therefore rebuilt, and everything beside them is carried.
 *
 * `earn` - how often each level pays - is a third object of the same kind and is treated the same
 * way: rebuilt rather than merged, written only when it says something, and carried by the same
 * single Save. It deliberately has no write of its own. Two writes for one settings object is two
 * things that can half-succeed, and "the level values saved but the mode did not" is a state
 * nobody could read off this screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one section on this page that its Save button does not save
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Bonus rules are rows of `point_bonus_rules`, written one at a time through their own RPCs the
 * moment their form is submitted. They are mounted below the save bar rather than above it, and
 * they say so in their badge, their introduction and their dialog - because a section that looks
 * like the seven above it and is not saved by the same button is the one mistake this page's
 * layout can cause.
 */
export default function PointsPage() {
  const { can } = useAdminAuth();

  /**
   * `settings.read` opens the page and `settings.update` moves it. **Disabled, not hidden** -
   * what each level is currently worth is the useful fact on this screen, and a VIEWER asked
   * "how did he get 600 today?" should be able to read the answer rather than find an empty
   * space. The check that actually decides is the RLS policy on `settings` (0004_rbac.sql);
   * this is only where it becomes visible.
   */
  const mayEdit = can('settings.update');

  const config = useAsync(() => getPointsConfig(), []);

  /*
    A permission refusal is data here, not an error.

    `useAsync` turns a throw into `state.error` and an ErrorState, which is right for the rules
    read and wrong for these two: a settings-only role is *supposed* to be refused by them, and
    a page that fails whole because of it would hide the values that role is allowed to change.
    So the refusal is caught and returned as `{ denied: true }`, and anything else still throws.
  */
  const overview = useAsync(() => allowDenied(getPointsOverview()), []);
  const activities = useAsync(() => allowDenied(getPointActivities()), []);

  const [draft, setDraft] = useState(null);
  const [pristine, setPristine] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The rules are hints before the first edit and errors only after one. A page that is red the
  // moment it paints is telling the સંચાલક off for nothing (§31).
  const [touched, setTouched] = useState(false);

  /*
    Rebuild the form when the stored row changes - on load, and after a save.

    Keyed on the serialisation of the stored slice rather than on the object, which is a fresh
    identity on every render of this component and would fight the સંચાલક for the cursor.
  */
  const baseline = config.data?.baseline || '';
  useEffect(() => {
    if (!config.data) return;
    const fresh = toDraft(config.data.stored);
    setDraft(fresh);
    setPristine(stableJson(fromDraft(fresh)));
    setTouched(false);
    setMsg(null);
  }, [baseline, config.data]);

  const activityList = activities.data?.denied ? [] : activities.data?.value || [];
  const activitiesDenied = activities.data?.denied === true;

  /**
   * The levels, from the row this page already read - never a list written into this file.
   *
   * `resolveLevels()` is the same function the યુવક app's home page reads, so a level renamed in
   * Levels is renamed in the earning-mode card and in the bonus scope picker without either of
   * them being told. It always answers with a renderable list, so nothing below has to handle an
   * empty one.
   */
  const levelList = useMemo(() => resolveLevels(config.data?.row?.levels), [config.data]);

  /**
   * What each level's earning-mode sentence multiplies, taken from the boxes on this page.
   *
   * Levels 1 to 3 hold one value each and the sum is exact. Level 4 is priced per કસોટી, so no
   * single number is "what Level 4 is worth": the sum uses the Level 4 default - what an unpriced
   * test pays - and the note says so, because an example drawn on a number that half the tests do
   * not use would be believable and wrong.
   *
   * The mapping is by stored key rather than by the number 4, so this stays correct if the level
   * list ever grows: a level with no flat value of its own is described by the default and marked.
   */
  const earnValues = useMemo(() => {
    if (!draft) return {};
    const flat = { level1: draft.level1, level2: draft.level2, level3: draft.level3 };
    const out = {};
    for (const l of levelList) {
      const key = earnKeyFor(l.levelId);
      out[key] =
        key in flat
          ? { price: flat[key] }
          : { price: draft.l4Default, note: 'Counted on the Level 4 default. A test with a price of its own pays that instead.' };
    }
    return out;
  }, [draft, levelList]);

  /**
   * The rows of the Level 4 table: the published કસોટીઓ, plus any code this row already prices
   * that the published configuration no longer carries.
   *
   * The second half is the part that is easy to leave out and expensive to have left out. A
   * stored price for a retired code pays nobody today, but it starts paying again the day
   * somebody republishes that code - so it is shown, marked, and removable.
   */
  const level4Rows = useMemo(() => {
    if (!draft) return [];
    const rows = new Map();
    for (const a of activityList) {
      rows.set(a.code, { code: a.code, title: a.title, position: a.position, active: a.active, inConfig: true });
    }
    const stray = [
      ...Object.keys(draft.l4),
      ...Object.keys(draft.repeat.byCode),
      ...draft.disabled.filter((t) => ACTIVITY_CODE_RE.test(t)),
    ];
    for (const code of stray) {
      if (!rows.has(code)) rows.set(code, { code, title: '', position: 0, active: false, inConfig: false });
    }
    return [...rows.values()].map((r) => ({
      ...r,
      value: draft.l4[r.code] ?? '',
      repeat: draft.repeat.byCode[r.code] ?? '',
      off: draft.disabled.includes(r.code),
    }));
  }, [draft, activityList]);

  if (!draft) {
    return (
      <>
        <PageHeader title="Point Management" sub={PAGE_SUB} />
        <AsyncBlock state={config} onRetry={config.retry} skeleton={<FormSkeleton fields={6} />}>
          <FormSkeleton fields={6} />
        </AsyncBlock>
      </>
    );
  }

  /* ------------------------------------------------------------------ edits */

  const patch = (part) => {
    setDraft((d) => ({ ...d, ...part }));
    setTouched(true);
    setMsg(null);
  };

  const patchRepeat = (part) => {
    setDraft((d) => ({ ...d, repeat: { ...d.repeat, ...part } }));
    setTouched(true);
    setMsg(null);
  };

  const patchTick = (part) => {
    setDraft((d) => ({ ...d, tick: { ...d.tick, ...part } }));
    setTouched(true);
    setMsg(null);
  };

  /** One earning mode. Merged into the object because each selector only knows its own key. */
  const patchEarn = (part) => {
    setDraft((d) => ({ ...d, earn: { ...d.earn, ...part } }));
    setTouched(true);
    setMsg(null);
  };

  /** Add or remove one token from the `disabled` list. `level1`..`level4`, or an activity code. */
  const setOff = (token, off) => {
    setDraft((d) => ({
      ...d,
      disabled: off ? [...d.disabled.filter((t) => t !== token), token] : d.disabled.filter((t) => t !== token),
    }));
    setTouched(true);
    setMsg(null);
  };

  /** One level's value and its switch, from the one handler each level card is given. */
  const levelChange = (levelKey, token) => (part) => {
    if ('value' in part) patch({ [levelKey]: part.value });
    if ('off' in part) setOff(token, part.off);
  };

  const rowChange = (code, part) => {
    if ('value' in part) {
      setDraft((d) => ({ ...d, l4: { ...d.l4, [code]: part.value } }));
      setTouched(true);
      setMsg(null);
    }
    if ('repeat' in part) {
      setDraft((d) => ({ ...d, repeat: { ...d.repeat, byCode: { ...d.repeat.byCode, [code]: part.repeat } } }));
      setTouched(true);
      setMsg(null);
    }
    if ('off' in part) setOff(code, part.off);
  };

  /* ------------------------------------------------------- the candidate row */

  const candidate = fromDraft(draft);

  /*
    The shared rules, run as he types.

    **Both** of them, and that is not belt and braces: they divide the object between them.
    `validatePoints()` owns `enabled` and the four level values, `validatePointRules()` owns the
    0031 keys and deliberately says nothing about the first four, so that neither is a second
    place for the other's checks to drift. Together they are exactly what
    `settings_check_points()` refuses, in the same order and the same words.

    The **same calls the save makes** - not a livelier local approximation of them. A divergent
    live check is a second answer to one question, and the answer that loses is always the one the
    સંચાલક can see: he would watch a field settle and then read a refusal from the server naming a
    bound this page never mentioned. save() runs them again and is the authority; this is only
    where the message arrives at the keystroke that caused it.
  */
  const problem = rulesProblem(candidate);
  const ruleError = touched ? problem : '';

  /**
   * Nothing to save when the form already holds what is stored. Re-saving writes a settings row
   * and files an audit entry for a change that did not happen (§41), and an audit trail carrying
   * edits nobody made is worse than one carrying none.
   *
   * Compared through the stable serialisation, so re-ordering the switched-off list - or clearing
   * a price and typing it back - is correctly read as no change at all.
   */
  const changed = stableJson(candidate) !== pristine;

  async function save() {
    /*
      Validated before anything is sent, and with the shared rules rather than checks of this
      page's own.

      The trigger would refuse a bad payload anyway - that is the guarantee, and it is the reason
      this can never be the only check - but sending one and letting it bounce would put a
      database refusal in front of the સંચાલક for something the form could have named beside the
      field. Among the things caught here is the pair the tick mode couples: TICK needs points per
      tick above 0 and REVISION needs points per revision above 0, because a mode that pays
      nothing switches Level 3 off while looking configured (0031:957-967).
    */
    const bad = rulesProblem(candidate);
    if (bad) {
      setTouched(true);
      setMsg({ tone: 'danger', text: bad });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await savePointRules({ points: candidate, baseline: config.data.baseline });
      /*
        Audited by the `audit_settings` trigger (0004_rbac.sql), which files this as
        LEVEL_UPDATED the moment the row is written. There is no audit call here and there must
        not be one: a second entry written from the browser would double every edit in the log
        and could be omitted by anyone talking to the database directly.
      */
      setMsg({
        tone: 'ok',
        text: candidate.enabled
          ? 'Saved. Work finished from now on is paid by these rules. Nothing already earned has changed.'
          : 'Saved. Points are off, so every activity is worth 0 until this is switched back on.',
      });
      config.retry();
      overview.retry();
    } catch (e) {
      // §31 - a failed save leaves every box where it is and offers the button again. The
      // server's refusal names the bound it refused, and pointsSaveError() shows that sentence
      // rather than replacing it with a general one.
      setMsg({ tone: 'danger', text: pointsSaveError(e) });
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ render */

  const stored = toDraft(config.data.stored);
  const locked = !mayEdit || busy;

  return (
    <>
      <PageHeader title="Point Management" sub={PAGE_SUB} />

      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          You can read every rule here, but saving needs the <strong>settings.update</strong>{' '}
          permission. The controls are shown so you can see what is in force.
        </div>
      )}

      {/* ── 1. Overview and reconciliation ─────────────────────────────── */}
      {overview.data?.denied ? (
        <div className="notice" role="status">
          The totals are hidden: reading the ledger needs the <strong>progress.read</strong> and{' '}
          <strong>users.read</strong> permissions. Every rule below is still yours to read and
          change.
        </div>
      ) : (
        <AsyncBlock state={overview} onRetry={overview.retry} skeleton={<CardSkeleton count={4} />}>
          {overview.data?.value && <OverviewStrip overview={overview.data.value} />}
        </AsyncBlock>
      )}

      {/* ── 2. Global ──────────────────────────────────────────────────── */}
      <GlobalRulesCard
        enabled={draft.enabled}
        version={draft.version}
        effectiveFrom={draft.effectiveFrom}
        storedEnabled={stored.enabled}
        onChange={patch}
        disabled={locked}
      />

      {/* ── 3 and 4. The two flat levels ───────────────────────────────── */}
      <LevelValueCard
        id="pts-l1"
        levelId={1}
        title="Level 1 - Meditation"
        intro="What finishing the entry gate is worth: the video watched and both answers given."
        valueLabel="Points for completing Level 1"
        valueHint="Paid once, on the day the entry gate is completed."
        value={draft.level1}
        off={draft.disabled.includes('level1')}
        storedOff={stored.disabled.includes('level1')}
        onChange={levelChange('level1', 'level1')}
        disabled={locked}
      />

      <LevelValueCard
        id="pts-l2"
        levelId={2}
        title="Level 2 - Darshan"
        intro="What one darshan carried through to its last scene is worth."
        valueLabel="Points for completing a Darshan"
        valueHint="Paid once per business day, however many darshan are seen that day."
        value={draft.level2}
        off={draft.disabled.includes('level2')}
        storedOff={stored.disabled.includes('level2')}
        onChange={levelChange('level2', 'level2')}
        disabled={locked}
      />

      {/* ── 5. Level 3 and the tick block ──────────────────────────────── */}
      <Level3Card
        value={draft.level3}
        off={draft.disabled.includes('level3')}
        storedOff={stored.disabled.includes('level3')}
        storedMode={stored.tick.mode}
        tick={draft.tick}
        onChange={levelChange('level3', 'level3')}
        onTickChange={patchTick}
        disabled={locked}
      />

      {/* ── 6. Level 4 ─────────────────────────────────────────────────── */}
      <AsyncBlock state={activities} onRetry={activities.retry} skeleton={<FormSkeleton fields={4} />}>
        <Level4Table
          rows={level4Rows}
          defaultValue={draft.l4Default}
          repeatEnabled={draft.repeat.enabled}
          repeatDefault={draft.repeat.default}
          levelOff={draft.disabled.includes('level4')}
          storedLevelOff={stored.disabled.includes('level4')}
          onDefaultChange={(v) => patch({ l4Default: v })}
          onLevelChange={({ off }) => setOff('level4', off)}
          onRowChange={rowChange}
          activitiesDenied={activitiesDenied}
          disabled={locked}
        />
      </AsyncBlock>

      {/* ── 6b. How often each level pays ──────────────────────────────────
          Directly under the four level cards, because it is the setting that decides what the
          numbers on them are worth in a day: a "200" three cards up means 200 a day or 1000 a day
          depending on this control, and a card placed anywhere else would be read after the
          decision it changes rather than beside it. */}
      <EarningModeCard
        levels={levelList}
        earn={draft.earn}
        storedEarn={stored.earn}
        values={earnValues}
        tick={draft.tick}
        switchedOff={draft.disabled}
        onChange={patchEarn}
        disabled={locked}
      />

      {/* ── 7. Repeat rules ────────────────────────────────────────────── */}
      <RepeatCard
        enabled={draft.repeat.enabled}
        defaultValue={draft.repeat.default}
        dailyLimit={draft.repeat.dailyLimit}
        storedEnabled={stored.repeat.enabled}
        onChange={patchRepeat}
        disabled={locked}
      />

      {/* ── 9. Save ────────────────────────────────────────────────────────
          Before the manual adjustment rather than after it, because it belongs to the seven
          sections above: everything from Global to Repeat is one rule set saved by one button,
          and a Save sitting below a form that writes a ledger row would read as saving that too. */}
      <div className="card pts-savebar">
        <RuleError>{ruleError}</RuleError>
        <div className="form-actions">
          {/* Nothing to save, or nothing that may be saved. A button that is offered and then
              refuses is worse than one that is plainly not available yet: the message above says
              which field is in the way, and it says it beside the rule that named the bound. */}
          <button
            className={`btn${busy ? ' is-busy' : ''}`}
            type="button"
            onClick={save}
            disabled={locked || !changed || !!problem}
          >
            {busy ? 'Saving…' : 'Save point rules'}
          </button>
          {msg && (
            <span
              className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
              role={msg.tone === 'ok' ? 'status' : 'alert'}
            >
              {msg.text}
            </span>
          )}
          {msg?.tone === 'danger' && (
            <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
              Try again
            </button>
          )}
          {!msg && (
            <span className="hint">
              {!changed
                ? 'Nothing has changed yet.'
                : problem
                  ? 'Put right what is written above, and this will save.'
                  : 'One save for every rule above. Nothing already earned is changed by it.'}
            </span>
          )}
        </div>
      </div>

      {/* ── 10. Bonuses and milestones ─────────────────────────────────────
          Below the save bar, with the manual adjustment, and for the same reason that one is:
          everything above the bar is one rule set stored by one button, and everything below it
          writes on its own the moment its own form is submitted. Putting the bonuses above would
          make the Save button look like the thing that stores them, which is the one mistake the
          layout of this page can cause. */}
      <BonusRulesCard
        mayEdit={mayEdit}
        levels={levelList}
        level4Activities={activityList}
        activitiesDenied={activitiesDenied}
      />

      {/* ── 8. Manual adjustment ───────────────────────────────────────── */}
      <ManualAdjustCard mayEdit={mayEdit} onAwarded={overview.retry} />

      {/* ── 11. Configuration history ──────────────────────────────────────
          Read only - it has no control that could write anything - so it could sit either side of
          the save bar. Below it, with the two sections that write on their own, because that is
          the placement that cannot be misread: everything above the bar is one rule set stored by
          one button, and a card up there is a card the Save button appears to be responsible for.

          Last on the page rather than directly under the bar, because it is the record of what was
          already decided and everything above it is the deciding. It answers "why was this old
          award 200 when the box above says 250", which is a question a સંચાલક asks *after* reading
          the boxes rather than instead of them. */}
      <ConfigHistoryCard />
    </>
  );
}

const PAGE_SUB =
  'Every point value, rule and limit the engine reads. Changes apply from now on and never rewrite what anybody has already earned.';

/* ---------------------------------------------------------------------------
 * The refusal that is not an error
 * ------------------------------------------------------------------------- */

/**
 * `{ value }` when the read succeeded, `{ denied: true }` when the caller may not make it.
 *
 * Only 42501 is turned into data. Every other failure - a missing migration, a dead network, an
 * expired session - still throws and still becomes an ErrorState, because those are conditions
 * the page must not paint over.
 */
async function allowDenied(promise) {
  try {
    return { value: await promise };
  } catch (e) {
    if (isPermissionDenied(e)) return { denied: true };
    throw e;
  }
}

/* ---------------------------------------------------------------------------
 * The form's shape, and the stored object's
 * ------------------------------------------------------------------------- */

/** The keys this page renders. Everything else in the stored object is carried untouched. */
const RENDERED = [
  'enabled',
  'level1',
  'level2',
  'level3',
  'level4',
  'version',
  'effectiveFrom',
  'disabled',
  'repeat',
  'tick',
  EARN_KEY,
];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A number → the string a box holds. */
const str = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');

/**
 * A box of digits → a number, and anything else → NaN.
 *
 * Deliberately not `Number(text)`. `Number('')`, `Number(' ')` and `Number(null)` are all 0, and
 * 0 is a real value here ("practised but worth nothing"), so a coercing read would turn a box
 * somebody cleared into a rule saved as free without a word about it. Negatives are not accepted
 * because the floor is 0 everywhere on this page; a leading minus falls to NaN and the shared
 * validator names the bound. NaN is passed through rather than swallowed, because
 * `Number.isFinite(NaN)` is false and that is exactly what the validator tests.
 */
function whole(textValue) {
  const t = String(textValue ?? '').trim();
  return t === '' || !/^\d+$/.test(t) ? NaN : Number(t);
}

/**
 * The stored slice → the form.
 *
 * Read through the **shared resolvers**, never a looser read of this panel's own, for the reason
 * every card on the Settings page gives: the fields have to show what is actually in force,
 * including when the stored value is one this panel would not have written - which is exactly
 * when the difference matters. A `level4` price stored as the string "100" is a price the engine
 * does not pay, and this form shows it as inheriting the default, because that is what a યુવક is
 * actually being paid.
 *
 * `present` records which optional keys the stored object had, so that a key nobody has touched
 * is not added to the row by opening this page. An absent `tick` and a `tick` holding today's
 * defaults award identically, but only one of them is a row somebody edited.
 */
function toDraft(stored) {
  const raw = isObj(stored) ? stored : {};
  const values = resolvePoints(stored);
  const rules = resolvePointRules(stored) || DEFAULT_POINT_RULES;

  const rep = isObj(rules.repeat) ? rules.repeat : {};
  const tick = isObj(rules.tick) ? rules.tick : {};

  /*
    Per-કસોટી repeat prices are stored as code-shaped keys sitting directly inside `repeat`
    (0031:271-280 reads them that way and settings_check_points() refuses anything else), and
    `point_rules()` hands them back gathered into `byCode`. Both shapes are read here, so this
    form is right whichever of the two the shared resolver mirrors - and it writes the flat one,
    which is the only one the database accepts.
  */
  const byCode = {};
  for (const [code, v] of Object.entries(isObj(rep.byCode) ? rep.byCode : {})) {
    if (ACTIVITY_CODE_RE.test(code)) byCode[code] = str(v);
  }
  for (const [code, v] of Object.entries(rep)) {
    if (ACTIVITY_CODE_RE.test(code)) byCode[code] = str(v);
  }

  const l4 = {};
  for (const [code, v] of Object.entries(values.level4 || {})) {
    if (code !== 'default') l4[code] = str(v);
  }

  const unknown = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!RENDERED.includes(k)) unknown[k] = v;
  }

  return {
    unknown,
    present: {
      version: 'version' in raw,
      effectiveFrom: 'effectiveFrom' in raw,
      disabled: 'disabled' in raw,
      repeat: 'repeat' in raw,
      tick: 'tick' in raw,
      [EARN_KEY]: EARN_KEY in raw,
    },

    enabled: values.enabled,
    level1: str(values.level1),
    level2: str(values.level2),
    level3: str(values.level3),
    l4Default: str(values.level4?.default ?? 0),
    l4,

    // Blank rather than '0' when the row carries no version: an empty box stores no key at all,
    // and no key resolves to 0 - the same award, one less thing claimed to have been decided.
    version: 'version' in raw ? str(rules.version) : '',
    effectiveFrom: typeof rules.effectiveFrom === 'string' ? rules.effectiveFrom : '',
    disabled: (Array.isArray(rules.disabled) ? rules.disabled : []).filter((t) => typeof t === 'string'),

    repeat: {
      enabled: rep.enabled === true,
      default: str(rep.default),
      dailyLimit: str(rep.dailyLimit),
      byCode,
    },

    tick: {
      mode: Object.values(TICK_MODE).includes(tick.mode) ? tick.mode : TICK_MODE.ACTIVITY,
      perTick: str(tick.perTick),
      perRevision: str(tick.perRevision),
      dailyCap: str(tick.dailyCap),
    },

    /*
      Read through a resolver like everything else on this form, and for the same reason: a mode
      the engine would not honour - `"every"` in lower case, a key that is not a mode at all -
      resolves to what a યુવક is actually being paid under, which is what this card has to show.
      That is also why nothing validates `earn` before the save: the five values can only be one of
      the accepted words by the time they are here, because that is the only kind of value the
      resolver returns and the only kind the selectors offer.
    */
    earn: resolveEarn(raw),
  };
}

/**
 * The form → the object that would be stored.
 *
 * Three rules, and each of them is load-bearing:
 *
 *   **Unknown top-level keys first**, so a rendered key always wins over a carried one and a
 *   future key an admin added by hand survives this page's save.
 *
 *   **An empty box means no key.** For an optional value that is the same as the default - an
 *   absent `perTick` resolves to 0 exactly as a stored 0 does - so clearing a box removes a
 *   claim rather than making one. The exceptions are the four that must always be written:
 *   `enabled`, the three level values and `level4.default`, where an empty box is an error the
 *   validator names rather than a key to drop.
 *
 *   **`repeat` and `tick` are rebuilt, not merged.** The trigger accepts only its own keys
 *   inside them, so a stray key cannot be carried: keeping it would make every save from this
 *   page refuse. Everything outside those two objects is carried.
 */
function fromDraft(d) {
  const out = { ...d.unknown };

  out.enabled = d.enabled;
  out.level1 = whole(d.level1);
  out.level2 = whole(d.level2);
  out.level3 = whole(d.level3);

  const level4 = { default: whole(d.l4Default) };
  for (const [code, v] of Object.entries(d.l4)) {
    if (String(v).trim() !== '') level4[code] = whole(v);
  }
  out.level4 = level4;

  if (String(d.version).trim() !== '') out.version = whole(d.version);

  // An empty date on a row that carries the key is written as an explicit null, which is what
  // "no start date" means in jsonb and what the trigger allows. On a row that never had the key,
  // it is simply not added.
  if (d.effectiveFrom) out.effectiveFrom = d.effectiveFrom;
  else if (d.present.effectiveFrom) out.effectiveFrom = null;

  // Sorted, so that switching a rule off and on again compares equal to what is stored and the
  // Save button does not light up for an edit that changed nothing.
  const off = [...new Set(d.disabled)].sort();
  if (off.length || d.present.disabled) out.disabled = off;

  const repeat = { enabled: d.repeat.enabled };
  if (String(d.repeat.default).trim() !== '') repeat.default = whole(d.repeat.default);
  if (String(d.repeat.dailyLimit).trim() !== '') repeat.dailyLimit = whole(d.repeat.dailyLimit);
  for (const [code, v] of Object.entries(d.repeat.byCode)) {
    if (String(v).trim() !== '') repeat[code] = whole(v);
  }
  if (d.present.repeat || repeat.enabled || Object.keys(repeat).length > 1) out.repeat = repeat;

  const tick = { mode: d.tick.mode };
  if (String(d.tick.perTick).trim() !== '') tick.perTick = whole(d.tick.perTick);
  if (String(d.tick.perRevision).trim() !== '') tick.perRevision = whole(d.tick.perRevision);
  if (String(d.tick.dailyCap).trim() !== '') tick.dailyCap = whole(d.tick.dailyCap);
  if (d.present.tick || tick.mode !== TICK_MODE.ACTIVITY || Object.keys(tick).length > 1) out.tick = tick;

  /*
    `earn` follows `tick`'s rule exactly.

    **Rebuilt, not merged**, because the trigger accepts only its own keys inside it - the four
    levels and the tick-counting mode - so a stray key could not be round-tripped and keeping one
    would make every save from this page refuse.

    **Written only when it says something.** An absent `earn` and one holding the defaults award
    identically, so a page that adds the key just by being opened would file an audit entry for a
    change nobody made (§41). Once the key exists it is kept, because removing it on the way back
    to the defaults is a second way of saying the same thing and a diff nobody asked for.
  */
  const earn = { ...d.earn };
  if (d.present[EARN_KEY] || !isDefaultEarn(earn)) out[EARN_KEY] = earn;

  return out;
}

/**
 * What is wrong with this candidate, in the shared modules' own words, or ''.
 *
 * The two validators halve the object between them and neither will report the other's half:
 * `validatePoints()` is `settings_check_points()`'s 0021 body (enabled, the three level values,
 * the Level 4 map) and `validatePointRules()` is its 0031 body (version, start date, switched-off
 * list, repeat, tick). Calling one and not the other would let half a malformed row reach the
 * database and come back as a refusal the form never mentioned.
 *
 * The values half is asked first, because it is the half a સંચાલક is most likely to be in the
 * middle of typing and the more specific message of the two.
 */
function rulesProblem(candidate) {
  const values = validatePoints(candidate);
  if (!values.ok) return values.gu;
  const rules = validatePointRules(candidate);
  if (!rules.ok) return rules.gu;
  return '';
}
