import { useMemo, useState } from 'react';
import DataTable from '../../../components/DataTable';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { RuleCard } from './RuleFields';
import { StatusBadge } from '../../../components/StatCard';
import { useAsync } from '../../../lib/useAsync';
import { gu } from '../../../lib/format';
import { REWARD_MODE, TRIGGER, deleteBonusRule, getBonusRules, saveBonusRule } from '../services/bonusService';
import { pointsSaveError } from '../services/pointsService';
import BonusRuleDialog, { ModePreview } from './BonusRuleDialog';

/**
 * Bonuses and milestones - the rules that pay on top of an ordinary award.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This section does not belong to the page's Save button, and it says so twice
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every other card on this page edits one settings row and is written by one Save. A bonus rule is
 * a row of `point_bonus_rules` written by `admin_bonus_rule_save()` the moment the dialog's button
 * is pressed. The two are one screen apart and look alike, so the difference is stated in the
 * badge, in the introduction, in the dialog, and in the sentence under the table - a સંચાલક who
 * adds a bonus, presses Save out of habit, sees "Saved" and assumes the bonus went with it has
 * been told nothing false by any one of those, but he would have been by their absence.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Deleting stops a rule. It does not take anything back
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `point_transactions` has no update policy and no delete grant anywhere in this panel, so every
 * bonus a rule has already paid stays in the ledger, in every total and on every leaderboard.
 * "Delete" is a word an admin reasonably reads as "undo", which is why the confirmation says the
 * opposite in as many words and prints how many awards are affected.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three reads, and only one of them is an error
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   the rules      `admin_bonus_rules()` asserts a *progress reader* - `progress.read` and
 *                  `users.read` - because it counts what each rule has paid. A CONTENT_MANAGER
 *                  holds `settings.read`, reaches this page legitimately and is refused it. The
 *                  card then keeps the editor and drops the list, exactly as the Level 4 card
 *                  does for `admin_point_activities()`.
 *   no engine yet  Until the migration is applied the three functions do not exist. That is a
 *                  deployment state, not a failure, and an ErrorState with a Try again would be
 *                  telling him to retry something that cannot succeed until somebody deploys.
 *   anything else  Still an ErrorState with a Try again, because those are conditions this card
 *                  must not paint over.
 */
