import { useAdminAuth } from '../lib/adminAuth';
import { NO_SECTION_PERMISSION } from '../lib/errors';
import { roleLabel } from '../../../shared/domain/permissions.js';

/**
 * §10 — the second gate, inside the first.
 *
 * RequireAdmin answers "may this person open the panel at all". This answers "may the role
 * he holds open *this* section", and it exists because filtering the sidebar cannot: a URL
 * typed into the address bar passes no menu. A COORDINATOR who bookmarked /settings, or a
 * CONTENT_MANAGER following a stale link to /users, reached the page exactly as before the
 * links were hidden.
 *
 * What he reached was worse than a refusal. An RLS read denial returns an empty result and
 * not an error (the header of admin/src/lib/errors.js sets out why), so the page rendered
 * its ordinary "No changes have been recorded yet" or a count of one over rows the policy
 * had quietly withheld. The panel was answering a question it had not been allowed to ask.
 *
 * Still not the security boundary, and it must not be mistaken for one: `has_permission()`
 * inside the policy on every row read or written is the boundary (§65), and a yuvak who
 * edits this component out of his own copy of the bundle gets the same empty results he
 * would have got anyway. All this decides is that the refusal is stated instead of mimed.
 *
 * It renders inside AdminShell's <Outlet>, so the sidebar is still there and the સંચાલક can
 * leave by clicking a section he does hold — no "go back" link is needed, and inventing one
 * would mean guessing which section that is in two places.
 */
export default function RequirePermission({ need, children }) {
  const { can, role } = useAdminAuth();

  if (!can(need)) {
    return (
      <div className="state state-error" role="alert">
        {/* A refusal is not a failure, so it does not borrow ErrorState's warning styling
            or its "Something went wrong" title — nothing went wrong. It is a locked door
            with a label, and there is deliberately no retry: pressing it would ask the
            same question and get the same answer. */}
        <span className="state-icon" aria-hidden="true">🔒</span>
        <p className="state-title">This section is not open to your role</p>
        <p>{NO_SECTION_PERMISSION}</p>
        {/* Which role is refusing, because "no permission" with no subject leaves the
            person nothing to quote when he asks the SUPER_ADMIN for the access. */}
        <p className="hint">Your role: {roleLabel(role)}</p>
      </div>
    );
  }

  return children;
}
