/**
 * §11 — Excel export, and the IST day an અહેવાલ (report) is cut on.
 *
 * Two things live in one file because a report is one thing: a date range and a file.
 * Get the range wrong and the file is wrong, so the boundaries and the encoder are read
 * side by side rather than in two modules that can drift apart.
 *
 * Why CSV and not .xlsx
 * ---------------------
 * §11 asks for "Excel export". Excel opens a CSV natively — double-click, done — and a
 * real .xlsx would mean a zip writer, an XML schema and a new dependency in a panel that
 * has exactly three (react, react-router, supabase-js). The person asking for this wants
 * a file they can open, sort and hand to a saint; CSV is that file. The one thing CSV
 * costs is the two traps below, and both are handled here rather than in nine call sites.
 *
 * Trap 1 — the BOM. The data is Gujarati: નામ, ઝોન, સબઝોન. Excel on Windows does not
 * sniff UTF-8; without a byte-order mark it decodes the file in the system ANSI codepage
 * and every Gujarati name arrives as mojibake (à«‡àª¾â€¦). A CSV that cannot show a
 * યુવક's name is worthless to the સંચાલક who asked for it, so every file this module
 * produces starts with U+FEFF. See BOM below — do not remove it.
 *
 * Trap 2 — formula injection. Excel evaluates a cell whose text begins with =, +, - or @
 * as a formula, and quoting does not stop it. A name someone typed as "=cmd" would run,
 * or at minimum render as #NAME?. Every cell is checked (see csvCell) — a plain number is
 * left alone, anything else that starts that way gets a leading apostrophe.
 *
 * Nothing here is a listener, a fetch or a React hook. It is pure string work plus one
 * DOM call at the very end, which is what makes the encoder testable on its own.
 */

/**
 * U+FEFF, the UTF-8 byte-order mark, as the first character of the file.
 *
 * `new Blob([text])` encodes the string as UTF-8, so this character becomes the three
 * bytes EF BB BF — which is exactly what Excel looks for before it will decode the rest
 * as UTF-8. LibreOffice and Numbers do not need it and ignore it silently.
 */
const BOM = '\uFEFF';

/** RFC 4180 says CRLF, and Excel is the reader that cares most. */
const EOL = '\r\n';

/**
 * India has been UTC+05:30 without exception and has never observed daylight saving, so
 * this is a constant and not a lookup. Every bound this module builds carries it, which
 * is what keeps a day's rows in the day the સંચાલક meant: `gte('2026-08-11')` on a
 * timestamptz column is parsed as UTC by Postgres and would quietly move the cut-off
 * 5½ hours, dropping the first part of the evening into the day before (§9).
 */
const IST_OFFSET = '+05:30';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A value that is entirely a number — including a negative one. Excel only treats a cell
 * starting with -, + or = as a formula when it is *not* a valid number, so `-5` is safe
 * and must stay a number the spreadsheet can sum. `-5+3` does not match this and is
 * neutralised, which is correct: that is a formula.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** The four characters Excel reads as "this cell is a formula", plus tab and CR. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Needs quoting: the delimiter, a quote, any newline, or padding that would be eaten. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/**
 * One cell, safe for Excel.
 *
 * Order matters. The injection guard runs *before* quoting, because a quoted cell is
 * still evaluated as a formula — `"=1+1"` is a formula in Excel, not the text =1+1. The
 * apostrophe is visible in the cell, and that is the right outcome: our columns are
 * names, SMKs, subzone names, dates and counts, none of which legitimately begin with
 * =, + or @, so a cell that does is worth seeing rather than silently running.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';

  let s = String(value);
  if (s === '') return '';

  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;

  // Doubling the quote is CSV's own escape — "" inside a quoted field is one ".
  if (NEEDS_QUOTES.test(s)) s = `"${s.replace(/"/g, '""')}"`;

  return s;
}

/**
 * Rows + a column spec → a complete CSV file, BOM first.
 *
 * `columns` is `[{ label, value }]` where `value(row)` returns whatever should be in the
 * cell. Formatting belongs to the caller — this function never guesses that a string is
 * a date or that a null should read "—". A spreadsheet wants an empty cell there, not a
 * dash it will sort as text.
 */
