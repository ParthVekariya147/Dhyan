/**
 * ────────────────────────────────────────────────────────────────────────────
 * BOTH LOGIN IDENTIFIERS STILL WORK
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   npm run verify:login
 *
 * The લોગિન field accepts a mobile number OR an email, and the two take completely
 * different routes to the same session:
 *
 *   email   browser → Supabase, signInWithPassword(), no server in between
 *   mobile  browser → /api/login-mobile → the secret key resolves the number to an
 *           email → Supabase → the session comes back and setSession() adopts it
 *
 * Nothing about one exercises the other, and that is the whole reason this file exists.
 * Both halves have now broken separately, and each time the other kept working and made
 * the failure look like a bad password rather than a broken route:
 *
 *   - login-mobile.js was written with `exports.handler` in an ESM package, so it threw
 *     at load time and every mobile login answered 500;
 *   - `vite` serves neither netlify.toml's /api/* redirect nor netlify/functions, so on
 *     :5173 the same POST answered 404.
 *
 * A test that signs in one way cannot see either. So this signs in BOTH ways, against
 * dist/ with the real function mounted at the path netlify.toml gives it, and fails if
 * either route stops producing a session.
 *
 * It also asserts the negative — a wrong password must NOT produce a session on either
 * route — because "login always succeeds" would otherwise pass every check above.
 *
 * Credentials come from the environment and are never committed:
 *
 *   VERIFY_LOGIN_MOBILE     the 10-digit number of a real test account
 *   VERIFY_LOGIN_EMAIL      that same account's email
 *   VERIFY_LOGIN_PASSWORD   its password
 *
 * Without all three the script SKIPS loudly and exits 0, so `npm run check` still runs on
 * a machine that has no test account — but it says so in as many words rather than
 * reporting a pass it did not earn.
 */
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer as createStatic } from './serve-dist.mjs';
import { handler as loginMobile } from '../netlify/functions/login-mobile.js';

// The functions read un-prefixed variables, which Vite deliberately does not expose. In a
// cloud session or CI they are already in the environment; locally they are in .env.local.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env.local'));
} catch {
  /* already in the environment, or genuinely absent — checked below */
}

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 4180 is verify-loading's, 4181 verify-mobile's, 4182 verify-gallery's, 4183
// verify-nav's, 4187 verify-admin-mobile's. This one takes 4184.
const PORT = Number(process.env.PORT) || 4184;

const MOBILE = process.env.VERIFY_LOGIN_MOBILE;
const EMAIL = process.env.VERIFY_LOGIN_EMAIL;
const PASSWORD = process.env.VERIFY_LOGIN_PASSWORD;

if (!MOBILE || !EMAIL || !PASSWORD) {
  console.log('\n  ⚠ SKIPPED — verify:login needs a real test account.\n');
  console.log('    Set all three and run again:');
  console.log('      VERIFY_LOGIN_MOBILE    10-digit number of a test account');
  console.log('      VERIFY_LOGIN_EMAIL     that account\'s email');
  console.log('      VERIFY_LOGIN_PASSWORD  its password\n');
  console.log('    Nothing was checked. Both login routes are UNVERIFIED.\n');
  process.exit(0);
}

for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
  if (!process.env[key]) {
    console.error(`\n  ✗ ${key} is not set — /api/login-mobile cannot run without it.\n`);
    process.exit(1);
  }
}

/*
  dist/, plus the one route netlify.toml adds.

  serve-dist.mjs falls back to index.html for anything that is not a file, which for a POST
  to /api/login-mobile means 200 and a page of HTML — the request would "succeed" and the
  browser would fail to parse it. So the function is mounted ahead of the static server,
  at exactly the path netlify.toml redirects to it.
*/
const staticServer = createStatic();

const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== '/api/login-mobile') {
    return staticServer.emit('request', req, res);
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const out = await loginMobile({
        httpMethod: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8') || null,
        isBase64Encoded: false,
      });
      res.writeHead(out.statusCode, out.headers).end(out.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: String(e) }));
    }
  });
});

