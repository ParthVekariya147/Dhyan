import { Navigate, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../lib/adminAuth';
import { PageLoading } from '../components/StateBlocks';
import { NOT_ADMIN } from '../lib/errors';

/**
 * §11 — the three outcomes.
 *
 *   not signed in            → the admin login page
 *   signed in, not a સંચાલક  → "તમને Admin Panel માટે પરવાનગી નથી."
 *   signed in and authorised → the panel
 *
 * This guard decides what renders. It does not decide what the database returns: a
 * yuvak who edits this component out of his own copy of the bundle still gets an empty
 * result from every query, because the RLS policies are the enforcement (§65).
 *
 * "Authorised" here means *any* role. Which sections that role then reaches is decided by
 * RequirePermission on each route, per action by `can()` from useAdminAuth, and per row by
 * `has_permission()` inside the policies.
 */
export default function RequireAdmin({ children }) {
  const { status, user, logout, unconfigured, error, recheck } = useAdminAuth();
  const loc = useLocation();

  if (unconfigured) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Admin Panel</h1>
          <p className="gate-msg">
            Supabase is not configured. Add VITE_SUPABASE_URL and
            VITE_SUPABASE_PUBLISHABLE_KEY to <code>.env.local</code> and build again.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'loading') return <PageLoading />;

  if (status === 'anon') {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  if (status === 'denied') {
    return (
      <div className="gate">
        <div className="gate-card">
          {/*
            Two ways to reach 'denied', and they are not the same sentence. effective_role()
            answering null is settled: the person is a યુવક, retrying changes nothing, and
            the only move left is a different account. A check that could not be completed —
            the RPC failed, or the session could not be read at all — refuses just as firmly,
            because the gate fails closed, but telling a real સંચાલક he has no permission
            when the network dropped mid-call sends him to ask for access he already holds
            (§12, §53). It is also the case that used to leave him on a spinner with nothing
            to press, so the retry is the point of saying it separately.
          */}
          <h1>{error ? 'Could not check permission' : 'No permission'}</h1>
          <p className="gate-msg">{error || NOT_ADMIN}</p>
          <p className="gate-sub">{user?.email}</p>
          {error ? (
            <>
              <button className="btn" type="button" onClick={recheck}>
                Try again
              </button>
              <p className="gate-foot">
                <button className="linklike" type="button" onClick={logout}>
                  Log in with a different account
                </button>
              </p>
            </>
          ) : (
            <button className="btn" type="button" onClick={logout}>
              Log in with a different account
            </button>
          )}
        </div>
      </div>
    );
  }

  return children;
}
