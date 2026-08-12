import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { loadDarshanHealth } from '../services/darshanService';
import { AsyncBlock, Empty } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import { gu } from '../../../lib/format';

/**
 * §29 — content health, run for real.
 *
 * Nothing on this page is decorative. Every check is executed by
 * shared/domain/darshan.js over the actual records: duplicate id, duplicate index,
 * duplicate order, gapped numbering, missing image, missing dimensions, missing delivery
 * variants, missing વર્ણન. A hand-typed "Valid: 109 / Missing: 0" would be worse than no
 * page at all, so every figure here is counted from the manifest as it stands.
 *
 * There is no expected-total constant (§62). The manifest is generated from the સંચાલક's
 * sheet, so the dataset is whatever it holds; what the page names instead is the gap that
 * actually blocks the product — images that exist but have no વર્ણન written, which is why
 * the app teaches fewer scenes than there are files.
 */
export default function DarshanHealthPage() {
  const state = useAsync(() => loadDarshanHealth(), []);
  const report = state.data?.report;
  const issues = report?.issues || [];

  return (
    <>
      <PageHeader
        title="Darshan Health"
        sub="Every figure is actually counted — none of them are sample numbers"
        actions={<Link className="btn btn-quiet" to="/darshan">← Darshan</Link>}
      />

      <AsyncBlock state={state} onRetry={state.retry}>
        <>
          <div className="grid-stats">
            <StatCard label="Total Images" value={gu(report.total)} />
            <StatCard label="Ready to learn" value={gu(report.active)} tone="ok" />
            <StatCard
              label="Description pending"
              value={gu(report.missingCaptions)}
              tone={report.missingCaptions ? 'warn' : 'ok'}
            />
            <StatCard
              label="With issues"
              value={gu(report.invalid)}
              tone={report.invalid ? 'danger' : 'ok'}
            />
          </div>

          {!!report.missingCaptions && (
            <div className="card">
              <div className="notice notice-warn">
                {gu(report.total)} images are ready, but descriptions for {gu(report.missingCaptions)}{' '}
                of them have not been written yet — so users can currently learn only{' '}
                {gu(report.active)} Darshan. Once the descriptions are filled in they will be added
                automatically; nothing in the code needs to change.
              </div>
            </div>
          )}

          {!!report.missingIndexes.length && (
            <div className="card">
              <div className="notice notice-danger">
                There are gaps in the numbering — {gu(report.missingIndexes.length)} numbers are
                missing (highest number{' '}
                {gu(report.highestIndex)}). This usually happens when a row is left out of the sheet.
              </div>
            </div>
          )}

          <div className="card">
            <h2>Check results</h2>
            {issues.length === 0 ? (
              <Empty message="No issues found. All Darshan are fine." />
            ) : (
              <ul className="issue-list">
                {issues.map((i, n) => (
                  <li className={`issue issue-${i.severity}`} key={`${i.code}-${i.id}-${n}`}>
                    {/* Severity is spelled out, not only coloured (§56). */}
                    <strong>{i.severity === 'error' ? 'Error' : 'Warning'}</strong>
                    <span>
                      {i.id ? <Link to={`/darshan/${i.id}`}>{i.id}</Link> : <span className="mono">—</span>} ·{' '}
                      {i.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="card-note">
              What is checked: duplicate ID and number · gaps in the numbering · missing image ·
              missing dimensions · missing AVIF/WebP variant · description not written · wrong order.
            </p>
          </div>
        </>
      </AsyncBlock>
    </>
  );
}
