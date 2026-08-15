/**
 * Appoint a સંચાલક — create the credential, then let the database decide whether it is allowed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this cannot be done in the browser
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Since 0038 an administrator is a row in `public.admins` keyed by `auth.users.id`. The row is
 * an ordinary insert the panel could make for itself — but the `auth.users` row underneath it
 * is not: creating an account for *somebody else* is the GoTrue admin API, and that needs
 * SUPABASE_SECRET_KEY, which bypasses every RLS policy in the project and must never reach a
 * bundle. So the one privileged step happens here and nothing else does.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The part that matters: who is allowed to do this
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admins_guard()` (0038) enforces the appointment rules — `admins.create`, "only a SUPER_ADMIN
 * may grant SUPER_ADMIN", "an administrator cannot appoint themselves" — and it does so **only
 * when `auth.uid()` is not null**. A migration or the secret key passes straight through, by
 * design, because that is how the first administrator is ever created.
 *
 * Which means: had this function inserted the admins row with the secret key, every one of
 * those rules would have been skipped, and this endpoint would have been a way for any
 * authenticated caller to mint a SUPER_ADMIN. The guard would still have been in the database,
 * still passing its tests, and simply never consulted.
 *
 * So the two steps use two different identities, deliberately:
 *
 *   1. **Create the auth account** — secret key. Gated first by asking the database whether the
 *      *caller* holds `admins.create`, so this is not an open account-creation endpoint.
 *   2. **Insert the admins row** — the CALLER'S OWN access token, forwarded verbatim. RLS and
 *      admins_guard() then apply exactly as they would to a write made from the panel:
 *      auth.uid() is the caller, `created_by` is filled with the caller, and a VIEWER trying to
 *      appoint a SUPER_ADMIN is refused by the same trigger that refuses it everywhere else.
 *
 * If step 2 is refused, step 1 is undone. A rejected appointment must not leave a working
 * credential behind for an account that has no સંચાલક record — that would be an ordinary yuvak
 * login the panel never shows anyone, created by a permission check that said no.
 *
 * Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in Netlify → Site settings
 * → Environment variables — the same three login-mobile.js needs, and for the same reason: one
 * step here acts as the server and two act as the person who is signed in.
 */

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

/*
  A role key's *shape*, and deliberately not a list of the roles that exist.

  This used to be the five labels of the public.admin_role enum, restated here so a wrong value
  reached the person as a sentence rather than the database as a cast error. 0043 retires the
  enum: roles are rows in `public.admin_roles` that a સંચાલક creates from the panel, so a fixed
  list here would refuse every role made after this file was last deployed — with a flat
  `bad-request` naming nothing, on an appointment that was perfectly legitimate.

  The shape check stays, because it is cheap and it keeps obvious rubbish out of a round trip.
  What decides whether the role *exists* is the foreign key `admins_role_fkey`, checked inside
  the same insert that checks `admins.create` and runs `admins_guard()` — one request, one
  authority, and no list here that can drift away from it. A 23503 comes back through the
  refusal path below with the constraint named in `detail`.
*/
const ROLE_KEY_RE = /^[A-Z][A-Z0-9_]{2,31}$/;

// profiles.mobile's shape, reused for admins.mobile, which is contact information and optional.
const MOBILE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
  Eight, where Supabase Auth's own floor is six.

  This is the only place in the project that sets a password for somebody who is not present to
  choose it, and the account it sets one for can read every યુવક's name, mobile and progress. The
  ceiling is bcrypt's: anything past 72 bytes is silently truncated by the hash, so accepting it
  would mean storing a password longer than the one that is actually checked.
