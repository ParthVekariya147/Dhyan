import StatCard from '../../../components/StatCard';
import { gu } from '../../../lib/format';

/**
 * Section 1 - what the rules have actually paid, and the reconciliation line.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the legacy figure is on the screen at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `award_kind is null` **is** the definition of a transaction written before the point engine
 * (0031; docs/POINT_SYSTEM_ARCHITECTURE.md §J1). Those rows are never updated, never deleted,
 * never recomputed and never backfilled, so their count and their sum are a pair of numbers that
 * must read the same forever. Printing them beside the new totals is what makes that checkable
 * by the person responsible for it, rather than only by a script nobody runs twice.
 *
 * It is labelled as the historical total and shown plainly - no tone, no trend, no comparison
 * that invites it to be "improved". The only interesting thing about it is that it does not move.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Everything here is read-only, and every figure is the server's
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_points_overview()` sums the ledger in Postgres and returns the answer, not the rows it
 * was computed from. Nothing on this strip is added up in the browser: a total this panel
 * computed would be a second answer to the one question the ledger exists to answer, and the
 * answer that loses is always the one on screen.
 */
export default function OverviewStrip({ overview }) {
  const t = overview.totals;

  return (
    <>
      <div className="grid-stats">
        <StatCard label="Transactions" value={gu(t.transactions)} sub="Every row in the ledger" />
        <StatCard label="Points awarded" value={gu(t.points)} sub="The sum of every row" />
        <StatCard label="Yuvaks who earned" value={gu(t.earners)} sub="At least one transaction" />
        <StatCard
          label="Today"
          value={gu(t.today)}
          sub={`${gu(t.todayRows)} transaction(s) today, India time`}
          tone={t.today > 0 ? 'ok' : 'plain'}
        />
      </div>

      {/*
        The legacy-and-new line, as one sentence with the four figures in it. Two stat cards
        would have read as two measures to compare; this is one measure split at a date, and
        saying it in words is the only way to carry that.
      */}
      <div className="card" style={reconcileCard}>
        <h2 style={sectionHead}>Reconciliation</h2>
        <p className="card-note" style={reconcileLine}>
          <strong>Historical total, before the point engine:</strong>{' '}
          <span className="mono">{gu(t.legacyRows)}</span> transaction(s) worth{' '}
          <span className="mono">{gu(t.legacyPoints)}</span> points. This pair is fixed. Those rows
          are never edited, deleted or recalculated, so these two numbers must read the same on
          every visit - if they ever move, something has written history.
        </p>
        <p className="card-note" style={reconcileLine}>
          <strong>Awarded by the point engine since:</strong>{' '}
          <span className="mono">{gu(t.newRows)}</span> transaction(s) worth{' '}
          <span className="mono">{gu(t.newPoints)}</span> points. Everything the rules below decide
          is counted here.
        </p>

        {/* The two breakdowns, side by side and small. They answer "where did the points come
            from" without a chart: five kinds and four levels is a list, not a graph. */}
        <div style={breakdownRow}>
          <Breakdown
            title="By award kind"
            note="LEGACY is a row from before the engine, not a kind the engine writes."
            rows={overview.byKind.map((k) => ({ key: k.kind, label: KIND_LABEL[k.kind] || k.kind, rows: k.rows, points: k.points }))}
            empty="Nothing has been awarded yet."
          />
          <Breakdown
            title="By level"
            note="Level 0 is a manual adjustment: it belongs to no level, which is what a correction is."
            rows={overview.byLevel.map((l) => ({
              key: String(l.level),
              label: l.level === 0 ? 'Manual adjustment' : `Level ${gu(l.level)}`,
              rows: l.rows,
              points: l.points,
            }))}
            empty="Nothing has been awarded yet."
          />
        </div>
      </div>
    </>
  );
}

/**
 * The five kinds the ledger stores, said in words.
 *
 * The keys are the server's (`point_transactions.award_kind`, plus 'LEGACY' which the function
 * substitutes for a null); a kind with no entry here falls through and prints its own name, so a
 * sixth kind added later is visible rather than blank.
 */
const KIND_LABEL = {
  LEGACY: 'Before the engine',
  DAY_FIRST: 'First award of the day',
  REPEAT: 'Repeat attempt',
  TICK: 'Per tick',
  REVISION: 'Per revision',
  MANUAL: 'Manual adjustment',
};

function Breakdown({ title, note, rows, empty }) {
  // Held in a variable rather than written twice: the heading and the cells' `data-label` are one
  // fact about one column, and a `th` reading "Level" over cells labelled "Kind" would be the two
  // disagreeing about it. That matters more now than when this was a card layout - the labels are
  // what a hide rule selects on, and hiding a `td` without its `th` puts every column after it
  // under the wrong heading.
  const firstCol = title === 'By level' ? 'Level' : 'Kind';
  return (
    <div style={breakdownCol}>
      <h3 style={miniHead}>{title}</h3>
      {rows.length === 0 ? (
        <p className="card-note" style={noTopMargin}>
          {empty}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="dt">
            {/*
              A hand-built table rather than a DataTable, because it is three cells of a summary
              and not a list anybody pages, sorts or exports. It still has to keep DataTable's two
              phone habits, since admin.css styles it by the same `.dt` class: `data-label` on the
              header cells as well as the body ones, and `.is-pin` on the column that says what
              each row is about.

              The pin is the kind or the level. It is the only column here that is not a number:
              two figures with nothing beside them are two figures about nobody, so it is what has
              to stay on screen if this ever scrolls sideways in a narrow card.
            */}
            <thead>
              <tr>
                <th scope="col" className="is-pin" data-label={firstCol}>{firstCol}</th>
                <th scope="col" className="ta-r" data-label="Rows">
                  Rows
                </th>
                <th scope="col" className="ta-r" data-label="Points">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="is-pin" data-label={firstCol}>{r.label}</td>
                  <td className="ta-r mono" data-label="Rows">{gu(r.rows)}</td>
                  <td className="ta-r mono" data-label="Points">{gu(r.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="card-note">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

const reconcileCard = { marginTop: 'var(--sp-4)' };

const sectionHead = { marginBottom: 'var(--sp-2)' };

const reconcileLine = { marginTop: 0, marginBottom: 'var(--sp-3)' };

/** Two lists that become one column as soon as there is no room for two. */
const breakdownRow = {
  display: 'grid',
  gap: 'var(--sp-4)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  marginTop: 'var(--sp-4)',
};

const breakdownCol = { minWidth: 0 };

const miniHead = {
  fontSize: 'var(--fs-label)',
  fontWeight: 'var(--fw-semi)',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 'var(--sp-2)',
};

const noTopMargin = { marginTop: 0 };
