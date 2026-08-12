import { gu } from '../lib/format';

/**
 * One number, one label. `tone` is a hint, never the only signal — the word next to the
 * number says the same thing the colour does (§56).
 */
export default function StatCard({ label, value, sub, tone = 'plain', loading = false }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{loading ? <span className="sk-cell wide" /> : value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Latin digits in tables, Gujarati digits in prose — see admin/src/lib/format.js. */
export const guCount = (n) => (n == null ? '—' : gu(n));

export function PageHeader({ title, sub, actions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
