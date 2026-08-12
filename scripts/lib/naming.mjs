/**
 * Universal filename → ક્રમ resolution.
 *
 * The old pipeline knew exactly one naming convention — `Varni (12).png` — and parsed
 * `(\d+)` out of it in three separate places. That held only for as long as one Drive
 * folder existed. The સંચાલક has said the next collection will arrive named some other
 * way, so the convention is now data, not code.
 *
 * Two mechanisms, in priority order:
 *
 *   1. **Declared.** The sheet's `ફોટો ફાઇલ` column names the file for that ક્રમ. If that
 *      name matches a real file, that is the answer and no pattern is consulted. This is
 *      the escape hatch for any naming scheme at all, including ones with no number in
 *      them — `sunrise-over-the-sea.png` works if the sheet says so.
 *
 *   2. **Inferred.** No declaration, or it names nothing on disk: the filename is tried
 *      against the pattern table below, in order, and the first match wins.
 *
 * Nothing here guesses silently. Every resolution carries the mechanism that produced it,
 * and every failure is returned as a problem rather than dropped, because a દ્રશ્ય that
 * quietly binds to the wrong image is worse than one that refuses to build.
 *
 * To support a new convention, add a row to PATTERNS. That is the whole change.
 */

/**
 * Tried in order; first match wins. Each `re` must capture the ક્રમ in group 1.
 *
 * Ordering is by specificity, not by how common the pattern is. `bare` and `trailing`
 * are last because they match almost anything — putting them earlier would let
 * `IMG_2024-12.png` resolve to 2024 before `suffixed` ever saw it.
 */
export const PATTERNS = [
  { name: 'parens', re: /\((\d+)\)/, example: 'Varni (12).png' },
  { name: 'canonical', re: /^darshan[-_](\d+)\./i, example: 'darshan-012.png' },
  { name: 'suffixed', re: /^.*[^\d][-_ ](\d+)\s*\.[^.]+$/, example: 'scene_12.png · IMG-0012.jpg' },
  { name: 'bare', re: /^(\d+)\s*\.[^.]+$/, example: '012.png' },
  { name: 'trailing', re: /(\d+)\s*\.[^.]+$/, example: 'anything-ending-in-12.png' },
];

/** Case, whitespace and separator differences are not real differences in a filename. */
export const normalize = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\s+/g, ' ');

/** The same, minus the extension — so a sheet saying `Varni (12)` still finds `Varni (12).png`. */
export const stem = (name) => normalize(name).replace(/\.[^.]+$/, '');

/**
 * Infer the ક્રમ from a filename alone.
 * @returns {{ n: number, pattern: string } | null}
 */
export function indexFromFilename(name) {
  const base = normalize(name);
  for (const p of PATTERNS) {
    const m = base.match(p.re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) return { n, pattern: p.name };
    }
  }
  return null;
}

/**
 * Bind every row to a file on disk.
 *
 * @param {{ files: string[], rows: Array<{ n: number, file?: string }> }} input
 *   `files` are basenames as they exist; `rows` come from the sheet.
 * @returns {{
 *   mapping: Map<number, { file: string, via: string }>,
 *   problems: string[],
 *   unmatchedRows: number[],
 *   unclaimedFiles: string[],
 * }}
 */
export function resolveFiles({ files, rows }) {
  const byName = new Map();
  const byStem = new Map();
  for (const f of files) {
    byName.set(normalize(f), f);
    // First writer wins: `a.png` and `a.jpg` collide on stem, and silently preferring the
    // later one would make the binding depend on readdir order.
    if (!byStem.has(stem(f))) byStem.set(stem(f), f);
  }

  const mapping = new Map();
  const problems = [];
  const claimedBy = new Map();

  const claim = (n, file, via) => {
    const prior = claimedBy.get(file);
    if (prior !== undefined && prior !== n) {
      problems.push(`ક્રમ ${n} and ક્રમ ${prior} both resolve to "${file}"`);
      return;
    }
    claimedBy.set(file, n);
    mapping.set(n, { file, via });
  };

  // Pass 1 — declarations. Done first and in full, so an inferred match can never steal a
  // file that some row has explicitly asked for.
  for (const row of rows) {
    const declared = String(row.file ?? '').trim();
    if (!declared) continue;
    const hit = byName.get(normalize(declared)) ?? byStem.get(stem(declared));
    if (hit) claim(row.n, hit, 'declared');
  }

  // Pass 2 — inference for whatever is left.
  const leftover = files.filter((f) => !claimedBy.has(f));
  const inferred = new Map();
  for (const f of leftover) {
    const got = indexFromFilename(f);
    if (!got) continue;
    if (inferred.has(got.n)) {
      problems.push(
        `"${f}" and "${inferred.get(got.n).file}" both infer ક્રમ ${got.n} — declare one in the ફોટો ફાઇલ column`
      );
      continue;
    }
    inferred.set(got.n, { file: f, pattern: got.pattern });
  }
  for (const row of rows) {
    if (mapping.has(row.n)) continue;
    const got = inferred.get(row.n);
    if (got) claim(row.n, got.file, `inferred:${got.pattern}`);
  }

  // A declaration that names nothing on disk is a typo in the sheet, not a missing image,
  // and is worth saying so explicitly — the row may still have been rescued by inference.
  for (const row of rows) {
    const declared = String(row.file ?? '').trim();
    if (!declared) continue;
    if (!byName.has(normalize(declared)) && !byStem.has(stem(declared))) {
      problems.push(
        `ક્રમ ${row.n}: ફોટો ફાઇલ "${declared}" is not in the image folder` +
          (mapping.has(row.n) ? ` (fell back to "${mapping.get(row.n).file}")` : '')
      );
    }
  }

  return {
    mapping,
    problems,
    unmatchedRows: rows.filter((r) => !mapping.has(r.n)).map((r) => r.n),
    unclaimedFiles: files.filter((f) => !claimedBy.has(f)),
  };
}

/** Canonical on-disk name for a master. Everything downstream of ingest sees only these. */
export const masterName = (n) => `darshan-${String(n).padStart(3, '0')}.png`;
