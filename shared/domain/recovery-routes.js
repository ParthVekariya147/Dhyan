/**
 * The two recovery paths, and the redirect built from one of them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this is three lines in a file of its own
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `src/lib/auth.jsx` needs `resetRedirectTo()` to address the recovery mail, and auth.jsx is
 * imported eagerly by App.jsx - it is on the path of every first paint, before લોગિન has
 * rendered a field. `shared/domain/recovery.js` holds the rest of the flow's logic, and with
 * it every Gujarati sentence the two recovery screens say.
 *
 * Importing one function from that module put all of those sentences into the entry chunk.
 * Rollup could not drop them: they are exported bindings of a module something eager
 * imports, and it will not assume that reading one export means the others are unreachable.
 * The measured cost was the entry chunk crossing the budget
 * scripts/verify-admin-separation.mjs enforces — 60 KB when this was written, and higher since
 * — for strings only ever shown on two pages a યુવક may never open.
 *
 * So the split is by *when the thing is needed*, not by what it is about: the sender needs a
 * URL, the screens need the words, and only the URL is needed early. recovery.js re-exports
 * both names, so nothing that reads the flow's logic has to know this file exists.
 *
 * Keeping them as constants rather than literals at the two call sites is the point -
 * scripts/test-recovery.mjs asserts RESET_PATH against the actual route in src/App.jsx,
 * which is the check that stops a renamed route silently breaking every mail already sent.
 */

/** Where the recovery mail must land. */
export const RESET_PATH = '/reset-password';

/** Where a યુવક asks for the mail. */
export const FORGOT_PATH = '/forgot-password';

/**
 * The absolute URL Supabase should send him back to.
 *
 * The origin is passed in rather than read from `location` here, so this stays testable and
 * so the one place that chooses an origin is the one place to look when a deploy's mails
 * point at the wrong host. Trailing slashes are stripped because an origin that ends in one
 * would otherwise produce `//reset-password`, which is a protocol-relative URL to a host
 * named `reset-password`.
 */
export function resetRedirectTo(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${RESET_PATH}`;
}
