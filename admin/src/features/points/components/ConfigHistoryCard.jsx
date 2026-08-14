import { useMemo } from 'react';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import { StatusBadge } from '../../../components/StatCard';
import { useAsync } from '../../../lib/useAsync';
import { dateGu, gu } from '../../../lib/format';
import { configVersions, describeChange } from '../services/dailyRecordService';

/**
 * Configuration history - which point values were in force, and when.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The one question this card exists to answer
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "Why was this award 200 when the setting says 250?"
 *
 * Before `point_config_versions` there was no answer to that. `point_transactions.rule_version`
 * stamped a bare integer that **pointed at nothing** - no table mapped a version to the document
 * that produced it, and the only way to reconstruct an old configuration was to replay
 * `audit_logs` jsonb by timestamp (docs/DAILY_RECORD_ARCHITECTURE.md §5.4). This card is the
 * other end of that pointer: every version, the window it was live for, and the values it held.
 *
 * So the layout is built around that question rather than around the table's convenience. The
 * window comes before the values, because a reader arrives holding a *date* - the day the award
 * was made - and scans down until he finds the row that contains it. The values sit beside it in
 * one cell, at a size somebody compares numbers at. "What changed" is last, because it is the
 * summary of a row he has already found rather than the way in to finding it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Changing a value never rewrites an award already made
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Said on the card, at the top, in plain words - not left to be inferred from the presence of a
 * history. `point_transactions` has one INSERT site, no UPDATE path and no DELETE path, so an
 * award written under an old version stays exactly as it was written. A sanchalak reading a
 * history of edits will otherwise reasonably wonder whether raising a value backdated anything,
 * and the answer to that has to be on the same screen as the thing that prompts it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Read only, and it is mounted below the save bar
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This card writes nothing and has no control that could. It sits below Point Management's save
 * bar with the sections that write on their own, rather than above it with the seven the Save
 * button stores: everything above that bar is one rule set saved by one button, and a card that
 * looked like those seven and was not saved by that button is the one mistake this page's layout
 * has to prevent. A read-only card could sit either side; below is the reading that cannot be
 * misread.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three outcomes, and only one of them is an error
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   no history yet   The migration that creates `point_config_versions` has not been applied
 *                    here. A deployment state, not a failure - an ErrorState with a Try again
 *                    would invite a retry that cannot succeed until somebody deploys. Same idiom
 *                    as the bonus card above.
 *   refused          42501, raised by name. A CONTENT_MANAGER holds `settings.read`, reaches
 *                    this page legitimately and may not read the ledger side of it. The card
 *                    says so and the rest of the page is untouched.
 *   anything else    Still an ErrorState with a Try again, because those are conditions this
 *                    card must not paint over.
 */
