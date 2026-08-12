import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { getDarshanItem, saveScene, setSceneImage, validateImageUrl } from '../services/darshanService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { dateTimeGu, gu } from '../../../lib/format';
import { ACTIONS } from '../../../../../shared/domain/audit.js';
import { saveError } from '../../../lib/errors';

/**
 * §30 — one દ્રશ્ય, and the three things it is made of.
 *
 *   the **link**        where the picture is, in Google Drive
 *   the **વર્ણન**       what the દ્રશ્ય shows
 *   the **number**      the ક્રમ, and separately the order it is presented in
 *
 * That is the whole editable surface, and it is deliberately the whole of it. This page
 * used to carry a second image control — "Publish from Google Drive" — which queued a
 * background job to download the file, encode six widths in three formats, store them, and
 * report back through four columns the page polled every 2.5 seconds. Both boxes took a
 * Drive link; only one of them was the real one; neither name said which.
 *
 * Now there is one box, it takes a Drive link, and saving it *is* the change — Google's
 * image CDN does the resizing and re-encoding on request. No queue, no polling, no job to
 * fail silently.
 *
 * The preview is the delivered image and nothing else. No title overlay, no caption bar, no
 * index badge: the artwork already carries all three, drawn into the pixels by whoever
 * designed it (§23).
 *
 * Every change here is confirmed first (§57), audited after (§41), and reversible: disable
 * rather than delete (§31), and a new link replaces nothing — the old file stays in Drive,
 * so a rollback is pasting the previous link back (§28).
 */
