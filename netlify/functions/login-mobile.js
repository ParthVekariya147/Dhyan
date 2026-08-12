/**
 * Sign in with mobile number + password.
 *
 * Supabase authenticates on email. A mobile number therefore has to be resolved to one
 * first — and doing that in the browser would mean a lookup readable *before* sign-in,
 * i.e. anyone could walk the range of Indian mobile numbers and harvest ~2,000 yuvaks'
 * email addresses. RLS is exactly what stops the client doing it.
 *
 * So the whole exchange happens here and the email never leaves the server:
 *
 *   1. resolve mobile -> email with the secret key (bypasses RLS)
 *   2. sign in with that email and the supplied password, as an ordinary user would
 *   3. return the session; the client adopts it with supabase.auth.setSession()
 *
 * Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in Netlify →
 * Site settings → Environment variables. The secret key bypasses every policy, so it
 * belongs nowhere else.
 */

const MOBILE_RE = /^[6-9]\d{9}$/;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

// ESM, because it has to be: the root package.json declares `"type": "module"` and there
// is no package.json under netlify/, so Node loads this file as an ES module. It was
// written as `exports.handler = …`, where `exports` is not defined — the module threw at
// load time and every mobile login answered 500, while email login (which never touches
// this function) went on working and hid it.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { gu: 'ખોટી રીત.' });

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !secret || !publishable) {
    return reply(503, {
      gu: 'મોબાઈલથી લોગિન હજુ ચાલુ થયું નથી. હમણાં ઈમેલથી લોગિન કરો.',
      code: 'setup-incomplete',
    });
  }

  let mobile, password;
  try {
    ({ mobile, password } = JSON.parse(event.body || '{}'));
  } catch {
    return reply(400, { gu: 'વિગત બરાબર નથી.' });
  }

  if (!MOBILE_RE.test(String(mobile || '').trim()) || !password) {
    return reply(400, { gu: 'મોબાઈલ નંબર અને પાસવર્ડ બરાબર લખો.' });
  }

  // Deliberately identical for "no such number" and "wrong password", so this endpoint
  // cannot be used to discover which numbers are registered.
  const WRONG = { gu: 'મોબાઈલ નંબર કે પાસવર્ડ બરાબર નથી.' };

  try {
    const lookup = await fetch(
      `${url}/rest/v1/profiles?select=email&mobile=eq.${encodeURIComponent(String(mobile).trim())}&limit=1`,
      { headers: { apikey: secret, Authorization: `Bearer ${secret}` } }
    );
    if (!lookup.ok) throw new Error(`lookup failed: ${lookup.status}`);

    const rows = await lookup.json();
    const email = rows?.[0]?.email;
    if (!email) return reply(401, WRONG);

    // Signed in with the *publishable* key, not the secret one: this must produce an
    // ordinary user session that RLS applies to, exactly as an email login would.
    const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishable, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!signIn.ok) {
      const err = await signIn.json().catch(() => ({}));
      if (signIn.status === 429) {
        return reply(429, { gu: 'ઘણી વાર પ્રયત્ન થયો. થોડી વાર પછી ફરી કરો.' });
      }
      if (String(err?.error_description || err?.msg || '').includes('not confirmed')) {
        return reply(401, { gu: 'ઈમેલ હજુ ચકાસાયું નથી. તમારા ઈનબોક્સમાં આવેલી લિંક ખોલો.' });
      }
      return reply(401, WRONG);
    }

    const session = await signIn.json();
    return reply(200, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  } catch (e) {
    console.error('login-mobile failed:', e);
    return reply(500, { gu: 'કંઈક ગડબડ થઈ. ફરી પ્રયત્ન કરો.' });
  }
};
