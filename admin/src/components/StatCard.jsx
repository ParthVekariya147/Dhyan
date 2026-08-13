import { Link } from 'react-router-dom';
import { gu } from '../lib/format';

/**
 * One number, one label. `tone` is a hint, never the only signal — the word next to the
 * number says the same thing the colour does (§43, §56).
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
export const guCount = (n) => (n == null ? '-' : gu(n));

/**
 * §12 — the one page header in the panel.
 *
 * Title, one line saying what the page is for, and the primary action. Every page uses
 * this rather than assembling its own, because a header that differs per page is the
 * fastest way for a console to stop feeling like one product.
 *
 * `crumbs` is optional and only earns its place on a detail page, where the way back up
 * is not otherwise on screen: [{ to: '/darshan', label: 'Darshan' }, { label: '૧૨' }].
 * The last crumb is the current page and is rendered as text, never as a link to itself.
 */
export function PageHeader({ title, sub, actions, crumbs }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {crumbs?.length > 0 && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`}>
                {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span aria-hidden="true"> / </span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/**
 * §47 — one status badge, so "active" looks the same on every page.
 *
 * `tone` is one of ok | warn | danger | info | off. The label is the meaning; the colour
 * only repeats it, which is what keeps the badge readable to someone who cannot tell the
 * tints apart (§43).
 */
export function StatusBadge({ tone = 'off', children, title }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}
