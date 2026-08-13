/**
 * Display helpers for the સંચાલક panel, which reads English.
 *
 * The panel used to render Gujarati numerals and Gujarati dates: it shared `gu()` with
 * the યુવક app, so a count came out ૧૦૮ and a timestamp "૧૧ ઓગસ્ટ ૨૦૨૬, ૨:૩૦ બપોરે".
 * Both now render in English, and every page picks that up from here — `gu`, `dateGu`
 * and `dateTimeGu` are imported from this module by all of them and nowhere else, so
 * this file is the whole switch. The યુવક app's own `gu()` in shared/domain/constants.js
 * is untouched and still writes Gujarati numerals.
 *
 * The names are kept so no call site had to change; they are aliased below to plainer
 * ones for new code.
 *
 * The timezone stays IST either way — the સંચાલક and the યુવક are in the same place.
 */

/**
 * Latin digits, unchanged. This is the identity the panel wants: a સંચાલક comparing
 * scores or copying a mobile number wants digits he can paste elsewhere.
 */
export const gu = (n) => String(n);
export const num = gu;

/** ISO timestamptz string | Date | null → "11 Aug 2026, 2:30 pm", in IST. */
export function dateTimeGu(value) {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** ISO timestamptz string | Date | null → "11 Aug 2026", in IST. */
export function dateGu(value) {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export const dateTime = dateTimeGu;
export const date = dateGu;

/**
 * PostgREST hands back timestamptz as an ISO 8601 string, so that is the branch that runs.
 * The `.toDate()` and `{ seconds }` branches are the Firestore Timestamp shapes; they are
 * left in place because they cost nothing and removing them is the only part of this file
 * that could change what renders.
 */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(+d) ? null : d;
  }
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

/** 64.2% — one decimal, never rounded up to a flattering 100 when it is not. */
export function percent(part, whole) {
  if (!whole) return '0.0%';
  return `${(Math.floor((part / whole) * 1000) / 10).toFixed(1)}%`;
}

export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(2)} MB`);