export default function DarshanDetailPage() {
  const { itemId } = useParams();
  const state = useAsync(() => getDarshanItem(itemId), [itemId]);
  const item = state.data;

  const [pending, setPending] = useState(null); // the confirmed action, or null
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [order, setOrder] = useState('');
  const [newUrl, setNewUrl] = useState('');
  // null means "untouched, show the saved value". An empty string is a real edit — the
  // સંચાલક clearing the field — so '' cannot double as the sentinel the way it does for
  // `order`, or clearing a વર્ણન would silently snap back to the old text.
  const [caption, setCaption] = useState(null);

  async function commit() {
    if (!pending) return;
    setBusy(true);
    try {
      // The audit row is written by the `audit_scenes` trigger, in the same transaction as
      // this save (0004_rbac.sql). Nothing to log from here, and nothing that can fail
      // separately: if the save returned, the trail has the entry.
      if (pending.run) await pending.run();
      else await saveScene(itemId, pending.patch);
      setMsg({ tone: 'ok', text: 'Saved.' });
      setPending(null);
      setNewUrl('');
      setOrder('');
      setCaption(null);
      state.retry();
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={itemId}
        sub={item ? `Number shown in the image — ${gu(item.index)}` : ''}
        actions={<Link className="btn btn-quiet" to="/darshan">← Darshan</Link>}
      />

      <AsyncBlock state={state} onRetry={state.retry}>
        {!item ? (
          <div className="card"><p>There is no Darshan with this ID.</p></div>
        ) : (
          <>
            {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}

            <div className="detail-cols">
              <div className="preview">
                {/* The image as a યુવક sees it. Not lazy: it is the reason the page was
                    opened. A દ્રશ્ય with no link yet says so rather than showing a broken
                    frame — §1, never a dead end, applies to the panel too. */}
                {item.imageUrl ? (
                  <img src={item.fullUrl || item.imageUrl} alt={`Darshan ${item.index}`} decoding="async" />
                ) : (
                  <div className="card"><p>No image link set for this Darshan yet.</p></div>
                )}
              </div>

              <div>
                <div className="card">
                  <h2>Details</h2>
                  <dl className="kv">
                    <dt>ID</dt><dd className="mono">{item.id}</dd>
                    <dt>Number (in image)</dt><dd className="mono">{item.index}</dd>
                    <dt>Order</dt><dd className="mono">{item.order}</dd>
                    <dt>Status</dt>
                    <dd>
                      {item.active
                        ? <span className="pill pill-ok">Active</span>
                        : <span className="pill pill-off">{item.reason || 'Off'}</span>}
                    </dd>
                    {item.file && <><dt>File in Drive</dt><dd className="mono">{item.file}</dd></>}
                    {item.driveId && <><dt>Drive ID</dt><dd className="mono">{item.driveId}</dd></>}
                    <dt>Image URL</dt><dd className="mono">{item.imageUrl || '—'}</dd>
                    <dt>Source</dt><dd>{item.source}</dd>
                    <dt>Updated</dt><dd>{item.updatedAt ? dateTimeGu(item.updatedAt) : '—'}</dd>
                  </dl>
                  {/* The વર્ણન is not repeated here — it is editable in the next card, and
                      showing it twice is the duplicate this page's design rejects (§23). */}
                </div>

                <div className="card">
                  <h2>Edit</h2>

                  {/*
                    The link. One box, one paste, one save — and the same converter the build
                    script uses, so what is set here is byte-for-byte the URL a rebuild would
                    have produced.
                  */}
                  <div className="field">
                    <label htmlFor="url">Image link (Google Drive)</label>
                    <input
                      id="url"
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/…/view"
                    />
                    <span className="hint">
                      In Drive: right-click the image → Share → General access → “Anyone with
                      the link”, then Copy link. The link is converted automatically to the
                      form a browser can display. Nothing is uploaded or deleted, so this can
                      be rolled back by pasting the previous link.
                    </span>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    disabled={!newUrl.trim()}
                    onClick={() => {
                      const v = validateImageUrl(newUrl, item.imageUrl);
                      if (!v.ok) return setMsg({ tone: 'danger', text: v.gu });
                      setPending({
                        title: 'Change the image?',
                        body:
                          `${item.id} will show this image from now on. The file in Drive is not touched.` +
                          (v.note ? `\n\n${v.note}` : ''),
                        // Through the service, not a bare patch: the URL, the Drive id and
                        // the original paste have to move together or the enlarged view
                        // would go on asking for the previous image.
                        run: () => setSceneImage(itemId, newUrl),
                        action: ACTIONS.IMAGE_REPLACED,
                        meta: { from: item.imageUrl, to: v.url },
                      });
                    }}
                  >
                    Save image link
                  </button>

                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

                  {/*
                    §12 — the વર્ણન editor. Saving an empty field is not a mistake and is not
                    blocked: it clears the override and the દ્રશ્ય falls back to the વર્ણન in
                    the સંચાલક's sheet, which is the only way back after a bad edit.
                  */}
                  <div className="field">
                    <label htmlFor="caption">Description (વર્ણન)</label>
                    <textarea
                      id="caption"
                      rows={3}
                      value={caption ?? item.caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="આ દ્રશ્યનું વર્ણન લખો…"
                    />
                    <span className="hint">
                      {item.caption
                        ? 'Shown under the image at Level 2 and read on its own at Level 3. Clearing this restores the text from the sheet.'
                        : 'This Darshan has no description yet, so users are not shown it. Writing one here publishes it — no rebuild needed.'}
                    </span>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    disabled={caption === null || caption === item.caption}
                    onClick={() =>
                      setPending({
                        title: caption.trim() ? 'Save this description?' : 'Clear the description?',
                        body: caption.trim()
                          ? `${item.id} will show this description to users.${
                              item.active ? '' : ' It will also start being shown, because a Darshan becomes active once it has a description and an image.'
                            }`
                          : `The description set here will be removed and ${item.id} will fall back to the text in the sheet.`,
                        patch: { caption: caption.trim() },
                        action: ACTIONS.DARSHAN_UPDATED,
                        meta: { index: item.index },
                      })
                    }
                  >
                    Save description
                  </button>

                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

                  <div className="field">
                    <label htmlFor="order">Order</label>
                    <input
                      id="order"
                      type="number"
                      min="1"
                      value={order === '' ? item.order : order}
                      onChange={(e) => setOrder(e.target.value)}
                    />
                    <span className="hint">
                      The number shown in the image ({gu(item.index)}) does not change — it is part
                      of the image. This is only the display order.
                    </span>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    disabled={order === '' || Number(order) === item.order}
                    onClick={() =>
                      setPending({
                        title: 'Change the order?',
                        body: `The order of ${item.id} will be changed from ${item.order} to ${order}.`,
                        patch: { order: Number(order) },
                        action: ACTIONS.DARSHAN_ORDER_CHANGED,
                        meta: { from: item.order, to: Number(order) },
                      })
                    }
                  >
                    Save order
                  </button>

                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

                  {/* §31 — disable, never delete. There is no delete button on this page. */}
                  <button
                    className={`btn ${item.active ? 'btn-danger' : ''}`}
                    type="button"
                    onClick={() =>
                      setPending({
                        title: item.active ? 'Turn this Darshan off?' : 'Turn this Darshan on?',
                        body: item.active
                          ? 'A Darshan that is turned off will not be shown to users. Nothing is deleted — it can be turned back on at any time.'
                          : 'This Darshan will start showing to users again.',
                        patch: { active: !item.active },
                        action: item.active ? ACTIONS.DARSHAN_DISABLED : ACTIONS.DARSHAN_ACTIVATED,
                        meta: { index: item.index },
                      })
                    }
                  >
                    {item.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <p className="card-note">There is deliberately no option to delete a Darshan permanently.</p>
                </div>
              </div>
            </div>

            <ConfirmDialog
              open={!!pending}
              title={pending?.title || ''}
              body={pending?.body || ''}
              danger={pending?.action === ACTIONS.DARSHAN_DISABLED}
              busy={busy}
              onConfirm={commit}
              onCancel={() => setPending(null)}
            />
          </>
        )}
      </AsyncBlock>
    </>
  );
}