*/
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { code: 'bad-request', gu: 'ખોટી રીત.' });

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  // The public key, used for the two requests made *as the caller*. See `asCaller` below.
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !secret || !publishable) {
    return reply(503, {
      code: 'setup-incomplete',
      gu: 'નવો સંચાલક ઉમેરવાનું હજુ ચાલુ થયું નથી.',
    });
  }

  // Forwarded verbatim in step 2. Not parsed, not trusted, not used to decide anything here —
  // the database is what reads it, and the database is what says who this is.
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return reply(401, { code: 'not-authenticated', gu: 'ફરી લોગિન કરો.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { code: 'bad-request', gu: 'વિગત બરાબર નથી.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const mobile = String(body.mobile || '').trim();
  const role = String(body.role || '').trim().toUpperCase();

  if (!EMAIL_RE.test(email)) return reply(400, { code: 'bad-request', gu: 'ઈમેલ બરાબર લખો.' });
  if (!name) return reply(400, { code: 'bad-request', gu: 'નામ લખો.' });
  if (!ROLE_KEY_RE.test(role)) return reply(400, { code: 'bad-request', gu: 'ભૂમિકા બરાબર નથી.' });
  if (mobile && !MOBILE_RE.test(mobile)) {
    return reply(400, { code: 'bad-request', gu: 'મોબાઈલ નંબર બરાબર નથી.' });
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return reply(400, {
      code: 'weak-password',
      gu: `પાસવર્ડ ઓછામાં ઓછો ${PASSWORD_MIN} અક્ષરનો હોવો જોઈએ.`,
    });
  }

  /*
    The caller's identity, and NOT the secret key anywhere in it.

    PostgREST takes the role from the `Authorization` JWT and Supabase's gateway takes only
    routing from `apikey`, so `apikey: secret` alongside a user token would in practice still
    have run as `authenticated`. It is the publishable key here regardless, because "in
    practice" is doing load-bearing work in that sentence: the difference between the two
    outcomes is an ordinary permission check and a request that bypasses every RLS policy in
    the project, and no part of that should rest on which of two headers PostgREST prefers.
  */
  const asCaller = {
    apikey: publishable,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  const asService = { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };

  let createdUserId = null;

  try {
    // ---------------------------------------------------------------- 1. may the caller?
    //
    // Asked of the database with the caller's token, so the answer comes from the same
    // has_permission() every RLS policy consults. This is not the security boundary — step 3
    // is, and it is enforced by the trigger — it is what stops an authenticated યુવક using this
    // endpoint to create auth accounts that are then rejected and deleted.
    const permission = await fetch(`${url}/rest/v1/rpc/has_permission`, {
      method: 'POST',
      headers: asCaller,
      body: JSON.stringify({ perm: 'admins.create' }),
    });

    if (permission.status === 401) {
      return reply(401, { code: 'not-authenticated', gu: 'ફરી લોગિન કરો.' });
    }
    if (!permission.ok) throw new Error(`has_permission failed: ${permission.status}`);
    if ((await permission.json()) !== true) {
      return reply(403, { code: 'not-permitted', gu: 'નવો સંચાલક ઉમેરવાની પરવાનગી નથી.' });
    }

    // ---------------------------------------------------------------- 2. the credential
    //
    // email_confirm: true because nobody is going to open a link — the address belongs to a
    // person who is being told their password by the administrator who appointed them, and an
    // unconfirmed account cannot sign in at all.
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: asService,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });

    if (!created.ok) {
      const err = await created.json().catch(() => ({}));
      const msg = String(err?.msg || err?.message || err?.error_description || '');
      if (created.status === 422 || /already (been )?registered|already exists/i.test(msg)) {
        return reply(409, {
          code: 'email-taken',
          gu: 'આ ઈમેલથી ખાતું પહેલેથી છે.',
        });
      }
      if (/password/i.test(msg)) {
        return reply(400, { code: 'weak-password', gu: 'પાસવર્ડ નબળો છે.' });
      }
      throw new Error(`create user failed: ${created.status} ${msg}`);
    }

    createdUserId = (await created.json())?.id;
    if (!createdUserId) throw new Error('create user returned no id');

    // ---------------------------------------------------------------- 3. the appointment
    //
    // As the caller. Everything that decides whether this is allowed happens inside this one
    // request: the insert policy asks for `admins.create` again, and admins_guard() applies the
    // self-appointment and SUPER_ADMIN rules with auth.uid() set to whoever is signed in.
    //
    // `created_by` is deliberately not sent. The guard fills it with auth.uid(), which cannot be
    // spoofed by a body this function forwards.
    const appointed = await fetch(`${url}/rest/v1/admins`, {
      method: 'POST',
      headers: { ...asCaller, Prefer: 'return=representation' },
      body: JSON.stringify({
        id: createdUserId,
        email,
        name,
        mobile: mobile || null,
        role,
      }),
    });

    if (!appointed.ok) {
      const err = await appointed.json().catch(() => ({}));
      // The guard's messages are English sentences written to be shown; errors.js maps the ones
      // the panel already knows. Passed through as `detail` so a refusal is never silent.
      const detail = String(err?.message || err?.hint || '') || `HTTP ${appointed.status}`;

      await rollback(url, asService, createdUserId);
      createdUserId = null;

      return reply(403, {
        code: 'not-permitted',
        gu: 'આ સંચાલક ઉમેરી શકાયો નથી.',
        detail,
      });
    }

    const row = (await appointed.json())?.[0] || {};
    return reply(200, { id: createdUserId, role: row.role || role, email });
  } catch (e) {
    console.error('create-admin failed:', e);

    // Same reasoning as the refusal path: a half-made administrator is a credential nobody
    // knows exists.
    if (createdUserId) await rollback(url, asService, createdUserId);

    return reply(500, { code: 'server-error', gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' });
  }
};

/**
 * Undo step 2.
 *
 * Failing to undo is logged and swallowed: the caller is already being told the appointment did
 * not happen, and turning a cleanup failure into a second error message would leave them unsure
 * which half is true. The orphan is a signed-up account with no admins row and no profile — it
 * can reach nothing, because every policy in the schema is written against a role it does not
 * have.
 */
async function rollback(url, headers, userId) {
  try {
    const gone = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers });
    if (!gone.ok) console.error(`create-admin: could not remove orphan ${userId}: ${gone.status}`);
  } catch (e) {
    console.error(`create-admin: could not remove orphan ${userId}:`, e);
  }
}