export default function BonusRulesCard({ mayEdit, levels, level4Activities, activitiesDenied }) {
  const list = useAsync(() => getBonusRules(), []);

  const [editing, setEditing] = useState(null); // { rule } while the dialog is open
  const [removing, setRemoving] = useState(null); // the rule awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [msg, setMsg] = useState(null);

  const rules = list.data?.rules || [];
  const denied = list.data?.denied === true;
  const missing = list.data?.missing === true;

  /*
    The rules the mode table is drawn from: the biggest set that share a scope and a trigger.

    Biggest, because that is where the modes actually disagree - a scope with one rule pays the
    same under HIGHEST_ONLY and FIRST_ONLY, and a table showing that would teach the opposite of
    what this section is for.
  */
  const previewGroup = useMemo(() => largestGroup(rules), [rules]);

  async function save(rule) {
    setBusy(true);
    setDialogError('');
    try {
      await saveBonusRule(rule);
      setEditing(null);
      setMsg({
        tone: 'ok',
        text: rule.id
          ? `Saved. "${rule.name}" pays under the new rule from now on; what it has already paid is unchanged.`
          : `Added. "${rule.name}" starts paying from the next submission that reaches it.`,
      });
      list.retry();
    } catch (e) {
      /*
        The dialog stays open with every box where it is, and the server's own refusal is printed
        inside it. Closing the dialog on a failure would throw away what he typed and put the
        message on a page he can no longer see the fields of (§31).
      */
      setDialogError(pointsSaveError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteBonusRule(removing.id);
      setMsg({
        tone: 'ok',
        text: `Removed. "${removing.name}" pays nothing further. Every bonus it has already paid is still in the ledger.`,
      });
      setRemoving(null);
      list.retry();
    } catch (e) {
      setMsg({ tone: 'danger', text: pointsSaveError(e) });
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Bonus', render: (r) => <span className="pts-bonus-name">{r.name || '-'}</span> },
    { key: 'scope', label: 'Scope', render: (r) => scopeText(r, levels) },
    { key: 'trigger', label: 'Counts', render: (r) => TRIGGER_LABEL[r.trigger] || r.trigger || '-' },
    { key: 'threshold', label: 'At', align: 'right', render: (r) => <span className="mono">{gu(r.threshold)}</span> },
    {
      key: 'points',
      label: 'Bonus',
      align: 'right',
      render: (r) => <span className="mono">{r.points > 0 ? `+${gu(r.points)}` : gu(r.points)}</span>,
    },
    { key: 'mode', label: 'How often', render: (r) => MODE_LABEL[r.mode] || r.mode || '-' },
    {
      key: 'enabled',
      label: 'State',
      render: (r) => (
        <StatusBadge tone={r.enabled ? 'ok' : 'off'}>{r.enabled ? 'Paying' : 'Off'}</StatusBadge>
      ),
    },
    {
      key: 'timesPaid',
      label: 'Times paid',
      align: 'right',
      // A figure that was not sent is printed as unknown, never as 0: "never paid" and "you may
      // not read what it paid" are different facts, and only one of them is a reason to delete.
      render: (r) => <span className="mono">{r.timesPaid === null ? '-' : gu(r.timesPaid)}</span>,
    },
    {
      key: 'yuvaksPaid',
      label: 'Yuvaks paid',
      align: 'right',
      render: (r) => <span className="mono">{r.yuvaksPaid === null ? '-' : gu(r.yuvaksPaid)}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <span className="pts-bonus-actions">
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            onClick={() => {
              setDialogError('');
              setEditing(r);
            }}
            disabled={!mayEdit || busy}
          >
            Edit
          </button>
          <button
            className="btn btn-quiet btn-sm"
            type="button"
            onClick={() => setRemoving(r)}
            disabled={!mayEdit || busy}
          >
            Remove
          </button>
        </span>
      ),
    },
  ];

  return (
    <RuleCard
      id="pts-bonus"
      title="Bonuses and milestones"
      badge="Saved on its own"
      badgeTone="info"
      intro="Extra points paid on top of the ordinary award when a yuvak reaches a count you choose - a tenth darshan, a hundred scenes, a thousand points. Each rule is saved the moment you press the button in its own form; the page's Save button below the level rules does not store any of them."
    >
      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          Adding, changing or removing a bonus needs the <strong>settings.update</strong> permission
          - the same one that decides what a level is worth. The rules are shown so you can see
          what is in force.
        </div>
      )}

      {missing && (
        <div className="notice notice-warn" role="status">
          This database has no bonus engine yet - the migration that creates the rules has not been
          applied here. Everything else on this page works as it always has, and no yuvak is
          affected.
        </div>
      )}

      {denied && (
        /*
          The list and the two usage figures come from the same call, so a refusal takes both. The
          editor is left alone because writing a rule needs `settings.update` and nothing else -
          this role may configure a bonus, it simply may not read what the ledger has paid under
          one.
        */
        <div className="notice notice-warn" role="status">
          The configured bonuses could not be read: the list, and the figures for what each rule has
          paid, need the <strong>progress.read</strong> and <strong>users.read</strong>{' '}
          permissions. You can still add a bonus below.
        </div>
      )}

      {!missing && !denied && (
        <AsyncBlock state={list} onRetry={list.retry} skeleton={<TableSkeleton rows={3} cols={6} />}>
          {rules.length === 0 ? (
            <p className="card-note">
              No bonus is configured, so nothing is paid beyond the ordinary award for each level.
            </p>
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rules}
                rowKey={(r) => r.id}
                caption="Configured bonus rules, what each pays and what it has paid so far"
              />
              <p className="card-note">
                <strong>Times paid</strong> is how many bonus awards this rule has written, and{' '}
                <strong>Yuvaks paid</strong> how many different people have had one. Both are read
                from the ledger, never computed here.
              </p>
            </>
          )}
        </AsyncBlock>
      )}

      {previewGroup.length > 1 && (
        <div className="pts-bonus-explain">
          <h3 className="pts-bonus-explain-title">What the three ways of paying would do</h3>
          <p className="hint">
            Drawn from the {gu(previewGroup.length)} rules configured on{' '}
            <strong>{scopeText(previewGroup[0], levels)}</strong>. Two of the three modes explain
            themselves; the third is the reason this table is here - under{' '}
            <strong>only the highest threshold reached</strong>, the smaller rules a yuvak has
            already passed stop paying altogether.
          </p>
          <ModePreview
            rules={previewGroup}
            unit={TRIGGER_UNIT[previewGroup[0].trigger] || 'times'}
            id="pts-bonus-list-preview"
          />
        </div>
      )}

      <div className="form-actions">
        <button
          className="btn"
          type="button"
          onClick={() => {
            setDialogError('');
            setEditing({});
          }}
          disabled={!mayEdit || busy || missing}
        >
          Add a bonus
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {!msg && (
          <span className="hint">
            Each bonus is stored on its own, as soon as its form is submitted.
          </span>
        )}
      </div>

      <BonusRuleDialog
        open={editing !== null}
        rule={editing}
        levels={levels}
        level4Activities={level4Activities}
        activitiesDenied={activitiesDenied}
        siblings={rules}
        busy={busy}
        serverError={dialogError}
        onSave={save}
        onCancel={() => {
          if (busy) return;
          setEditing(null);
          setDialogError('');
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Remove this bonus?"
        body={
          <>
            <p>
              <strong>{removing?.name}</strong> stops paying immediately. Nothing else on this page
              changes.
            </p>
            <p>
              {/* The one sentence this dialog exists for. It is stated whether or not the figures
                  could be read, because the fact does not depend on being able to count them. */}
              Every bonus it has already paid stays exactly where it is. The ledger is only ever
              added to - no award is removed by this, no total goes down, and no leaderboard
              position moves.
              {removing?.timesPaid !== null && removing?.timesPaid > 0 && (
                <>
                  {' '}
                  It has paid <strong>{gu(removing.timesPaid)}</strong> times
                  {removing?.yuvaksPaid !== null && removing?.yuvaksPaid > 0
                    ? ` to ${gu(removing.yuvaksPaid)} yuvaks`
                    : ''}
                  , and all of those awards stay.
                </>
              )}
            </p>
            <p>
              To stop it paying without removing the rule, switch it off in its own form instead -
              the rule is then kept, and can be switched back on.
            </p>
          </>
        }
        confirmLabel="Yes, remove it"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => {
          if (!busy) setRemoving(null);
        }}
      />
    </RuleCard>
  );
}

