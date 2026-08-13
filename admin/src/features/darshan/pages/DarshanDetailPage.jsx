import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { listDarshan, saveScene, setSceneImage, validateImageUrl } from '../services/darshanService';
import { AsyncBlock, CardSkeleton, Empty, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { dateTimeGu, gu } from '../../../lib/format';
import { ACTIONS } from '../../../../../shared/domain/audit.js';
import { saveError } from '../../../lib/errors';
import '../darshan.css';

/**
 * §30 — one દ્રશ્ય, and the four things it is made of.
 *
 *   the **link**        where the picture is, in Google Drive
 *   the **શીર્ષક**       the short name it is listed under (0013)
 *   the **વર્ણન**       what the દ્રશ્ય shows
 *   the **number**      the ક્રમ, and separately the order it is presented in
 *
 * The title is the newest of the four and the only one that changes nothing for a યુવક: it
 * is not part of the content gate, so naming a દ્રશ્ય neither publishes it nor withholds it
 * (DARSHAN_DATA_CONTRACT.md §2.1). It is edited here rather than anywhere else because it
 * belongs beside the વર્ણન — the two are the words of a દ્રશ્ય, long and short.
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
 *
 * **Withholding renumbers, and says so first** (ORDERING.md decision #3). The number a યુવક
 * sees is a દ્રશ્ય's place among the ones he is *shown*, so turning one off — or back on —
 * moves every number below it. That is not a side effect to discover afterwards: the dialog states
 * how many દર્શન shift before anything is written. He may still go ahead. He is simply never
 * surprised.
 */
export default function DarshanDetailPage() {
  const { itemId } = useParams();
  // The whole sequenced collection, not one row. `listDarshan()` reads all of it either way —
  // `getDarshanItem()` was a `.find()` over exactly this — and the rest of it is what makes
  // the renumber count below a count rather than a guess.
  const state = useAsync(
    () => listDarshan().then((items) => ({ items, item: items.find((i) => i.id === itemId) || null })),
    [itemId]
  );
  const item = state.data?.item || null;
  const items = useMemo(() => state.data?.items || [], [state.data]);

  /**
   * What turning this દ્રશ્ય off — or on — does to everybody else's numbers.
   *
   * Counted from the sequence that is loaded, on the one rule that produces it: `displayIndex`
   * runs 1…N over the numbered દર્શન in canonical order, so every numbered દ્રશ્ય *after* this
   * one shifts by exactly one and nothing before it moves at all. Withholding shifts them
   * down, reactivating shifts them up; the count is the same either way.
   *
   * Counted on `displayIndex != null` and **not** on `active`, because they are not the same
   * question and this is the one that matters here. shared/domain/darshan.js numbers a દ્રશ્ય
   * only when a યુવક can actually be shown it — image *and* વર્ણન — so a row switched on
   * before its વર્ણન was written reads `active: true` in this panel and still carries no
   * number. Counting the `active` badge instead would promise a renumbering that never
   * happens, and `changes` below is the same distinction: turning on a દ્રશ્ય with no image
   * moves nobody.
   *
   * `willBe` is the number this દ્રશ્ય itself holds — its own place among the numbered ones.
   * For one that is already shown it is `displayIndex`; for a withheld one it is the number it
   * would come back as.
   */
  const renumber = useMemo(() => {
    const at = items.findIndex((i) => i.id === itemId);
    if (at < 0) return null;
    const now = items[at];
    const numbered = (i) => i.displayIndex != null;
    return {
      changes: numbered(now) !== (now.active ? false : !!now.caption && !!now.imageUrl),
      willBe: items.slice(0, at).filter(numbered).length + 1,
      after: items.slice(at + 1).filter(numbered).length,
    };
  }, [items, itemId]);

  const [pending, setPending] = useState(null); // the confirmed action, or null
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [order, setOrder] = useState('');
  const [newUrl, setNewUrl] = useState('');
  // null means "untouched, show the saved value". An empty string is a real edit — the
  // સંચાલક clearing the field — so '' cannot double as the sentinel the way it does for
  // `order`, or clearing a વર્ણન would silently snap back to the old text.
  const [caption, setCaption] = useState(null);
  // The short name, with the same null-means-untouched sentinel and for the same reason.
  const [title, setTitle] = useState(null);

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
      setTitle(null);
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
      {/*
        The શીર્ષક is the heading when there is one, because "darshan-041" is the file name
        and not the thing; the id stays on the line under it and in the crumb, which is what
        every message about this દ્રશ્ય will name. The crumb is the way back up — this page is
        arrived at from the grid and there is otherwise nothing on screen that leads back to
        it — and the button beside it is the same journey at a size a thumb can hit.
      */}
      <PageHeader
        title={item?.title?.trim() || itemId}
        sub={item ? `${item.id} · number printed in the image - ${gu(item.index)}` : ''}
        crumbs={[{ to: '/darshan', label: 'Darshan' }, { label: itemId }]}
        actions={<Link className="btn btn-quiet" to="/darshan">← All Darshan</Link>}
      />

      <AsyncBlock
        state={state}
        onRetry={state.retry}
        skeleton={
          <div className="detail-cols">
            <div className="dg-loading"><CardSkeleton count={1} /></div>
            <FormSkeleton fields={4} />
          </div>
        }
      >
        {!item ? (
          /* §35 — a wrong id is a dead end unless it offers the way out of itself. */
          <Empty
            icon="❑"
            title="No Darshan with this ID"
            message={`Nothing in the collection is called “${itemId}”. It may have been renumbered, or the link may be mistyped.`}
            action={<Link className="btn" to="/darshan">Back to all Darshan</Link>}
          />
        ) : (
          <>
            {msg && (
              <div className={`notice notice-${msg.tone}`} role={msg.tone === 'danger' ? 'alert' : 'status'}>
                {msg.text}
              </div>
            )}

            <div className="detail-cols">
              <div className="preview">
                {/* The image as a યુવક sees it, at the full width Google will encode it to —
                    this is the one place in the panel that must not be a thumbnail, because
                    inspecting the artwork is what the page is for. Eager for the same reason:
                    it is the reason the page was opened, not something scrolled past. A દ્રશ્ય
                    with no link yet says so rather than showing a broken frame — §1, never a
                    dead end, applies to the panel too. */}
                {item.imageUrl ? (
                  <img
                    src={item.fullUrl || item.imageUrl}
                    alt={`Darshan ${item.index}`}
                    loading="eager"
                    decoding="async"
                    /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="notice notice-warn">
                    No image link is set for this Darshan yet, so users are not shown it. Paste a
                    Google Drive link in the box beside this to give it one.
                  </div>
                )}
              </div>

              <div>
                <section className="card" aria-labelledby="details-h">
                  <h2 id="details-h">Details</h2>
                  <dl className="kv">
                    <dt>ID</dt><dd className="mono">{item.id}</dd>
                    <dt>Number (in image)</dt><dd className="mono">{item.sourceIndex ?? item.index}</dd>
                    {/* The number a યુવક actually counts by. Withheld દર્શન are not counted at
                        all, so this is blank for one — the contract, not a missing value. */}
                    <dt>Number users see</dt>
                    <dd className="mono">
                      {item.displayIndex == null ? 'Not shown' : gu(item.displayIndex)}
                    </dd>
                    <dt>Order</dt><dd className="mono">{item.order}</dd>
                    <dt>Status</dt>
                    <dd>
                      {/* §47 — the one badge, so "Active" here is the same object it is on
                          the grid. The word is the meaning; the tint only repeats it. */}
                      {item.active
                        ? <StatusBadge tone="ok">Active</StatusBadge>
                        : <StatusBadge tone="off">{item.reason || 'Off'}</StatusBadge>}
                    </dd>
                    {item.file && <><dt>File in Drive</dt><dd className="mono">{item.file}</dd></>}
                    {item.driveId && <><dt>Drive ID</dt><dd className="mono">{item.driveId}</dd></>}
                    <dt>Image URL</dt><dd className="mono">{item.imageUrl || '-'}</dd>
                    <dt>Source</dt><dd>{item.source}</dd>
                    <dt>Updated</dt><dd>{item.updatedAt ? dateTimeGu(item.updatedAt) : '-'}</dd>
                  </dl>
                  {/* The વર્ણન is not repeated here — it is editable in the next card, and
                      showing it twice is the duplicate this page's design rejects (§23). */}
                </section>

                <section className="card" aria-labelledby="edit-h">
                  <h2 id="edit-h">Edit</h2>
                  <p className="hint d-note">
                    Five separate saves, each confirmed on its own. Nothing here is written until
                    you answer its dialog.
                  </p>

                  {/*
                    The link. One box, one paste, one save — and the same converter the build
                    script uses, so what is set here is byte-for-byte the URL a rebuild would
                    have produced.
                  */}
                  <div className="d-block">
                    <h3>Image link</h3>
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
                  </div>

                  {/*
                    The short name (0013), placed immediately above the વર્ણન because the two
                    are edited together and the difference between them is easiest to see when
                    they are side by side: a few words here, a whole sentence below.

                    A plain text input, so a Gujarati keyboard or IME writes into it exactly as
                    it writes into the વર્ણન box — nothing here transforms, normalises or
                    trims-to-ASCII what is typed. Only the surrounding whitespace is trimmed on
                    save, the same as the વર્ણન.

                    It is not repeated in the Details card above. The વર્ણન is not either, for
                    the reason given there (§23): a value shown in two places is a value that
                    can be read stale in one of them.
                  */}
                  <div className="d-block">
                    <h3>Title</h3>
                    <div className="field">
                      <label htmlFor="title">Title (શીર્ષક)</label>
                      <input
                        id="title"
                        type="text"
                        value={title ?? item.title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="આ દ્રશ્યનું ટૂંકું નામ…"
                      />
                      <span className="hint">
                        A few words naming this Darshan, for lists and headings. It is not shown
                        instead of the description and it does not decide whether users see this
                        Darshan - that still needs an image and a description.
                      </span>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      disabled={title === null || title.trim() === item.title}
                      onClick={() =>
                        setPending({
                          title: title.trim() ? 'Save this title?' : 'Clear the title?',
                          body: title.trim()
                            ? `${item.id} will be listed as “${title.trim()}”. Nothing users see changes - the title is used in this panel and in headings.`
                            : `${item.id} will go back to being listed by its number alone.`,
                          patch: { title: title.trim() },
                          action: ACTIONS.DARSHAN_UPDATED,
                          meta: { index: item.index },
                        })
                      }
                    >
                      Save title
                    </button>
                  </div>

                  {/*
                    §12 — the વર્ણન editor. Saving an empty field is not a mistake and is not
                    blocked: it clears the override and the દ્રશ્ય falls back to the વર્ણન in
                    the સંચાલક's sheet, which is the only way back after a bad edit.
                  */}
                  <div className="d-block">
                    <h3>Description</h3>
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
                          : 'This Darshan has no description yet, so users are not shown it. Writing one here publishes it - no rebuild needed.'}
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
                  </div>

                  <div className="d-block">
                    <h3>Display order</h3>
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
                        The number shown in the image ({gu(item.index)}) does not change - it is part
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
                  </div>

                  <div className="d-block">
                    <h3>Shown to users</h3>
                    {/* §31 — disable, never delete. There is no delete button on this page.
                        Decision #3 — and it does not happen without the renumbering being
                        stated first, in Darshan, counted from the sequence above. */}
                    <button
                      className={`btn ${item.active ? 'btn-danger' : ''}`}
                      type="button"
                      onClick={() =>
                        setPending({
                          title: item.active ? 'Turn this Darshan off?' : 'Turn this Darshan on?',
                          body: <RenumberWarning item={item} renumber={renumber} />,
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
                </section>
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

/**
 * ORDERING.md decision #3 — the sentence that stops a renumbering being a surprise.
 *
 * Every number in it is counted from the collection that is loaded (`renumber`), never
 * written down here and never estimated: the collection is whatever the sheet holds, and a
 * literal in this paragraph would be wrong the first time a દ્રશ્ય was added (§62).
 *
 * It says what changes *and* what does not, because the second half is the part that stops
 * this looking dangerous: the number drawn inside the artwork is identity, the finished work
 * of every યુવક follows the દ્રશ્ય and not its position, and turning it back on puts every
 * number back exactly where it was.
 */
function RenumberWarning({ item, renumber }) {
  const willBe = renumber?.willBe ?? 0;
  const after = renumber?.after ?? 0;
  // `changes` false means this switch does not add or remove a number at all — turning on a
  // દ્રશ્ય that still has no image, most often. Nothing shifts, and saying it would shift
  // would be the surprise this dialog exists to prevent.
  const changes = !!renumber?.changes;
  const many = after === 1 ? 'the one Darshan below it' : `the ${gu(after)} Darshan below it`;

  return (
    <>
      {item.active ? (
        <p>
          A Darshan that is turned off is not shown to users. Nothing is deleted - it can be
          turned back on at any time.
        </p>
      ) : changes ? (
        <p>This Darshan will start showing to users again, as number {gu(willBe)}.</p>
      ) : (
        <p>
          This Darshan is switched back on, but users still will not see it
          {item.reason ? ` - ${item.reason.toLowerCase()}` : ''}. So nothing is renumbered.
        </p>
      )}

      {!changes && item.active && (
        <p style={{ marginTop: 8 }}>
          It carries no number today
          {item.reason ? ` - ${item.reason.toLowerCase()}` : ''}, so no other Darshan is renumbered.
        </p>
      )}

      {changes && (
        <p style={{ marginTop: 8 }}>
          {after === 0 ? (
            item.active
              ? 'It is the last Darshan users see, so no other Darshan is renumbered.'
              : 'It goes to the end of the collection, so no other Darshan is renumbered.'
          ) : (
            <>
              This renumbers {many}: what users now see as{' '}
              {gu(item.active ? willBe + 1 : willBe)} becomes{' '}
              {gu(item.active ? willBe : willBe + 1)}, and so on to the end of the collection.
            </>
          )}
        </p>
      )}

      <p style={{ marginTop: 8 }}>
        The number printed inside each image does not change, and nothing anyone has already
        finished is affected - Level 3 and Level 4 follow the Darshan itself, not its number.
      </p>
    </>
  );
}
