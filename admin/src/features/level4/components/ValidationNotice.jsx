import { gu } from '../../../lib/format';

/**
 * What `validateAssignment()` decided, said out loud.
 *
 * The engine in shared/domain/level4-selection.js owns every rule; this renders its answer
 * and adds nothing to it. That separation is the point — the same function runs on the યુવક
 * side, and a second opinion written into a page is how the two stop agreeing (§7).
 *
 * An **error** blocks publish. A **warning** does not, but it is never dismissed silently:
 * the publish dialog repeats it and asks again. The distinction is the engine's to make.
 *
 * Both texts are shown. The panel reads English (§6 rule 6), so `en` leads; the Gujarati
 * sentence follows because it is the wording the સંચાલક will see quoted if the same rule ever
 * refuses something on the યુવક side, and matching wording is how he knows it is the same rule.
 */
export default function ValidationNotice({ result, collection }) {
  if (!result) return null;
  const errors = result.errors || [];
  const warnings = result.warnings || [];
  if (!errors.length && !warnings.length) {
    return (
      <div className="notice notice-ok" role="status">
        Checked — no problems found in this version.
      </div>
    );
  }

  return (
    <ul className="issue-list" style={{ marginBottom: 12 }}>
      {errors.map((e, i) => (
        <Issue key={`e${i}`} issue={e} tone="error" collection={collection} />
      ))}
      {warnings.map((w, i) => (
        <Issue key={`w${i}`} issue={w} tone="warn" collection={collection} />
      ))}
    </ul>
  );
}

/**
 * A દ્રશ્ય id is `darshan-042`, which nobody thinks in. The number a user sees is what the
 * સંચાલક picked by and what a યુવક is shown, so ids are translated back to that number here
 * — and the list is capped, because "and 400 more" is information and four hundred chips
 * are not.
 *
 * A withheld દ્રશ્ય has no such number, and it is exactly the one most likely to be named in
 * an error: it was in the version before it was withheld. Its chip falls back to the number
 * printed on the artwork, marked `#`, which is the only handle anybody still has on it.
 */
const SHOWN = 14;

function Issue({ issue, tone, collection }) {
  const byId = collection instanceof Map ? collection : null;
  const chipFor = (id) => {
    const item = byId ? byId.get(id) : (collection || []).find((c) => c.id === id);
    if (!item) return { text: id, title: 'This id is not in the collection at all' };
    if (Number.isInteger(item.displayIndex)) return { text: gu(item.displayIndex), title: 'The number users see' };
    const source = Number.isInteger(item.sourceIndex) ? item.sourceIndex : item.index;
    return {
      text: Number.isInteger(source) ? `#${gu(source)}` : id,
      title: 'Withheld, so it has no number users would see — this is the number printed on the artwork',
    };
  };

  const ids = issue.sceneIds || [];
  const keys = issue.activityKeys || [];

  return (
    <li className={`issue issue-${tone}`}>
      <span className="pill" style={{ flex: '0 0 auto' }}>{tone === 'error' ? 'Error' : 'Warning'}</span>
      <div style={{ minWidth: 0 }}>
        <div>{issue.en || issue.gu}</div>
        {issue.gu && issue.gu !== issue.en && <div className="hint">{issue.gu}</div>}

        {!!keys.length && <div className="hint">Sub-levels: {keys.join(', ')}</div>}

        {!!ids.length && (
          <div className="l4-chips" style={{ marginTop: 6 }}>
            {ids.slice(0, SHOWN).map((id) => {
              const chip = chipFor(id);
              return (
                <span className="l4-chip" key={id} title={chip.title}>{chip.text}</span>
              );
            })}
            {ids.length > SHOWN && <span className="hint">+{gu(ids.length - SHOWN)} more</span>}
          </div>
        )}
      </div>
    </li>
  );
}
