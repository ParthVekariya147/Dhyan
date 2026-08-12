import { useMemo, useState } from 'react';
import {
  expandRange,
  matchKind,
  orderSceneIds,
  searchScenes,
  summarise,
} from '../../../../../shared/domain/level4-selection.js';
import { gu } from '../../../lib/format';

/**
 * §5 — which દર્શન belong to this sub-level, picked either way.
 *
 * **Range** is how the collection is normally carved up: ૧–૨૫, ૨૬–૫૦. **Individual** is how
 * it is corrected afterwards — one દ્રશ્ય moved out, two added at the end. Both exist because
 * both are how the સંચાલક actually thinks, and neither is a mode the other has to be left to
 * reach: the mode buttons swap the *tool*, and the list underneath stays live in either one.
 * A range added while the checkboxes are still tickable is the shortest path from "roughly
 * this block" to "exactly these".
 *
 * **Every number typed and shown here is the number a user sees** (ORDERING.md decision #2).
 * "From 1 To 30" is the first thirty Darshan in the current order — the same ૧…૩૦ printed on
 * his cards — not the numbers the sheet happens to have printed on the artwork. Those are on
 * every row too, in grey, because a Darshan still has to be traceable back to the sheet: they
 * are shown, and searchable, and they select nothing. The two diverge the moment one Darshan
 * is withheld, and a picker that quietly used the sheet's numbering would hand the સંચાલક a
 * range that reads right and selects the wrong pictures.
 *
 * Every rule about what the selection *means* — duplicates across sub-levels, gaps, unknown
 * ids, ordering, what counts as a match — belongs to shared/domain/level4-selection.js. This
 * file arranges controls and calls it. It holds no total, no count of sub-levels and no code
 * such as '4.1' (§62).
 */
