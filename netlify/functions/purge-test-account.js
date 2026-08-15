/**
 * Finish a purge — delete the auth account behind a test યુવક.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists at all, when the database already does the deleting
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `public.admin_purge_test_account()` (0040) removes the profile and, by cascade, every point
 * transaction, daily record, attempt, revision and progress row behind it. That is all of the
 * application's data and it is where the whole safety argument lives: the function refuses
 * unless the caller holds `users.purge` AND the row is already marked `is_test`, so a real
 * યુવક cannot be reached by it at all.
 *
 * What it cannot do is delete the `auth.users` row. That table belongs to GoTrue, in a schema
 * this application does not own, and reaching across to delete from it inside a SECURITY
 * DEFINER function is the sort of thing that works on one project and answers `permission
 * denied` on the next — discovered in production, halfway through a delete.
 *
 * Left alone, the leftover is not harmless. The credential still works: the address can still
 * sign in, and `src/lib/auth.jsx` would treat it as a registered user with no profile — the
 * unregistered state, from which it can register again and take a fresh place in everybody's
 * numbers. "Purged" has to mean the account is gone.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The order is the design
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   1. RPC with the CALLER'S OWN token. Every rule is checked here, by the database, against
 *      the person actually signed in: the permission, the is_test guard, and the audit row that
 *      is written before the data goes. If this refuses, nothing has happened.
 *   2. Delete the auth account with the secret key, and only if step 1 returned.
 *
 * Never the other way round, and never both with the secret key. With the secret key
 * `auth.uid()` is null, so `has_permission()` is null, so the RPC's own guard would refuse —
 * but if it did not, this endpoint would be a way for any signed-in caller to delete any
 * account at all. Forwarding the caller's token means the database answers the question it
 * already knows how to answer, and this function only does the part it uniquely can.
 *
 * If step 2 fails after step 1 succeeded, the caller is told exactly that: the data is gone and
 * the login is not. It is reported rather than retried, because the fix is a person opening the
 * Supabase dashboard, and a silent 200 would leave a working credential nobody knows about.
 *
 * Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY — the same three
 * create-admin.js needs, for the same reason: one step acts as the server and one as the person.
 */

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { code: 'bad-request', gu: 'ખોટી રીત.' });

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !secret || !publishable) {
    return reply(503, { code: 'setup-incomplete', gu: 'આ સુવિધા હજુ ચાલુ થઈ નથી.' });
  }

  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return reply(401, { code: 'not-authenticated', gu: 'ફરી લોગિન કરો.' });
  }

  let userId;
  try {
    ({ userId } = JSON.parse(event.body || '{}'));
  } catch {
    return reply(400, { code: 'bad-request', gu: 'વિગત બરાબર નથી.' });
  }
  if (!UUID_RE.test(String(userId || ''))) {
    return reply(400, { code: 'bad-request', gu: 'ખાતું ઓળખાયું નથી.' });
  }

  // The caller's identity, and no secret key in it. Same reasoning as create-admin.js.
  const asCaller = {
    apikey: publishable,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  const asService = {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };

  try {
    // ---------------------------------------------------------------- 1. the data
    const purged = await fetch(`${url}/rest/v1/rpc/admin_purge_test_account`, {
      method: 'POST',
      headers: asCaller,
      body: JSON.stringify({ p_user: userId }),
    });

    if (purged.status === 401) {
      return reply(401, { code: 'not-authenticated', gu: 'ફરી લોગિન કરો.' });
    }

    if (!purged.ok) {
      const err = await purged.json().catch(() => ({}));
      const message = String(err?.message || '');

      // 42501 is the permission check, P0001 the is_test guard, P0002 no such row. Each is a
      // different answer to the person and none of them is "something went wrong".
      if (/not permitted/i.test(message)) {
        return reply(403, { code: 'not-permitted', gu: 'આ ખાતું કાઢવાની પરવાનગી નથી.', detail: message });
      }
      if (/only a test account/i.test(message)) {
        return reply(409, { code: 'not-a-test-account', gu: 'આ ટેસ્ટ ખાતું નથી.', detail: message });
      }
      if (/no such account/i.test(message)) {
        return reply(404, { code: 'no-such-account', gu: 'ખાતું મળ્યું નથી.', detail: message });
      }
      throw new Error(`purge rpc failed: ${purged.status} ${message}`);
    }

    const summary = await purged.json();

    // ---------------------------------------------------------------- 2. the credential
    const gone = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: asService,
    });

    if (!gone.ok && gone.status !== 404) {
      // 404 is success by another name: no auth row to remove. Anything else is the half-done
      // state, and it is reported as such rather than dressed up as a failure — the data really
      // is gone, and pretending otherwise would have somebody try again against nothing.
      console.error(`purge-test-account: data purged but auth user ${userId} remains: ${gone.status}`);
      return reply(207, {
        code: 'auth-account-remains',
        gu: 'માહિતી કાઢી નાખી, પણ લોગિન ખાતું બાકી છે.',
        summary,
      });
    }

    return reply(200, { ...summary, authDeleted: true });
  } catch (e) {
    console.error('purge-test-account failed:', e);
    return reply(500, { code: 'server-error', gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' });
  }
};