export default function ConfigHistoryCard() {
  const list = useAsync(() => configVersions(), []);

  const denied = list.data?.denied === true;
  const missing = list.data?.missing === true;
  const source = list.data?.source || '';

  /**
   * The versions, newest first, each carrying what it changed from the one before it.
   *
   * The predecessor is the *next* row in the list because the list is newest first, and the
   * oldest row has none - `describeChange()` answers with an empty array there and the cell says
   * "the earliest recorded configuration" rather than "nothing changed", because those are
   * different claims and only one of them is true.
   *
   * `key` is built from the id, or from the start of its window when the row has no id: the
   * table fallback selects whatever columns the table has, and a history whose rows collapsed
   * into one because two of them keyed on `undefined` would be a silent loss of exactly the
   * evidence this card exists to show.
   */
  const rows = useMemo(() => {
    const versions = list.data?.versions || [];
    return versions.map((v, i) => ({
      ...v,
      key: v.id != null ? `v${v.id}` : `v${v.effectiveFrom || ''}|${v.version ?? ''}|${i}`,
      changes: describeChange(v, versions[i + 1] || null),
      // The oldest row in *this read* is not necessarily the oldest that exists - the read is
      // capped - so "earliest" is only claimed for a row that genuinely has no predecessor here
      // and the note under the table says the list is capped.
      earliest: i === versions.length - 1,
      // A null `effective_until` is the whole answer to "which one is live", so it is read as
      // that rather than compared against this browser's clock.
      live: !v.effectiveUntil,
    }));
  }, [list.data]);

  const columns = useMemo(
    () => [
      {
        key: 'version',
        className: 'pts-cfg-c-version',
        label: 'Version',
        // The number `point_transactions.rule_version` stamps. It is the join between an award
        // and this row, so it is the first column even though the date is what a reader scans.
        render: (r) => (
          <span className="pts-cfg-version">
            <span className="mono">{r.version == null ? '-' : gu(r.version)}</span>
            {r.live ? <StatusBadge tone="ok">In force now</StatusBadge> : null}
          </span>
        ),
      },
      {
        key: 'window',
        className: 'pts-cfg-c-window',
        label: 'In force',
        /*
          One cell and not two columns. A reader is matching a single date against a range, and a
          range split across two columns is one he has to reassemble in his head on every row.

          "onwards" rather than a computed end date: the row is live and the server has not
          written an end for it, and inventing "to today" would put a bound on it that nothing in
          the database claims.
        */
        render: (r) => (
          <span className="mono">
            {dateGu(r.effectiveFrom)}
            {' - '}
            {r.effectiveUntil ? dateGu(r.effectiveUntil) : 'onwards'}
          </span>
        ),
      },
      {
        key: 'values',
        className: 'pts-cfg-c-values',
        label: 'What each level was worth',
        /*
          Read through `resolvePoints()` in the service, not off the raw snapshot - so the figures
          here are what a yuvak was actually *paid* under that version. A level value stored in a
          shape the engine does not honour resolves to 0 and shows as 0, which is the honest
          answer and precisely the case somebody opens this card to investigate.
        */
        render: (r) => {
          const v = r.values || {};
          if (!v.enabled) {
            return (
              <span className="pts-cfg-values">
                <StatusBadge tone="off">Points switched off</StatusBadge>
                <span className="hint">Every activity was worth 0 while this was in force</span>
              </span>
            );
          }
          const l4 = v.level4 || {};
          // Only the count of priced tests, not the list. Twenty codes in a table cell is a cell
          // nobody reads; the number says whether there were any, and the snapshot behind it is
          // what the ledger's own rule version points at.
          const priced = Object.keys(l4).filter((k) => k !== 'default').length;
          return (
            <span className="pts-cfg-values mono">
              L1 {gu(v.level1)} · L2 {gu(v.level2)} · L3 {gu(v.level3)} · L4 {gu(l4.default ?? 0)}
              {priced > 0 ? (
                <span className="hint">
                  {gu(priced)} test{priced === 1 ? '' : 's'} priced on their own
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        key: 'who',
        label: 'Changed by',
        // Blank where the snapshot was written by a migration or by somebody talking to the
        // database directly. A dash says "nobody was recorded", which is different from a name
        // this card could have guessed at.
        render: (r) => (r.changedByName ? r.changedByName : <span className="mono">-</span>),
      },
      {
        key: 'changes',
        className: 'pts-cfg-c-changes',
        label: 'What changed',
        /*
          Computed from the two snapshots rather than read from a stored summary - the snapshots
          are the record, and a stored diff would be a second description of the same fact that
          could disagree with it. A version that changed nothing this card can see is stated as
          such rather than left blank: an empty cell reads as data that failed to load.
        */
        render: (r) => {
          if (r.earliest) return <span className="hint">The earliest configuration recorded here</span>;
          if (!r.changes.length) return <span className="hint">No change to any point value</span>;
          return (
            <ul className="pts-cfg-changes">
              {r.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          );
        },
      },
    ],
    []
  );

  return (
    <section className="card" aria-labelledby="pts-cfg-head">
      <h2 id="pts-cfg-head">Configuration history</h2>

      <p className="card-note pts-cfg-lead">
        Every version of the point values above, and the window each was in force for.{' '}
        <strong>Changing a value never rewrites an award already made.</strong> An award keeps the
        rule version that paid it, so a day worth 200 under an older version stays worth 200 after
        the setting is raised to 250 - this table is where that older version can be read. Nothing
        here can be edited or removed.
      </p>

      {missing && (
        <div className="notice notice-warn" role="status">
          This database keeps no configuration history yet - the migration that records each
          version has not been applied here. Every rule above is still in force exactly as it
          reads, and no award is affected; there is simply nothing to look back through until it
          is deployed.
        </div>
      )}

      {denied && (
        <div className="notice" role="status">
          The configuration history is hidden: reading it needs the <strong>progress.read</strong>{' '}
          permission. Every rule above is still yours to read and change.
        </div>
      )}

      {!missing && !denied && (
        <AsyncBlock
          state={{ ...list, isEmpty: !list.loading && !list.error && rows.length === 0 }}
          emptyIcon="◷"
          emptyTitle="No version has been recorded yet"
          empty="The history fills in as the point values above are saved. It is also empty when the history exists but this account may not read it - an RLS refusal on a table answers with no rows rather than with an error."
          onRetry={list.retry}
          skeleton={<TableSkeleton rows={3} cols={5} />}
        >
          <>
            <DataTable
              caption="Point configuration versions, newest first"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.key}
            />
            <p className="card-note">
              {gu(rows.length)} version{rows.length === 1 ? '' : 's'}, newest first
              {source === 'table'
                ? ' - read from the version table directly, so the name of whoever made each change may be blank'
                : ''}
              . The list is capped, so a project with a long history shows its most recent
              versions rather than all of them.
            </p>
          </>
        </AsyncBlock>
      )}
    </section>
  );
}
