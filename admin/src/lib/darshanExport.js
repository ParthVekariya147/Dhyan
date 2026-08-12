import {
  INSTRUCTIONS_FILENAME,
  TEMPLATE_FILENAME,
  excelHeaderRow,
  instructionsText,
  itemToRow,
  templateRows,
} from '../../../shared/domain/darshan-excel.js';
import { downloadCsv, exportCsv, reportFilename, toCsv } from './export';
import { todayIST } from '../../../shared/domain/constants.js';

/**
 * દર્શન → a file the સંચાલક can open in Excel. Three downloads, one encoder.
 *
 * This module is deliberately thin, and the thinness is the point. It owns *what goes in
 * the file* and *what the file is called*; it owns nothing about how a cell is written.
 * That belongs to ./export.js, which already solved the two traps a Gujarati CSV falls
 * into and solved them once for the whole panel (EXCEL_CONTRACT.md §2):
 *
 *   the BOM              U+FEFF first, or Excel on Windows decodes નામ, વર્ણન and every
 *                        other Gujarati string in the system ANSI codepage and hands the
 *                        સંચાલક mojibake.
 *   formula injection    a cell beginning =, +, - or @ is *evaluated* by Excel, quoted or
 *                        not. csvCell() prefixes an apostrophe — and leaves a plain number
 *                        alone, so `-5` stays a number the spreadsheet can sum.
 *
 * A second encoder here would be a second place for either of those to be got wrong, and
 * the one that is wrong is always the one nobody tested. So every cell below goes through
 * `toCsv`/`exportCsv`, and this file contains no string escaping of its own.
 *
 * The shape of the row is likewise not decided here. `EXCEL_COLUMNS` and `itemToRow()` in
 * shared/domain/darshan-excel.js are the single definition of the દર્શન sheet — the same
 * module the importer reads a file back with — so export and import cannot drift into
 * disagreeing about what column 5 is. That is what makes EXCEL_CONTRACT.md §3's round-trip
 * (export → import → zero changes) a property of the code rather than a coincidence.
 *
 * **Nothing personal is in any of these files, by construction.** Every cell comes from
 * `itemToRow(item)`, and a `DarshanItem` is a picture, a number, a વર્ણન and a status. No
 * function here reads `profiles`, a session, a token or an environment value, and none of
 * them is reachable from a દ્રશ્ય — so there is no e-mail address or mobile number for an
 * export of the collection to leak (EXCEL_CONTRACT.md §1).
 */

/**
 * The column spec ./export.js wants, built from the frozen one.
 *
 * Both halves come from the domain module and neither is written out here. `itemToRow()`
 * answers with a positional array and `excelHeaderRow()` names the same positions, so a
 * column added to `EXCEL_COLUMNS` tomorrow appears in the file with no edit to this
 * function — and, more to the point, a column *moved* cannot leave the header and the cells
 * pointing at different things. Reading each cell by index rather than by key is the whole
 * of that guarantee: the array is the contract.
 *
 * The header is therefore the English name, which is what `excelHeaderRow()` returns.
 * `detectDarshanColumns()` matches by name and accepts both languages (EXCEL_CONTRACT.md
 * §1), so a file exported here is importable unchanged.
 */
const columnsFromSpec = () =>
  excelHeaderRow().map((label, i) => ({ label, value: (row) => row[i] }));

/** `varni-dhyan-darshan-2026-08-12.csv` — ASCII, dated, and the same shape every other
 *  report in the panel already has. */
const exportFilename = () => reportFilename('darshan', { stamp: todayIST() });

/**
 * The master data, as it stands right now.
 *
 * `items` is whatever the caller passes — the whole collection, or the selection the
 * સંચાલક has ticked. This function does not decide which, and deliberately does not filter:
 * a page that shows a selection and exports something else is the bug this signature
 * removes. It also does not sort. The list arrives canonically sequenced by
 * `withDisplayIndex()` (ORDERING.md rule 4) and a local `.sort()` here would put the file
 * in an order no screen agrees with.
 *
 * Withheld દર્શન are exported like any other. The file is the master record, not the યુવક's
 * view of it: a DISABLED દ્રશ્ય dropped from the export would come back as "not in the sheet"
 * the next time somebody imported it, and silently vanish.
 *
 * @param {import('../../../shared/domain/types.js').DarshanItem[]} items
 * @returns {number} how many rows were actually written — the caller reports *this*, never
 *   a number it assumed (§62).
 */
export function exportDarshanCsv(items) {
  return exportCsv({
    filename: exportFilename(),
    columns: columnsFromSpec(),
    rows: (items || []).map((it) => itemToRow(it)),
  });
}

/**
 * The blank sheet — EXCEL_CONTRACT.md §8.
 *
 * `templateRows()` answers with the header *and* its example rows in one array, because
 * the two have to agree about how many columns there are and which one is which. The
 * header is split off here only because `toCsv` takes it separately; every cell, header
 * included, still goes through the same encoder, so an example row containing a Gujarati
 * વર્ણન with a comma in it survives the trip.
 *
 * The template carries the eight *importable* columns only, and its own bilingual headers —
 * `Index Number (ક્રમ)`. Handing back a sheet with `Display Number` in it would invite the
 * સંચાલક to type a number into a column that is derived on read and stored nowhere
 * (DARSHAN_DATA_CONTRACT.md §1), and then wonder why his edit did nothing.
 *
 * The name comes from the domain module too, so the template and its instructions stay a
 * recognisable pair in a downloads folder — and unlike the export it carries no date, because
 * a blank form is the same blank form in August as it was in July.
 *
 * @returns {number} example rows written, header excluded.
 */
export function downloadDarshanTemplate() {
  const [header = [], ...examples] = templateRows() || [];
  const columns = header.map((label, i) => ({ label, value: (row) => row[i] }));
  downloadCsv(TEMPLATE_FILENAME, toCsv(columns, examples));
  return examples.length;
}

/**
 * The instructions that ship beside the template.
 *
 * A second file rather than a second sheet, and that is a consequence of the format
 * choice rather than an oversight: the export is a CSV, a CSV holds exactly one sheet, and
 * writing a real multi-sheet .xlsx would mean a ZIP writer and a fourth npm dependency in a
 * panel that has three (EXCEL_CONTRACT.md §2, §8). The name is the contract's —
 * `darshan-instructions.txt`, taken from the domain module beside the template's.
 *
 * Not routed through `downloadCsv`, and this is the one place this module does its own
 * browser work. The difference is a single header: a plain-text file announced as
 * `text/csv` is a file some browsers will "correct" by appending `.csv` to the name the
 * `download` attribute asked for, which would turn the instructions into a spreadsheet
 * Excel then tries to parse into columns. The BOM is kept for the same reason the CSV has
 * one — the text is Gujarati, and Notepad is where it will be opened.
 */
export function downloadDarshanInstructions() {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;

  // Escaped rather than pasted: U+FEFF is invisible, and an invisible character in a source
  // file is one nobody can see has been deleted.
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + instructionsText()], { type: 'text/plain;charset=utf-8' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = INSTRUCTIONS_FILENAME;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Next tick, not now: revoking synchronously can beat the download in some browsers, and
  // never revoking holds the file in memory until the tab closes. Same reasoning, and the
  // same one line, as downloadCsv().
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