export function toCsv(columns, rows) {
  const cols = Array.isArray(columns) ? columns : [];
  const line = (cells) => cells.map(csvCell).join(',');

  const out = [line(cols.map((c) => c.label))];
  for (const row of rows || []) {
    out.push(line(cols.map((c) => (typeof c.value === 'function' ? c.value(row) : row[c.key]))));
  }

  // A trailing EOL, so the last row is a complete record and an appending tool does not
  // glue its first row onto ours.
  return BOM + out.join(EOL) + EOL;
}

/**
 * Hand the file to the browser.
 *
 * `text/csv` rather than `application/vnd.ms-excel`: the latter makes some browsers offer
 * to open it in a program the machine may not have, and the extension already tells
 * Windows what to do. `charset=utf-8` states what the BOM already proves.
 *
 * The object URL is revoked on the next tick — revoking it synchronously can beat the
 * download in some browsers, and never revoking it holds the whole file in memory until
 * the tab closes.
 */
export function downloadCsv(filename, text) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * Build and download in one call, and answer how many rows went out.
 *
 * The count is returned rather than assumed by the caller, so the sentence a page shows
 * afterwards ("Exported 1,840 users") is derived from the file that was actually written
 * (§62) and cannot claim a number the export did not contain.
 */
export function exportCsv({ filename, columns, rows }) {
  const list = rows || [];
  downloadCsv(filename, toCsv(columns, list));
  return list.length;
}

// ---------------------------------------------------------------- the IST day

/**
 * Start of an IST day, as an instant Postgres will compare correctly.
 *
 * `'2026-08-11'` → `'2026-08-11T00:00:00+05:30'`, which is 2026-08-10T18:30Z. Passing the
 * bare date string instead would compare against midnight *UTC* and put 5½ hours of the
 * previous IST evening inside the range.
 */
export function istDayStart(ymd) {
  return ISO_DAY.test(String(ymd || '')) ? `${ymd}T00:00:00${IST_OFFSET}` : null;
}

/**
 * Start of the IST day *after* the one given — the exclusive upper bound of a range.
 *
 * Exclusive on purpose. `lte('2026-08-11T00:00:00+05:30')` would include only the first
 * instant of the 11th; `lt(<start of the 12th>)` includes the whole of the 11th including
 * 23:59:59.999, which is what "to 11 August" means to the person who typed it.
 *
 * Date.UTC here is calendar arithmetic and never an instant: it is only being asked what
 * day follows 11 August, a question with the same answer in every timezone. It handles
 * month ends and leap years, which string maths would not.
 */
export function istDayAfter(ymd) {
  if (!ISO_DAY.test(String(ymd || ''))) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.toISOString().slice(0, 10)}T00:00:00${IST_OFFSET}`;
}

/**
 * A whole date range for a query. Either end may be blank, which means "unbounded that
 * way" — a સંચાલક who fills in only "from" is asking for everything since then, and the
 * service must not invent a closing bound for him.
 */
export function istRange(from, to) {
  return { fromIso: istDayStart(from), toIsoExclusive: istDayAfter(to) };
}

/**
 * A timestamptz → `2026-08-11`, in IST.
 *
 * The same instant and the same IST day that `dateGu()` in ./format.js puts on screen,
 * in the shape a spreadsheet understands. "11 Aug 2026" is text to Excel: it sorts
 * alphabetically, so August lands before February. This sorts and filters as a date.
 */
export function istDate(value) {
  const d = toInstant(value);
  if (!d) return '';
  // en-CA is the locale whose short date *is* ISO order — no manual part assembly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** A timestamptz → `2026-08-11 14:30`, in IST. Same reasoning as istDate(). */
export function istDateTime(value) {
  const d = toInstant(value);
  if (!d) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23', // 24-hour, so there is no am/pm word to sort around
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** PostgREST hands back an ISO string; a Date is accepted so callers need not convert. */
function toInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(+value) ? null : value;
  const d = new Date(value);
  return Number.isNaN(+d) ? null : d;
}

/**
 * `varni-dhyan-yuvako-2026-08-11.csv`, or `…-2026-07-01_2026-07-31.csv` for a range.
 *
 * ASCII only. The file is going onto a Windows machine and into WhatsApp; a Gujarati
 * filename survives neither reliably, and the header row inside the file is where the
 * Gujarati belongs.
 */
export function reportFilename(base, { from = '', to = '', stamp = '' } = {}) {
  const parts = ['varni-dhyan', base];
  if (from || to) parts.push([from, to].filter(Boolean).join('_'));
  else if (stamp) parts.push(stamp);
  return `${parts.join('-')}.csv`;
}