await new Promise((r) => server.listen(PORT, r));
const SITE = `http://localhost:${PORT}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

let passed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/**
 * One sign-in attempt, from a browser that has never seen this site.
 *
 * A fresh incognito context per attempt, not just cleared storage: the second attempt must
 * not be able to pass by inheriting the first one's session, which is precisely how a
 * broken route can look healthy.
 */
async function signIn(identifier, password) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  const network = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/auth/v1/token')) {
      network.push(`${r.status()} ${u.pathname}`);
    }
  });

  await page.goto(`${SITE}/login`, { waitUntil: 'networkidle0' });

  const inputs = await page.$$('input');
  if (inputs.length < 2) {
    await context.close();
    return { error: `લોગિન page showed ${inputs.length} fields, expected 2`, network };
  }

  await inputs[0].type(identifier);
  await inputs[1].type(password);
  await page.evaluate(() => {
    document.querySelector('form')?.requestSubmit();
  });

  // The flow is: sign in, adopt the session, read the profile, then navigate. Waiting for
  // the navigation rather than a fixed delay would miss the failure case, which never
  // navigates at all — so this waits for either outcome to settle.
  await new Promise((r) => setTimeout(r, 6000));

  const state = await page.evaluate(() => ({
    route: location.pathname,
    session: (() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('varni.auth'));
      if (!key) return null;
      try {
        return JSON.parse(localStorage.getItem(key))?.user?.id ?? 'unparsed';
      } catch {
        return 'unparsed';
      }
    })(),
    /*
      `.notice` is the banner લોગિન actually renders a refused sign-in into
      (Login.jsx: `<div className="notice warn">`), and the field-level messages §18 puts
      beside each input carry `error` in their class. Both are read, because a refusal
      shown in neither place is the failure this assertion is for — and a selector that
      matched only one of them reported "no message shown" for a page that was in fact
      saying it plainly.
    */
    message: [...document.querySelectorAll('.notice,[role="alert"],[class*="error"]')]
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(' | '),
  }));

  await context.close();
  return { ...state, network };
}

console.log(`\n  લોગિન — both identifiers, against dist/ on ${SITE}\n`);

const byEmail = await signIn(EMAIL, PASSWORD);
check('email + password signs in', Boolean(byEmail.session), byEmail.message || byEmail.error);
check('email lands off the લોગિન page', byEmail.route && byEmail.route !== '/login', `at ${byEmail.route}`);

const byMobile = await signIn(MOBILE, PASSWORD);
check('mobile + password signs in', Boolean(byMobile.session), byMobile.message || byMobile.error);
check('mobile lands off the લોગિન page', byMobile.route && byMobile.route !== '/login', `at ${byMobile.route}`);

// The point of the whole exercise: two identifiers, one account.
check(
  'both identifiers reach the SAME account',
  Boolean(byEmail.session) && byEmail.session === byMobile.session,
  `email=${byEmail.session} mobile=${byMobile.session}`
);

// mobile must have gone through the function; email must not have.
check(
  'mobile went through /api/login-mobile and it answered 200',
  byMobile.network.some((n) => n === '200 /api/login-mobile'),
  byMobile.network.join(', ') || 'no /api request seen'
);
check(
  'email did NOT call /api/login-mobile',
  !byEmail.network.some((n) => n.endsWith('/api/login-mobile')),
  byEmail.network.join(', ')
);

// The negative. Without this, a build where login always succeeds passes everything above.
const badEmail = await signIn(EMAIL, `${PASSWORD}-wrong`);
check('wrong password on email creates no session', !badEmail.session, `session=${badEmail.session}`);
check('wrong password on email says so', Boolean(badEmail.message), 'no message shown');

const badMobile = await signIn(MOBILE, `${PASSWORD}-wrong`);
check('wrong password on mobile creates no session', !badMobile.session, `session=${badMobile.session}`);
check('wrong password on mobile says so', Boolean(badMobile.message), 'no message shown');

await browser.close();
server.close();

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.error('  FAILED:');
  for (const f of failures) console.error(`    - ${f}`);
  console.error('');
  process.exit(1);
}