export default function SceneSelector({ collection, value, onChange, takenBy, withheld, disabled }) {
  const [mode, setMode] = useState('range');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);

  const selected = useMemo(() => new Set(value), [value]);

  /**
   * How far the numbering runs. Counted, never assumed (§62): it is the number of Darshan
   * that carry a display number at all, which is exactly the highest number the સંચાલક can
   * usefully type into the range boxes.
   */
  const numbered = useMemo(() => collection.filter((c) => Number.isInteger(c.displayIndex)).length, [collection]);

  /**
   * The rows on screen.
   *
   * `searchScenes` is the engine's — display number, sheet number, or વર્ણન substring, one
   * definition of "matches" shared with the યુવક side. What it hands back is normalised,
   * because a function that returns ids and a function that returns entries are both
   * reasonable readings of its contract and this page must not break on whichever it is.
   */
  const shown = useMemo(() => {
    const base = q.trim() ? asItems(searchScenes(collection, q.trim()), collection) : collection;
    // A દ્રશ્ય with no image, no વર્ણન, or withheld from the collection cannot be learned, so
    // offering it by default would build a sub-level that fails validation the moment it is
    // checked. `withheld` is the engine's own answer to that question (findInvalid), not a
    // second reading of `active` — the two must not drift. It stays reachable: the filter is
    // a filter, not a rule.
    return onlyAvailable ? base.filter((c) => !withheld?.has(c.id)) : base;
  }, [collection, q, onlyAvailable, withheld]);

  const summary = useMemo(() => summarise(value, collection), [value, collection]);

  const apply = (ids) => onChange(ids);

  const toggle = (id) => {
    if (selected.has(id)) apply(value.filter((v) => v !== id));
    else apply([...value, id]);
  };

  const addRange = () => {
    const ids = expandRange(collection, Number(from), Number(to));
    // Appended, not merged in collection order: §26 says the arrangement is the સંચાલક's, and
    // silently re-sorting what he just added would take that back. `Sort into order` below is
    // the same thing offered as a choice.
    const have = new Set(value);
    apply([...value, ...ids.filter((id) => !have.has(id))]);
  };

  const removeRange = () => {
    const drop = new Set(expandRange(collection, Number(from), Number(to)));
    apply(value.filter((id) => !drop.has(id)));
  };

  return (
    <>
      <div className="l4-summary">
        <div>
          <strong>{gu(summary.count)} of {gu(numbered)}</strong>
          <span>Darshan selected</span>
        </div>
        <div>
          <strong>{summary.count ? `${gu(summary.fromIndex)} – ${gu(summary.toIndex)}` : '—'}</strong>
          <span>Numbered as users see them</span>
        </div>
        <div>
          <strong>{summary.count ? (summary.contiguous ? 'Unbroken' : 'Has gaps') : '—'}</strong>
          <span>Run of numbers</span>
        </div>
      </div>

      <div className="l4-modes" role="group" aria-label="Selection mode">
        <button type="button" className="l4-mode" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>
          Range
        </button>
        <button type="button" className="l4-mode" aria-pressed={mode === 'individual'} onClick={() => setMode('individual')}>
          Individual
        </button>
      </div>

      {mode === 'range' ? (
        <>
          <div className="l4-tools">
            <div className="field">
              <label htmlFor="l4-from">From</label>
              <input id="l4-from" type="number" min="1" max={numbered || undefined} value={from} onChange={(e) => setFrom(e.target.value)} disabled={disabled} />
            </div>
            <div className="field">
              <label htmlFor="l4-to">To</label>
              <input id="l4-to" type="number" min="1" max={numbered || undefined} value={to} onChange={(e) => setTo(e.target.value)} disabled={disabled} />
            </div>
            <button className="btn" type="button" onClick={addRange} disabled={disabled || !from || !to}>
              Add Range
            </button>
            <button className="btn btn-quiet" type="button" onClick={removeRange} disabled={disabled || !from || !to}>
              Remove Range
            </button>
          </div>
          <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
            {gu(1)} – {gu(numbered)}, counted the way users count them. The grey number on each
            row is the one printed on the artwork; it is there to find a Darshan by, not to
            select by.
          </p>
        </>
      ) : (
        <div className="l4-tools">
          <div className="field grow">
            <label htmlFor="l4-q">Search</label>
            <input
              id="l4-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Number, sheet number, or description…"
            />
          </div>
          {/* Select All acts on what is on screen, never on the whole collection. A button
              whose effect depends on a filter you can see is predictable; one that quietly
              reaches past it is not. */}
          <button
            className="btn btn-quiet"
            type="button"
            disabled={disabled || !shown.length}
            onClick={() => {
              const have = new Set(value);
              apply([...value, ...shown.map((s) => s.id).filter((id) => !have.has(id))]);
            }}
          >
            Select All Shown
          </button>
          <button className="btn btn-quiet" type="button" disabled={disabled || !value.length} onClick={() => apply([])}>
            Clear All
          </button>
        </div>
      )}

      <div className="l4-tools">
        <div className="field">
          <label htmlFor="l4-filter">Show</label>
          <select id="l4-filter" value={onlyAvailable ? 'ok' : 'all'} onChange={(e) => setOnlyAvailable(e.target.value === 'ok')}>
            <option value="ok">Ready to learn</option>
            <option value="all">All Darshan</option>
          </select>
        </div>
        <button
          className="btn btn-quiet"
          type="button"
          disabled={disabled || value.length < 2}
          onClick={() => apply(orderSceneIds(value, collection))}
          title="Put the selected Darshan back into the order users meet them in"
        >
          Sort into order
        </button>
        <span className="hint" style={{ paddingBottom: 9 }}>
          Showing {gu(shown.length)} of {gu(collection.length)}
        </span>
      </div>

      <div className="l4-list">
        {shown.map((row) => {
          const taken = takenBy?.get(row.id);
          const display = Number.isInteger(row.displayIndex) ? row.displayIndex : null;
          const source = Number.isInteger(row.sourceIndex) ? row.sourceIndex : row.index;
          // Which numbering the search actually hit, so a result never has to be guessed at:
          // `47` finds both the forty-seventh Darshan and the one printed 47, and after a
          // single withholding those are two different pictures.
          const why = q.trim() ? matchKind(row, q.trim()) : '';
          return (
            <label className="l4-row" key={row.id}>
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
                disabled={disabled}
              />
              <span className="l4-row-n" title={display === null ? 'Withheld — users never reach it, so it has no number' : 'The number users see'}>
                {display === null ? '—' : gu(display)}
              </span>
              <span className="l4-row-src" title="The number printed on the artwork">
                {Number.isInteger(source) ? `#${gu(source)}` : ''}
              </span>
              <span className="l4-row-t">{row.caption || <em className="hint">No description written</em>}</span>
              {why === 'source' && <span className="l4-row-why">sheet number</span>}
              {why === 'text' && <span className="l4-row-why">description</span>}
              {withheld?.has(row.id) && <span className="pill pill-off" title={row.reason}>Not ready</span>}
              {taken && <span className="l4-row-taken">in {taken}</span>}
            </label>
          );
        })}
        {!shown.length && <p className="hint" style={{ padding: 14 }}>Nothing matches this search.</p>}
      </div>
    </>
  );
}

/** ids or entries → entries. See the note on `shown` above. */
function asItems(result, collection) {
  if (!Array.isArray(result)) return collection;
  if (!result.length) return [];
  if (typeof result[0] !== 'string') return result;
  const byId = new Map(collection.map((c) => [c.id, c]));
  return result.map((id) => byId.get(id)).filter(Boolean);
}