/* ---------------------------------------------------------------------------
 * The words the table is read in
 * ------------------------------------------------------------------------- */

const TRIGGER_LABEL = {
  [TRIGGER.COMPLETION_COUNT]: 'Completions',
  [TRIGGER.ITEM_COUNT]: 'Items',
  [TRIGGER.POINT_TOTAL]: 'Points earned',
};

const TRIGGER_UNIT = {
  [TRIGGER.COMPLETION_COUNT]: 'completions',
  [TRIGGER.ITEM_COUNT]: 'items',
  [TRIGGER.POINT_TOTAL]: 'points',
};

const MODE_LABEL = {
  [REWARD_MODE.EVERY]: 'Every time',
  [REWARD_MODE.FIRST_ONLY]: 'First time only',
  [REWARD_MODE.HIGHEST_ONLY]: 'Highest reached only',
};

/**
 * A rule's scope in words, with the level named by the configuration rather than by this file.
 *
 * A stored level id the level list no longer carries is printed as the number it is - the rule
 * still exists and is still counted by the engine, so hiding it behind a dash would be this panel
 * describing the configuration inaccurately.
 */
function scopeText(rule, levels) {
  if (!Number.isInteger(rule?.levelId)) return 'Every level';
  const level = levels.find((l) => l.levelId === rule.levelId);
  const levelName = level?.name ? `Level ${rule.levelId} - ${level.name}` : `Level ${rule.levelId}`;
  return rule.activityKey ? `${levelName}, ${rule.activityKey}` : levelName;
}

/** The rules that share one scope and one trigger, and are therefore the set a mode compares. */
function largestGroup(rules) {
  const groups = new Map();
  for (const r of rules) {
    const key = `${r.levelId ?? 'any'}|${r.activityKey ?? 'all'}|${r.trigger}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.values()].reduce((best, g) => (g.length > best.length ? g : best), []);
}
