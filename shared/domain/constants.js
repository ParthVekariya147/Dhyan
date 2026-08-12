/**
 * Domain constants shared by the યુવક app (src/) and the સંચાલક panel (admin/).
 *
 * This file moved here from src/lib/constants.js when the Admin Panel was added: the
 * સબઝોન list and the two સંચાલક numbers must have exactly one definition, or the two
 * apps will eventually disagree about who is an admin. src/lib/constants.js re-exports
 * everything below, so no existing import path changed.
 *
 * Values fixed by the requirement document (§1, §3, §4).
 */

/**
 * There is no TOTAL_SCENES here, and there must not be one (§62).
 *
 * It read 108 — the number the requirement document types out — while the સંચાલક's Drive
 * folder holds 109 finalised images and the વર્ણન sheet 109 rows (PLAN.md §2.3). A literal
 * cannot be right about both, and whichever one it disagrees with is silently mis-scored: a
 * progress ring counted out of 108 over 109 દર્શન is simply wrong, and wrong quietly.
 *
 * Every total is counted from the content instead. `content/darshan.json` is generated
 * from the સંચાલક's sheet, `buildDarshanItems()` in shared/domain/darshan.js turns it into
 * items, and `items.length` is the total — see validateDarshanItems() there,
 * admin/src/features/darshan/pages/DarshanListPage.jsx and DarshanHealthPage.jsx, none of
 * which holds a number of its own.
 *
 * Nothing imported the constant: the last reader was src/pages/Home.jsx, which dropped its
 * —/૧૦૮ denominator and says why in place. An exported 108 that no one uses is only an
 * invitation for the next reader to re-break the rule, so it is gone rather than kept for
 * a caller that does not exist.
 */

/** Level 4 unlocks at 80+ ticks in a single day at Level 3 (§7). */
export const LEVEL4_UNLOCK_THRESHOLD = 80;

export const ZONES = [{ id: 'surat', name: 'સુરત' }];

export const SUBZONES = [
  { id: 'vedroad', name: 'વેડરોડ' },
  { id: 'varachha', name: 'વરાછા' },
  { id: 'navsari', name: 'નવસારી' },
];

export const subZoneName = (id) => SUBZONES.find((s) => s.id === id)?.name || id || '—';

/**
 * The founding સંચાલક numbers from §3.
 *
 * These are a *bootstrap*, not the role system. Since 0004_rbac.sql, an administrator is
 * a row in `admin_profiles` carrying a role, and roles are assigned from the panel by a
 * SUPER_ADMIN. These three numbers resolve to SUPER_ADMIN with or without such a row,
 * which is what makes it impossible to lock the owners out of their own panel — by a bad
 * role edit, a mistaken DISABLE, or a seed that never ran.
 *
 * The list is the root of trust and not the enforcement. Enforcement is
 * `public.effective_role()`, which reads profiles.mobile — a column a trigger makes
 * immutable after registration, so it cannot be self-declared. This copy only decides
 * what the UI shows; `node scripts/seed-admin.mjs` reports drift between the two.
 */
export const ADMIN_MOBILES = [
  '9601269715', // §3
  '9601269009', // §3
  '9925842081', // developer/owner account, added 2026-08-11
];

export const isAdminMobile = (mobile) => ADMIN_MOBILES.includes(String(mobile || '').trim());

/** Indian mobile: 10 digits, first digit 6-9. */
export const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Any way a યુવક might write his number → the ten digits `profiles.mobile` stores.
 *
 * The column is UNIQUE and is the alternate login identifier, so there is exactly one
 * correct spelling of a number and every screen has to arrive at it independently. This
 * function is that spelling, and it is the only one: the registration field, the login
 * field and netlify/functions/login-mobile.js all pass through here, so a number typed one
 * way and typed the other way later resolve to the same account.
 *
 * What it removes, and why each one is real:
 *
 *   spaces, hyphens, brackets   — '96012 69715', '9601-269715' off a printed card
 *   a leading +91 / 91          — what the phone's own contact list hands to autofill
 *   a leading 0                 — the trunk prefix people still dial out of habit
 *
 * The prefixes are stripped **only while more than ten digits remain**, which is what keeps
 * a genuine number safe: '9190123456' is ten digits that happen to begin '91', and the loop
 * never looks at it. Stripping by pattern instead would delete the first two digits of that
 * yuvak's number and hand him somebody else's — silently, since the result still matches
 * MOBILE_RE.
 *
 * The previous behaviour was `replace(/\D/g,'').slice(0, 10)`, which took the *first* ten
 * digits: '+919601269715' became '9196012697'. That passes MOBILE_RE, so registration
 * accepted it, wrote it to a UNIQUE column, and the yuvak could then never log in with the
 * number he actually owns. Truncating from the wrong end is the failure this closes.
 */
export function normaliseMobile(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  while (d.length > 10 && (d.startsWith('91') || d.startsWith('0'))) {
    d = d.startsWith('91') ? d.slice(2) : d.slice(1);
  }
  return d.slice(0, 10);
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Supabase Auth's own floor is 6 characters; raise here if the admin wants stricter. */
export const MIN_PASSWORD = 6;

/**
 * SMK — the yuvak's unique member ID. Three uppercase initials (first · middle · last
 * name) followed by three digits: PGV881, ABC789, ASD852.
 *
 * Format alone cannot make it unique. Under Firestore that needed a companion
 * `smkIndex/{SMK}` document claimed in the same batch; in Postgres it is a UNIQUE
 * constraint on profiles.smk, and a trigger makes the column immutable after
 * registration. See supabase/migrations/0001_init.sql.
 */
export const SMK_RE = /^[A-Z]{3}\d{3}$/;

/**
 * Keeps input in shape as it is typed: up to 3 letters, then up to 3 digits.
 *
 * Letters and digits are collected independently rather than by splitting the string at
 * a position, so interleaved input still lands correctly — "A1B2C3" gives ABC123, not
 * ABC23. People do type an SMK that way when reading it off a card.
 */
export function normaliseSmk(raw) {
  const s = String(raw || '').toUpperCase();
  const letters = (s.match(/[A-Z]/g) || []).slice(0, 3).join('');
  const digits = (s.match(/\d/g) || []).slice(0, 3).join('');
  return letters + digits;
}

/**
 * Latin digits → Gujarati digits. §14 requires the whole app in Gujarati, and any
 * number rendered into UI text has to follow — otherwise "૧૦૮" and "108" appear on
 * the same screen.
 *
 * Use only for display. Never for values sent to the database, compared, or parsed.
 */
const GU_DIGITS = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];
export const gu = (n) => String(n).replace(/\d/g, (d) => GU_DIGITS[+d]);

/** Today's date as YYYY-MM-DD in India, which is where the midnight reset happens (§9). */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** N days before todayIST(), same YYYY-MM-DD shape. Used by the admin date filters. */
export function dateIST(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
