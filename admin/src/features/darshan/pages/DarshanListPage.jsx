import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { createScene, listDarshan, nextDarshanSlot, validateNewScene } from '../services/darshanService';
import { AsyncBlock } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import { useAdminAuth } from '../../../lib/adminAuth';
import { dataError } from '../../../lib/errors';
import { gu } from '../../../lib/format';

/**
 * §21 — the દર્શન collection.
 *
 * The count is items.length. It is not 108, not 109, and not any other literal (§62):
 * the repository currently ships 100 finished assets, and the requirement document asks
 * for 108. That gap is shown on the તપાસ page as a finding, not papered over here.
 *
 * Each tile is the finished asset and nothing else. The artwork already contains its
 * Gujarati વર્ણન and its printed number — they are pixels, not data (§23) — so drawing a
 * title or an index over the thumbnail would render the same information twice, once
 * wrong. The number under the tile is the record's id, which is a different thing.
 *
 * Thumbnails ask Google's CDN for a 400 px encode of the same Drive file (`thumbUrl`) and
 * are lazy: a hundred tiles at full width would repeat, inside the panel, the 25 MB problem
 * the યુવક app was rebuilt to fix.
 */
export default function DarshanListPage() {
  const state = useAsync(() => listDarshan(), []);
  const [filter, setFilter] = useState('all');
  const { can } = useAdminAuth();
  const navigate = useNavigate();

  // The add form. `draft` is null when it is closed, so opening it is what seeds the
  // ક્રમ from the collection — reading `items` at render time instead would reset the
  // સંચાલક's typing every time the list reloaded underneath him.
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const items = state.data || [];
  const shown = useMemo(
    () => items.filter((i) => (filter === 'all' ? true : filter === 'active' ? i.active : !i.active)),
    [items, filter]
  );

  const active = items.filter((i) => i.active).length;
  const mayCreate = can('darshan.create');

  const submit = async () => {
    const check = validateNewScene(items, draft);
    if (!check.ok) {
      setErr(check.gu);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const id = await createScene({ index: check.index, order: check.order, caption: draft.caption });
      // Straight to the detail page, because a દ્રશ્ય created here is not finished: it has
      // no artwork until the સંચાલક sets its image link, and that control lives there. Landing
      // him back on a grid where the new tile has no image would look like a failure.
      navigate(`/darshan/${id}`);
    } catch (e) {
      setErr(dataError(e));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Darshan"
        sub="Every image is fully finished — the description and number are inside the image itself"
        actions={
          <>
            {mayCreate && !draft && (
              <button className="btn" type="button" onClick={() => { setErr(null); setDraft({ ...nextDarshanSlot(items), caption: '' }); }}>
                Add Darshan
              </button>
            )}
            {/* §12 — the sheet route. `darshan.update` and not `darshan.create`: the
                importer only ever edits દ્રશ્યો that already exist (a ક્રમ it does not
                recognise is reported, never created), and the route's own Gate in App.jsx
                names the same permission — a link that leads to a refusal is worse than no
                link (§10). */}
            {can('darshan.update') && (
              <Link className="btn btn-quiet" to="/darshan/import">Import from sheet</Link>
            )}
            <Link className="btn btn-quiet" to="/darshan/health">Health report</Link>
          </>
        }
      />

      {/*
        Adding a દ્રશ્ય without a rebuild (§12).

        The sheet remains the source of truth for a batch — a hundred દ્રશ્યો arrive through
        `npm run darshan`, not through this form. This is for the single
        દ્રશ્ય that is needed now, and it deliberately creates a *placeholder*: a row with a
        number, an order and optionally a વર્ણન, and no artwork at all.

        That is why the hint below promises nothing to યુવકો. createScene() writes the row
        DRAFT, so it stays invisible until an image link has been set on the detail
        page. A tile with no picture is a dead end, and §1 says a યુવક is never handed one.
      */}
      {draft && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="filters">
            <div className="field">
              <label htmlFor="new-index">Number (ક્રમ)</label>
              <input
                id="new-index"
                type="number"
                min="1"
                value={draft.index}
                onChange={(e) => setDraft({ ...draft, index: Number(e.target.value) })}
              />
              <span className="hint">Becomes {`darshan-${String(draft.index || 0).padStart(3, '0')}`}.</span>
            </div>
            <div className="field">
              <label htmlFor="new-order">Order</label>
              <input
                id="new-order"
                type="number"
                min="1"
                value={draft.order}
                onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) })}
              />
              <span className="hint">Where it sits in the sequence. May differ from the number.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="new-caption">Description (વર્ણન)</label>
            <textarea
              id="new-caption"
              rows={3}
              value={draft.caption}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              placeholder="આ દ્રશ્યનું વર્ણન લખો…"
            />
            <span className="hint">
              Optional now, required before users see it. The new Darshan is created as a draft with no image — add a link to
              one on its page, and it stays hidden from users until you do.
            </span>
          </div>

          {err && <div className="notice notice-danger" role="status">{err}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={submit}>
              {busy ? 'Creating…' : 'Create Darshan'}
            </button>
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => { setDraft(null); setErr(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid-stats">
        <StatCard label="Total" value={gu(items.length)} loading={state.loading} />
        <StatCard label="Active" value={gu(active)} tone="ok" loading={state.loading} />
        <StatCard label="Off" value={gu(items.length - active)} loading={state.loading} />
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="f">Show</label>
          <select id="f" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Off only</option>
          </select>
        </div>
      </div>

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !shown.length }}
        empty="No Darshan found with this filter."
        onRetry={state.retry}
      >
        <div className="dg">
          {shown.map((it) => (
            <Link className="dg-item" key={it.id} to={`/darshan/${it.id}`}>
              {/*
                A દ્રશ્ય with no artwork gets a box, not an <img>.

                It became reachable when the panel learned to create દ્રશ્યો: such a record
                is a row before it is a picture, so `thumbUrl` and `imageUrl` are both ''.
                An `<img src="">` is not merely ugly — the browser resolves the empty URL
                against the current document and re-requests the whole page, which React
                warns about for that reason. The placeholder also gives the સંચાલક
                somewhere to read *why*, which a broken-image glyph never did.
              */}
              {it.thumbUrl || it.imageUrl ? (
                <img
                  src={it.thumbUrl || it.imageUrl}
                  loading="lazy"
                  decoding="async"
                  alt={`Darshan ${it.index}`}
                />
              ) : (
                <span className="dg-empty">No image yet</span>
              )}
              <div className="dg-meta">
                <span className="dg-id">{it.id}</span>
                {it.active ? (
                  <span className="pill pill-ok">Active</span>
                ) : (
                  <span className="pill pill-off" title={it.reason}>Off</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </AsyncBlock>
    </>
  );
}
