import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import {
  createScene,
  listDarshan,
  nextDarshanSlot,
  reorderDarshan,
  saveScene,
  validateNewScene,
} from '../services/darshanService';
import { AsyncBlock, CardSkeleton } from '../../../components/StateBlocks';
import StatCard, { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useAdminAuth } from '../../../lib/adminAuth';
import { dataError, saveError } from '../../../lib/errors';
import { gu } from '../../../lib/format';
import { validateDarshanItems, withDisplayIndex } from '../../../../../shared/domain/darshan.js';
import {
  downloadDarshanInstructions,
  downloadDarshanTemplate,
  exportDarshanCsv,
} from '../../../lib/darshanExport';
import '../darshan.css';

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
 * wrong. The numbers under the tile are the record's, which is a different thing.
 *
 * Thumbnails ask Google's CDN for a 400 px encode of the same Drive file (`thumbUrl`) and
 * are lazy: a hundred tiles at full width would repeat, inside the panel, the 25 MB problem
 * the યુવક app was rebuilt to fix.
 *
 * ---------------------------------------------------------------------------------------
 *
 * **Two numbers, and the difference between them** (ORDERING.md §1).
 *
 *   sourceIndex   the number printed inside the artwork. Identity. Nothing here rewrites it.
 *   displayIndex  what a યુવક actually sees — 1…N over the *active* દર્શન, derived on read.
 *
 * A withheld દ્રશ્ય has no display number at all, and that is the contract rather than a
 * gap: it is not counted, so the numbering a યુવક sees never has a hole in it. It is still
 * listed, because the list is where it is brought back.
 *
 * **Arranging.** The order is edited in a mode of its own, and the mode exists for one
 * reason: `darshan_reorder()` is given the *whole* sequence, so an arrangement made over a
 * filtered subset would be meaningless. Entering it therefore lists every દ્રશ્ય and puts
 * the filter away. Dragging moves a working copy and writes nothing; `Save Order` sends the
 * complete id list in one call and `Cancel` throws the working copy away.
 *
 * ---------------------------------------------------------------------------------------
 *
 * **Selecting, and the four things a selection is for.** A collection of this size is edited
 * in handfuls, and doing it one detail page at a time is how a hundred દ્રશ્યો end up in three
 * different states nobody meant. So the tiles tick, and a ticked set can be:
 *
 *   Validated   checked, and nothing else — it writes nothing at all. See runCheck().
 *   Published   status → PUBLISHED
 *   Turned off  status → DISABLED
 *   Exported    to a spreadsheet the importer can read straight back
 *
 * There is deliberately **no bulk delete**, exactly as there is no delete on the detail page
 * (§31). A દ્રશ્ય is withheld by its status and comes back the same way; nothing in this panel
 * destroys content, and fifty rows at once would be the worst possible place to start.
 *
 * `status` is what those writes touch, never `active`. The `scenes_sync_status` trigger
 * derives `active := status in ('PUBLISHED','ACTIVE')` on every write (0004_rbac.sql), so
 * writing both would be one of them telling the database something it is about to work out
 * for itself — and `audit_scene()` reads the same column, which is how a bulk publish lands
 * in `audit_logs` as DARSHAN_PUBLISHED rather than as a heap of anonymous updates.
 *
 * The selection is **confined to what is on screen**: it is intersected with the current
 * filter on every render, so a bulk action can never reach a દ્રશ્ય the સંચાલક is not looking
 * at. It is put away entirely while arranging — that mode is about the sequence as a whole
 * and has no room for a subset.
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

  const items = useMemo(() => state.data || [], [state.data]);
  const shown = useMemo(
    () => items.filter((i) => (filter === 'all' ? true : filter === 'active' ? i.active : !i.active)),
    [items, filter]
  );

  const active = items.filter((i) => i.active).length;
  /**
   * How many દર્શન actually carry a number, which is a narrower question than the Active
   * badge and is the one the reorder dialog is about. shared/domain/darshan.js numbers a
   * દ્રશ્ય only when a યુવક can be shown it — image *and* વર્ણન — so a row switched on before
   * its વર્ણન was written is Active here and still has no number.
   */
  const numbered = items.filter((i) => i.displayIndex != null).length;
  const mayCreate = can('darshan.create');
  /**
   * The panel's half of the rule. The boundary is `has_permission('darshan.update')` inside
   * `darshan_reorder()` itself, which refuses the write whatever this page renders — the same
   * arrangement every other section of this console has (shared/domain/permissions.js sets
   * out the convention). Nothing new was added for reordering: it is an edit to દર્શન, so it
   * is the દર્શન update permission.
   */
  const mayReorder = can('darshan.update');

  /**
   * Reading is what an export is, so `darshan.read` is what it needs — and every role in the
   * matrix holds it, including VIEWER, because a spreadsheet of the collection is the same
   * information the grid below already shows. The template and its instructions are gated on
   * the same permission for the same reason: they contain no data at all.
   *
   * There is no `darshan.export`. DARSHAN_DATA_CONTRACT.md §5 is explicit that nothing here
   * invents a permission — a new name would need a migration, and would then be checked in
   * exactly nowhere the old one was not.
   */
  const mayExport = can('darshan.read');

  /**
   * Publishing — and there is no `darshan.publish` to gate it on.
   *
   * An earlier draft of DARSHAN_DATA_CONTRACT.md §5 named one, and the correction now stands
   * in that file. 0009_darshan_drive_direct.sql deleted the image encoder, folded that
   * permission into `darshan.update` — setting the link *is* the edit — and re-declared
   * `permissions_for()` without it. `create or replace` means the last definition wins, so
   * the permission is returned by nothing, and `shared/domain/permissions.js` carries only
   * the four that survived: read, create, update, disable.
   *
   * `can('darshan.publish')` would therefore answer false for every role including
   * SUPER_ADMIN, and this button would be dead for everybody. `darshan.update` is the
   * permission it was folded into and the one the `scenes` UPDATE policy actually checks
   * (0006), which makes it both the correct mapping and the only one that can work.
   */
  const mayPublish = can('darshan.update');
  const mayDisable = can('darshan.disable');

  // The sentences for whatever this role may not do, gathered once. Empty for a સંચાલક who
  // holds all three, which is the ordinary case and shows no line at all.
  const denied = [
    mayPublish ? '' : CANNOT.publish,
    mayDisable ? '' : CANNOT.disable,
    mayExport ? '' : CANNOT.export,
  ].filter(Boolean);

  // ------------------------------------------------------------------ selecting

  // Ids, never array positions (ORDERING.md rule 1). A Set because membership is asked once
  // per tile on every render, and because the same id ticked twice must stay one દ્રશ્ય.
  const [picked, setPicked] = useState(() => new Set());
  const [checkedReport, setCheckedReport] = useState(null); // the Validate result, or null
  const [progress, setProgress] = useState(null); // { done, total } while a bulk write runs
  const [bulk, setBulk] = useState(null); // the bulk action awaiting confirmation, or null
  const allRef = useRef(null);

  /**
   * The selection, intersected with what is actually on screen.
   *
   * Derived rather than pruned by an effect, and that is what makes the guarantee hold
   * without a second source of truth: whatever the filter is, `selected` is a subset of
   * `shown`, so no bulk action can reach a દ્રશ્ય the સંચાલક cannot see. Switching the filter
   * back brings his ticks back with it, because `picked` itself was never edited.
   */
  const selected = useMemo(() => shown.filter((i) => picked.has(i.id)), [shown, picked]);
  const allShownPicked = shown.length > 0 && selected.length === shown.length;

  // "Some, but not all" is a third state, and a checkbox has a property for it that no
  // amount of `checked` can express (§56).
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selected.length > 0 && !allShownPicked;
  }, [selected.length, allShownPicked]);

  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Select-all is over the **current filtered view** and nothing wider. */
  const toggleAll = () =>
    setPicked((s) => {
      const next = new Set(s);
      for (const i of shown) {
        if (allShownPicked) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  const clearPicked = () => {
    setPicked(new Set());
    setCheckedReport(null);
  };

  // ------------------------------------------------------------------ checking

  /**
   * Validate — and it writes nothing.
   *
   * The word could have meant a status transition: VALIDATED is one of the five
   * (DARSHAN_DATA_CONTRACT.md §4). It deliberately does not mean that here, because
   * VALIDATED is a *withheld* state — `useScenes`'s VISIBLE set is {PUBLISHED, ACTIVE} — so a
   * button labelled Validate, pressed over a selection that included live દર્શન, would take
   * them away from યુવકો. Withholding is allowed in this panel and is never a side effect: it
   * happens through Turn off, after a dialog that counts what shifts. So this checks, reports,
   * and leaves the collection exactly as it found it, which is also why it needs no permission
   * beyond the `darshan.read` that opened the page.
   *
   * The check itself is `validateDarshanItems()` — the same function the તપાસ report is built
   * from, so the two can never disagree about what is wrong with a દ્રશ્ય. It is run over the
   * **whole** collection and the issues are then filtered down to the selection, which is the
   * only way its collection-wide findings mean anything: `missing-index` is a gap in the
   * printed numbering, and asking a subset whether 1…N is complete would report every
   * unselected દ્રશ્ય as missing.
   */
  const runCheck = () => {
    const ids = new Set(selected.map((i) => i.id));
    const issues = validateDarshanItems(items).issues.filter((x) => x.id && ids.has(x.id));
    setCheckedReport({
      total: selected.length,
      // The content gate, spelled the way shared/domain/darshan.js spells it: image *and*
      // વર્ણન. A title is not part of it and must never become part of it
      // (DARSHAN_DATA_CONTRACT.md §2.1) — a missing one is reported below as a warning.
      ready: selected.filter((i) => !!i.imageUrl && !!i.caption).length,
      errors: issues.filter((x) => x.severity === 'error'),
      warns: issues.filter((x) => x.severity === 'warn'),
    });
  };

  // ------------------------------------------------------------------ downloading

  /**
   * The spreadsheet, of whichever set the button that called this names.
   *
   * `written` is the length of the file that was actually produced, handed back by
   * `exportDarshanCsv`, so the sentence afterwards cannot claim a number the export did not
   * contain (§62). Nothing about a યુવક is in it — every cell comes from a DarshanItem, which
   * is a picture, a number, a વર્ણન and a status.
   */
  const runExport = (list, what) => {
    setMsg(null);
    try {
      const written = exportDarshanCsv(list);
      setMsg({ tone: 'ok', text: `Exported ${gu(written)} ${what} to a spreadsheet.` });
    } catch (e) {
      setMsg({ tone: 'danger', text: dataError(e) });
    }
  };

  /**
   * The blank sheet, and the page of instructions that goes with it.
   *
   * Two files rather than two sheets of one workbook, because the download is a CSV and a CSV
   * holds one sheet (EXCEL_CONTRACT.md §8). They are two buttons for the same reason: a
   * સંચાલક who already knows the format should not have to take the instructions again, and
   * one who does not should not have to find them inside a spreadsheet.
   */
  const runTemplate = () => {
    setMsg(null);
    try {
      const examples = downloadDarshanTemplate();
      setMsg({
        tone: 'ok',
        text: `Template downloaded, with ${gu(examples)} example rows to delete before you fill it in. “Instructions” explains every column.`,
      });
    } catch (e) {
      setMsg({ tone: 'danger', text: dataError(e) });
    }
  };

  const runInstructions = () => {
    setMsg(null);
    try {
      downloadDarshanInstructions();
      setMsg({ tone: 'ok', text: 'Instructions downloaded as darshan-instructions.txt.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: dataError(e) });
    }
  };

  // ------------------------------------------------------------------ bulk writes

  /**
   * Everything the dialog is going to say, worked out **before** it opens.
   *
   * Every number in it is counted from the sequence that is loaded — how many દર્શન a યુવક
   * sees today, and how many he will see afterwards — and none of it is estimated from how
   * many rows were ticked. That is decision #3 applied to a selection: withholding renumbers,
   * and the સંચાલક is told by how much before anything is written, never after.
   *
   * `ready` is the content gate and not the `active` flag, so publishing a દ્રશ્ય that still
   * has no image is honestly reported as changing nobody's numbers — it is published and
   * still not shown, which is exactly what `isLearnable()` will decide.
   */
  const ready = (i) => !!i.imageUrl && !!i.caption;

  const askPublish = () => {
    const list = selected;
    const gains = list.filter((i) => i.displayIndex == null && ready(i)).length;
    setBulk({
      status: 'PUBLISHED',
      items: list,
      danger: false,
      title: list.length === 1 ? 'Publish this Darshan?' : 'Publish these Darshan?',
      confirmLabel: `Publish ${gu(list.length)}`,
      past: 'Published',
      gains,
      withheld: list.filter((i) => !ready(i)).length,
      after: numbered + gains,
    });
  };

  const askDisable = () => {
    const list = selected;
    const loses = list.filter((i) => i.displayIndex != null).length;
    setBulk({
      status: 'DISABLED',
      items: list,
      danger: true,
      title: list.length === 1 ? 'Turn this Darshan off?' : 'Turn these Darshan off?',
      confirmLabel: `Turn off ${gu(list.length)}`,
      past: 'Turned off',
      loses,
      after: numbered - loses,
    });
  };

  /**
   * Apply the status, one દ્રશ્ય at a time.
   *
   * One row per statement, and sequentially, because that is what the panel actually has:
   * `saveScene()` is an upsert of a single row and there is no bulk RPC to call. Two
   * consequences are stated rather than hidden. It is **not** one transaction — a refusal
   * partway through leaves the rows before it written — so the failure message names how many
   * did land and stops there rather than carrying on into a hundred more refusals. And it is
   * visible: `progress` counts up in the bar, because a button that goes quiet for eleven
   * seconds is a button somebody presses again.
   *
   * The write is `{ status }` alone. `active` is derived by the trigger; `caption`, `index`
   * and `order` are not named, so the upsert leaves them exactly as they were — and for a
   * દ્રશ્ય with no `scenes` row yet it creates one carrying only its id and its status, which
   * is the same shape `darshan_reorder()` already upserts and is safe for the same reason:
   * an absent caption falls back to the sheet's through `applyOverlay`.
   */
  async function runBulk() {
    if (!bulk) return;
    const list = bulk.items;
    const total = list.length;
    setBusy(true);
    setMsg(null);
    setProgress({ done: 0, total });

    let done = 0;
    try {
      for (const it of list) {
        await saveScene(it.id, { status: bulk.status });
        done += 1;
        setProgress({ done, total });
      }
      setBulk(null);
      setMsg({ tone: 'ok', text: `${bulk.past} ${gu(done)} Darshan.` });
      clearPicked();
      state.retry();
    } catch (e) {
      setBulk(null);
      setMsg({
        tone: 'danger',
        text:
          `${gu(done)} of ${gu(total)} Darshan were changed, and then the next one was refused: ` +
          `${saveError(e)} Nothing after it was attempted.`,
      });
      // Whatever did land is now on screen out of date, and the selection is what he will
      // retry from — so both are refreshed and neither is thrown away.
      if (done) state.retry();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // ------------------------------------------------------------------ arranging

  const [arranging, setArranging] = useState(false);
  // The working copy is an **array of ids**, and it is the only place the order lives while
  // the સંચાલક is moving things. Never an array index: a row is identified by its id in
  // every one of the operations below, so a re-render or a reload cannot make two of them
  // disagree about which દ્રશ્ય was moved (ORDERING.md rule 1).
  const [orderIds, setOrderIds] = useState([]);
  const [draggingId, setDraggingId] = useState('');
  const [announce, setAnnounce] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [msg, setMsg] = useState(null);
  const dragId = useRef('');
  // Set by a move button, consumed by the layout effect below. A row that has just moved
  // takes its button with it, and at either end of the list that button becomes disabled —
  // which drops keyboard focus onto <body> mid-reorder unless it is handed somewhere.
  const focusAfter = useRef(null);

  const baseIds = useMemo(() => items.map((i) => i.id), [items]);

  /**
   * The working copy, sequenced.
   *
   * The array is the order, so `position` is written from it — and then the numbering is
   * asked of `withDisplayIndex()` rather than counted here. That is ORDERING.md rule 4 doing
   * its job on a working copy: what the rows show while he drags is exactly what the same
   * function will return from the database after the save, so nothing jumps when it lands.
   */
  const rows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const seq = orderIds.map((id) => byId.get(id)).filter(Boolean);
    return withDisplayIndex(seq.map((e, i) => ({ ...e, order: i + 1, position: i + 1 })));
  }, [items, orderIds]);

  const dirty = orderIds.join() !== baseIds.join();
  // How many દર્શન a યુવક would see under a different number. Counted against the sequence
  // that was loaded, never estimated from how far a row was dragged.
  const renumbered = useMemo(() => {
    if (!dirty) return 0;
    const was = new Map(items.map((i) => [i.id, i.displayIndex]));
    return rows.filter((r) => r.displayIndex !== was.get(r.id)).length;
  }, [dirty, items, rows]);

  const startArranging = () => {
    setMsg(null);
    setOrderIds(baseIds);
    // The selection does not come into this mode with him. Arranging is about the sequence
    // as a whole — it lists every દ્રશ્ય and puts the filter away for that reason — and a set
    // of ticks made under a filter that is no longer applied would be a bulk action waiting
    // to be pressed over a list it was never chosen from.
    clearPicked();
    setArranging(true);
  };

  const cancelArranging = () => {
    setOrderIds(baseIds);
    setArranging(false);
    setDraggingId('');
    setAnnounce('');
    dragId.current = '';
  };

  /** Move `id` to `to`, keyed on the id and never on a row's current index. */
  const moveTo = (list, id, to) => {
    const from = list.indexOf(id);
    if (from < 0 || to < 0 || to >= list.length || to === from) return list;
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  };

  const nudge = (id, delta) => {
    const to = orderIds.indexOf(id) + delta;
    const next = moveTo(orderIds, id, to);
    if (next === orderIds) return;
    setOrderIds(next);
    focusAfter.current = { id, dir: delta < 0 ? 'up' : 'down' };
    // Spoken, because for anyone not watching the list the only evidence of a move is the
    // number that changed (§56).
    setAnnounce(`${id} moved to position ${to + 1} of ${next.length}.`);
  };

  useLayoutEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const same = document.getElementById(`mv-${want.dir}-${want.id}`);
    const other = document.getElementById(`mv-${want.dir === 'up' ? 'down' : 'up'}-${want.id}`);
    (same && !same.disabled ? same : other)?.focus();
  });

  /**
   * HTML5 drag-and-drop, which is the whole of the mouse path — no library was added for
   * this and none is going to be (ORDERING.md §5).
   *
   * The list re-sorts under the pointer on `dragenter` rather than only on `drop`, so the
   * arrangement being read is the arrangement that will be saved. `setData` is not optional
   * decoration: Firefox refuses to start a drag whose dataTransfer carries no payload.
   */
  const onDragStart = (e, id) => {
    dragId.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const onDragEnterRow = (id) => {
    const from = dragId.current;
    if (!from || from === id) return;
    setOrderIds((list) => moveTo(list, from, list.indexOf(id)));
  };

  const endDrag = () => {
    dragId.current = '';
    setDraggingId('');
  };

  /**
   * The only write on this page that touches the collection as a whole.
   *
   * The id list is the working copy in full — every દ્રશ્ય, withheld ones included, in the
   * order the rows are in. `reorderDarshan()` explains why a partial list would be wrong.
   *
   * On failure the arrangement stays on screen. `darshan_reorder()` is one transaction, so a
   * refusal wrote nothing at all and there is nothing to reload away from; throwing away
   * twenty minutes of dragging because the network blinked would be the wrong answer.
   */
  async function saveOrder() {
    setBusy(true);
    setMsg(null);
    try {
      await reorderDarshan(rows.map((r) => r.id));
      setConfirmSave(false);
      setArranging(false);
      setMsg({ tone: 'ok', text: 'Order saved.' });
      state.retry();
    } catch (e) {
      setConfirmSave(false);
      setMsg({ tone: 'danger', text: orderError(e) });
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ creating

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
        sub="Every image is fully finished - the description and number are inside the image itself"
        actions={
          // While arranging there is deliberately nothing here to click. Every one of these
          // navigates away, and an unsaved arrangement does not survive that — the mode's own
          // Save Order and Cancel are the two ways out of it.
          arranging ? null : (
            <>
              {mayCreate && !draft && (
                <button className="btn" type="button" onClick={() => { setErr(null); setDraft({ ...nextDarshanSlot(items), caption: '' }); }}>
                  Add Darshan
                </button>
              )}
              <button className="btn btn-quiet" type="button" disabled={state.loading || !items.length} onClick={startArranging}>
                Arrange order
              </button>
              {/* §12 — the sheet route. `darshan.update` and not `darshan.create`: the
                  importer only ever edits દ્રશ્યો that already exist (a ક્રમ it does not
                  recognise is reported, never created), and the route's own Gate in App.jsx
                  names the same permission — a link that leads to a refusal is worse than no
                  link (§10). */}
              {mayReorder && <Link className="btn btn-quiet" to="/darshan/import">Import from sheet</Link>}
              <Link className="btn btn-quiet" to="/darshan/health">Health report</Link>
            </>
          )
        }
      />

      {/* A refusal is interrupted for; a confirmation is not. `alert` and `status` are the
          two live regions that say which, and using `status` for both is how a failed bulk
          write goes unread by anyone not watching the top of the page (§56). */}
      {msg && (
        <div className={`notice notice-${msg.tone}`} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </div>
      )}

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
      {draft && !arranging && (
        <section className="card" aria-labelledby="new-darshan-h">
          <h2 id="new-darshan-h">Add a Darshan</h2>
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
              Optional now, required before users see it. The new Darshan is created as a draft with no image - add a link to
              one on its page, and it stays hidden from users until you do.
            </span>
          </div>

          {err && <div className="notice notice-danger" role="alert">{err}</div>}

          <div className="form-actions">
            <button className={`btn ${busy ? 'is-busy' : ''}`} type="button" disabled={busy} onClick={submit}>
              {busy ? 'Creating…' : 'Create Darshan'}
            </button>
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => { setDraft(null); setErr(null); }}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="grid-stats">
        <StatCard label="Total" value={gu(items.length)} loading={state.loading} />
        {/* Two counts, and the sub-line is where they are reconciled rather than left to be
            noticed. They differ because "on" and "numbered" are different questions: this
            panel's badge follows the `active` column, while shared/domain/darshan.js hands out
            a number only when a યુવક could actually be shown the દ્રશ્ય — image *and* વર્ણન. A
            row switched on before its વર્ણન was written is Active here and carries no number,
            and a સંચાલક reading 100 in one place and 98 in another deserves the sentence. */}
        <StatCard
          label="Active"
          value={gu(active)}
          sub={
            numbered === active
              ? 'All numbered for users'
              : `${gu(active - numbered)} of them carry no number yet - no description or image`
          }
          tone="ok"
          loading={state.loading}
        />
        <StatCard label="Off" value={gu(items.length - active)} loading={state.loading} />
      </div>

      {!arranging && (
        <div className="filters">
          <div className="field">
            <label htmlFor="f">Show</label>
            <select id="f" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Off only</option>
            </select>
          </div>

          {/*
            The spreadsheet, and the sheet to fill in — beside the filter rather than in the
            page header, because the header already carries four controls and a fifth row of
            buttons up there is a row nobody reads.

            "Export all" is all of them and says so, because the bar below has its own Export
            for the ticked set: two buttons that both say Export, with only a selection to
            tell them apart, is how the wrong file gets sent to a saint.
          */}
          <div className="dsel-tools">
            <button
              className="btn btn-quiet"
              type="button"
              disabled={!mayExport || state.loading || !items.length || busy}
              title={mayExport ? '' : CANNOT.export}
              onClick={() => runExport(items, 'Darshan')}
            >
              Export all to Excel
            </button>
            <button
              className="btn btn-quiet"
              type="button"
              disabled={!mayExport || busy}
              title={mayExport ? '' : CANNOT.export}
              onClick={runTemplate}
            >
              Download template
            </button>
            <button
              className="btn btn-quiet"
              type="button"
              disabled={!mayExport || busy}
              title={mayExport ? '' : CANNOT.export}
              onClick={runInstructions}
            >
              Instructions
            </button>
          </div>
        </div>
      )}

      {/*
        The selection bar.

        Rendered only outside arranging mode, and only when there is something to tick. It
        stays on screen with nothing selected — a bar that appeared on the first tick would
        push the whole grid down under the pointer at the exact moment he was aiming at it,
        and there would be nothing on screen beforehand to say the tiles could be ticked at
        all.
      */}
      {!arranging && !state.loading && !state.error && shown.length > 0 && (
        <>
          {/* A named group, so the four bulk buttons are announced as one set of actions
              over the ticked દ્રશ્યો rather than as five loose buttons in the middle of a
              grid of links (§56). */}
          <div
            className={`dsel ${selected.length ? 'is-picked' : ''}`}
            role="group"
            aria-label="Actions for the selected Darshan"
          >
            <label className="dsel-all">
              <input
                ref={allRef}
                type="checkbox"
                checked={allShownPicked}
                disabled={busy}
                onChange={toggleAll}
              />
              {/* Over the current view and it says so, because that is exactly what it does
                  — "Select all" beside a filter that is hiding half the collection is a
                  promise about rows that are not there. */}
              <span>Select all {gu(shown.length)} shown</span>
            </label>

            {/* role="status" so the count is spoken as it changes: a tick is a silent event
                for anyone not watching the tiles (§56). */}
            <span className="dsel-count" role="status">
              {progress
                ? `Saving ${gu(progress.done)} of ${gu(progress.total)}…`
                : selected.length
                  ? `${gu(selected.length)} of ${gu(shown.length)} selected`
                  : 'Nothing selected'}
            </span>

            <div className="dsel-btns">
              <button
                className="btn btn-quiet"
                type="button"
                disabled={!selected.length || busy}
                onClick={runCheck}
              >
                Validate
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={!mayPublish || !selected.length || busy}
                title={mayPublish ? '' : CANNOT.publish}
                onClick={askPublish}
              >
                Publish
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={!mayDisable || !selected.length || busy}
                title={mayDisable ? '' : CANNOT.disable}
                onClick={askDisable}
              >
                Turn off
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={!mayExport || !selected.length || busy}
                title={mayExport ? '' : CANNOT.export}
                onClick={() => runExport(selected, 'selected Darshan')}
              >
                Export selected
              </button>
              <button
                className="btn btn-quiet"
                type="button"
                disabled={!selected.length || busy}
                onClick={clearPicked}
              >
                Clear
              </button>
            </div>
          </div>

          {/*
            §10 — a control he cannot use is disabled and *told*, never quietly missing. A
            button that is simply absent reads as a panel that is broken; the sentence names
            the role's limit, which is the thing he would otherwise ring somebody about. The
            `title` above carries the same words for the pointer, and this line carries them
            for everyone else — a tooltip is not an accessible explanation on its own.
          */}
          {denied.length > 0 && <p className="hint dsel-denied">{denied.join(' ')}</p>}

          {/*
            What Validate found. A notice rather than a dialog: it is a reading, nothing is
            waiting on it, and it has to stay legible while he scrolls the tiles it is about.
          */}
          {checkedReport && (
            <div
              className={`notice ${checkedReport.errors.length ? 'notice-warn' : 'notice-ok'} dsel-report`}
              role="status"
            >
              <p>
                <strong>
                  {gu(checkedReport.ready)} of {gu(checkedReport.total)} selected Darshan are ready
                  to show users.
                </strong>{' '}
                {checkedReport.errors.length === 0 && checkedReport.warns.length === 0
                  ? 'Nothing else to report on these.'
                  : 'Nothing has been changed - this is a check, not an edit.'}
              </p>
              {checkedReport.errors.length > 0 && (
                <p>
                  <strong>Blocking:</strong> {issueLines(checkedReport.errors)}
                </p>
              )}
              {checkedReport.warns.length > 0 && (
                <p>
                  <strong>Worth fixing:</strong> {issueLines(checkedReport.warns)}
                </p>
              )}
              <p>
                <button className="linklike" type="button" onClick={() => setCheckedReport(null)}>
                  Dismiss
                </button>
                {' · '}
                <Link to="/darshan/health">Full health report</Link>
              </p>
            </div>
          )}
        </>
      )}

      {/*
        §33, §35 — the four states of this grid, and why the empty one is two different
        sentences. A collection that is genuinely empty is filled from the sheet; a grid
        emptied by the Show filter is not empty at all, and offering an import there would
        send the સંચાલક off to fix something that is not broken. The placeholder is the grid's
        own shape rather than a spinner, so the tiles land where the boxes stood.
      */}
      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && !(arranging ? rows.length : shown.length) }}
        emptyIcon="❑"
        emptyTitle={filter === 'all' ? 'No Darshan yet' : 'Nothing matches this filter'}
        empty={
          filter === 'all'
            ? 'Bring the spreadsheet in to create the whole collection at once, or add a single Darshan by hand.'
            : 'Every Darshan is hidden by the filter above. Show all of them to see the collection again.'
        }
        emptyAction={
          filter === 'all' ? (
            mayReorder ? <Link className="btn" to="/darshan/import">Import from sheet</Link> : null
          ) : (
            <button className="btn btn-quiet" type="button" onClick={() => setFilter('all')}>
              Show all Darshan
            </button>
          )
        }
        skeleton={<div className="dg-loading"><CardSkeleton count={8} /></div>}
        onRetry={state.retry}
      >
        {arranging ? (
          <>
            {!mayReorder && (
              <div className="notice">You can look at the order but not change it.</div>
            )}

            <div className={`dro-bar ${dirty ? 'is-dirty' : ''}`} role="group" aria-label="Saving the order">
              <div className="dro-bar-text">
                {dirty ? (
                  <>
                    <strong>Not saved yet.</strong>{' '}
                    {gu(renumbered)} Darshan {renumbered === 1 ? 'gets a' : 'get a'} different number.
                  </>
                ) : (
                  <>
                    Drag a row, or use its arrows, to change the order. Nothing is saved until you
                    press Save Order.
                  </>
                )}
              </div>
              <div className="dro-bar-btns">
                <button className={`btn ${busy ? 'is-busy' : ''}`} type="button" disabled={!mayReorder || !dirty || busy} onClick={() => setConfirmSave(true)}>
                  {busy ? 'Saving…' : 'Save Order'}
                </button>
                <button className="btn btn-quiet" type="button" disabled={busy} onClick={cancelArranging}>
                  Cancel
                </button>
              </div>
            </div>

            <p className="hint d-note">
              Every Darshan is listed here, including the ones that are off - the whole order is
              saved in one go, so a filtered part of it would mean nothing. The big number is what
              users see; the grey one is the number printed inside the image, which never changes.
            </p>

            <ol className="dro" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); endDrag(); }}>
              {rows.map((r, i) => (
                <li
                  key={r.id}
                  className={[
                    'dro-row',
                    // Marked on "carries no number" rather than on the Active badge, so the
                    // dimmed rows are exactly the rows with a dash where a number should be.
                    r.displayIndex == null ? 'is-off' : '',
                    draggingId === r.id ? 'is-dragging' : '',
                    mayReorder ? '' : 'is-static',
                  ].filter(Boolean).join(' ')}
                  draggable={mayReorder}
                  onDragStart={(e) => onDragStart(e, r.id)}
                  onDragEnter={() => onDragEnterRow(r.id)}
                  onDragEnd={endDrag}
                >
                  <span className="dro-grip" aria-hidden="true">⠿</span>

                  <span className="dro-n">
                    {/* A withheld દ્રશ્ય carries no display number, because it is not counted —
                        that is the contract, not a missing value (ORDERING.md §2). */}
                    <span className={`dro-display ${r.displayIndex == null ? 'is-none' : ''}`}>
                      {r.displayIndex == null ? '-' : gu(r.displayIndex)}
                    </span>
                    <span className="dro-src" title="Number printed inside the image">
                      {r.sourceIndex == null ? '' : `#${gu(r.sourceIndex)}`}
                    </span>
                  </span>

                  {/* `draggable={false}` is load-bearing. An <img> is draggable by default, and
                      a default drag started on it wins over the row's — grabbing a દ્રશ્ય by
                      its picture, which is the obvious thing to do, would have dragged the
                      image URL instead of reordering anything. */}
                  {r.thumbUrl || r.imageUrl ? (
                    <img className="dro-thumb" src={r.thumbUrl || r.imageUrl} loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" alt="" />
                  ) : (
                    <span className="dro-thumb is-empty" aria-hidden="true" />
                  )}

                  <span className="dro-text">
                    <span className="dro-id">{r.id}</span>
                    <span className="dro-caption">{r.caption || 'No description written'}</span>
                  </span>

                  {/* Two different reasons a row has no number, and they need different words:
                      switched off, or switched on and not finished. `reason` is the sentence
                      toDarshanItem already worked out for both. */}
                  {!r.active ? (
                    <span className="pill pill-off" title={r.reason}>Off</span>
                  ) : r.displayIndex == null ? (
                    <span className="pill pill-warn" title={r.reason}>Not shown</span>
                  ) : null}

                  <span className="dro-moves">
                    <button
                      id={`mv-up-${r.id}`}
                      className="dro-move"
                      type="button"
                      aria-label={`Move ${r.id} up, to position ${i}`}
                      disabled={!mayReorder || busy || i === 0}
                      onClick={() => nudge(r.id, -1)}
                    >
                      ▲
                    </button>
                    <button
                      id={`mv-down-${r.id}`}
                      className="dro-move"
                      type="button"
                      aria-label={`Move ${r.id} down, to position ${i + 2}`}
                      disabled={!mayReorder || busy || i === rows.length - 1}
                      onClick={() => nudge(r.id, 1)}
                    >
                      ▼
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            <p className="sr-only" role="status" aria-live="polite">{announce}</p>

            <ConfirmDialog
              open={confirmSave}
              title="Save this order?"
              busy={busy}
              confirmLabel="Save Order"
              onCancel={() => setConfirmSave(false)}
              onConfirm={saveOrder}
              body={
                <>
                  <p>
                    {gu(renumbered)} of the {gu(numbered)} Darshan users can see{' '}
                    {renumbered === 1 ? 'gets a different number' : 'get a different number'}. The
                    new order takes effect for everyone straight away.
                  </p>
                  <p style={{ marginTop: 8 }}>
                    The number printed inside each image is not touched, and neither is anything a
                    user has already finished - Level 3 and Level 4 follow the Darshan itself, not
                    its position.
                  </p>
                </>
              }
            />
          </>
        ) : (
          <div className="dg">
            {shown.map((it) => (
              /*
                The tick is a *sibling* of the link, inside a positioned cell, and never a
                child of it. A checkbox nested in an <a> is a checkbox whose every click also
                navigates — and an <a> is not a valid parent for an interactive control in
                the first place. This way the two targets are simply two targets: the corner
                selects, the rest of the tile opens the દ્રશ્ય, and neither has to cancel the
                other with a stopPropagation nobody can see.
              */
              <div className={`dg-cell ${picked.has(it.id) ? 'is-picked' : ''}`} key={it.id}>
                <label className="dg-pick">
                  <input
                    type="checkbox"
                    checked={picked.has(it.id)}
                    disabled={busy}
                    onChange={() => toggle(it.id)}
                  />
                  {/* The tile shows a picture and two numbers; a screen reader needs the id,
                      which is the thing every message about this selection will name. */}
                  <span className="sr-only">Select {it.id}</span>
                </label>

                <Link className="dg-item" to={`/darshan/${it.id}`}>
                  {/*
                    A દ્રશ્ય with no artwork gets a box, not an <img>.

                    It became reachable when the panel learned to create દ્રશ્યો: such a record
                    is a row before it is a picture, so `thumbUrl` and `imageUrl` are both ''.
                    An `<img src="">` is not merely ugly — the browser resolves the empty URL
                    against the current document and re-requests the whole page, which React
                    warns about for that reason. The placeholder also gives the સંચાલક
                    somewhere to read *why*, which a broken-image glyph never did.

                    `thumbUrl` and not `imageUrl`: it is the same Drive file asked of Google's
                    CDN at ~400px. A grid of full-resolution masters would repeat, inside the
                    panel, the 25 MB problem the યુવક app was rebuilt to fix.
                  */}
                  {it.thumbUrl || it.imageUrl ? (
                    <img
                      src={it.thumbUrl || it.imageUrl}
                      loading="lazy"
                      decoding="async"
                      /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
                      referrerPolicy="no-referrer"
                      alt={`Darshan ${it.index}`}
                    />
                  ) : (
                    <span className="dg-empty">No image yet</span>
                  )}
                  <div className="dg-meta">
                    {/* The same two numbers the arrange list shows, so the grid and the order
                        never look like two different collections (decision #2). */}
                    <span className="dg-id">
                      {it.displayIndex == null ? '-' : gu(it.displayIndex)}
                      <span className="dro-src"> #{gu(it.sourceIndex ?? it.index)}</span>
                    </span>
                    {it.active ? (
                      <span className="pill pill-ok">Active</span>
                    ) : (
                      <span className="pill pill-off" title={it.reason}>Off</span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </AsyncBlock>

      {/*
        §57 — a bulk write is the last thing on this page that should happen on one click, so
        it happens on two, with the count and the renumbering stated in between. The same
        ConfirmDialog the arrange mode and the detail page use; there is exactly one of these
        in the panel and this is not the place to write a second.

        Not mounted while arranging: that mode has a ConfirmDialog of its own, and two of them
        on the page at once would put two `id="confirm-title"` into one document — which is
        the one thing a screen reader resolves by picking whichever it meets first (§56).
      */}
      {!arranging && <ConfirmDialog
        open={!!bulk}
        title={bulk?.title || ''}
        body={<BulkWarning bulk={bulk} numbered={numbered} />}
        danger={!!bulk?.danger}
        busy={busy}
        confirmLabel={bulk?.confirmLabel || 'Yes, do it'}
        onConfirm={runBulk}
        onCancel={() => setBulk(null)}
      />}
    </>
  );
}

/**
 * The sentences a bulk publish or a bulk withholding is confirmed with.
 *
 * Every number in it was counted from the loaded sequence before the dialog opened, never
 * written down here and never inferred from how many tiles were ticked (§62, ORDERING.md
 * rule 2). The paragraph that matters most is the renumbering one: the number a યુવક sees is
 * a દ્રશ્ય's place among the ones he is *shown*, so turning fifty off moves every number below
 * them. Decision #3 says he may absolutely do it — and is never surprised by it.
 *
 * `gains` / `withheld` exist because publishing is not the same as being seen. A દ્રશ્ય with
 * no image or no વર્ણન can be PUBLISHED all day and `isLearnable()` will still withhold it,
 * so the dialog says so rather than promising a change that will not appear.
 */
function BulkWarning({ bulk, numbered }) {
  if (!bulk) return null;
  const n = bulk.items.length;
  const many = n === 1 ? 'This Darshan' : `These ${gu(n)} Darshan`;

  return (
    <>
      {bulk.status === 'PUBLISHED' ? (
        <>
          <p>
            {many} will be published. {bulk.gains === 0
              ? 'None of them starts being shown to users by this, so nothing is renumbered.'
              : `${gu(bulk.gains)} of them ${bulk.gains === 1 ? 'starts' : 'start'} being shown to users, so users go from seeing ${gu(numbered)} Darshan to ${gu(bulk.after)}.`}
          </p>
          {bulk.withheld > 0 && (
            <p style={{ marginTop: 8 }}>
              {gu(bulk.withheld)} of them {bulk.withheld === 1 ? 'has' : 'have'} no image or no
              description yet, so {bulk.withheld === 1 ? 'it stays' : 'they stay'} hidden until
              that is filled in. Publishing {bulk.withheld === 1 ? 'it' : 'them'} does no harm -
              nothing is shown half-finished.
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {many} will be turned off and stop being shown to users. Nothing is deleted - the
            same selection turns back on again at any time.
          </p>
          <p style={{ marginTop: 8 }}>
            {bulk.loses === 0
              ? 'None of them is shown to users today, so nothing is renumbered.'
              : `${gu(bulk.loses)} of them ${bulk.loses === 1 ? 'is' : 'are'} shown today, so users go from seeing ${gu(numbered)} Darshan to ${gu(bulk.after)} and the numbers below them all shift.`}
          </p>
        </>
      )}

      <p style={{ marginTop: 8 }}>
        The number printed inside each image does not change, and nothing anyone has already
        finished is affected - Level 3 and Level 4 follow the Darshan itself, not its number.
      </p>
    </>
  );
}

/**
 * The ids behind a set of findings, capped.
 *
 * Named rather than counted, because "3 have no image link" sends the સંચાલક hunting through
 * a hundred tiles for them. Capped, because a selection of a hundred broken દર્શન would
 * otherwise print a hundred ids into a notice — the remainder is counted instead, and the
 * તપાસ page linked beside it lists them all.
 */
function issueLines(issues, cap = 8) {
  const byMessage = new Map();
  for (const i of issues) {
    // Grouped on the finding, not on the દ્રશ્ય: "No image link — darshan-004, darshan-091"
    // is one sentence to act on, where a line per દ્રશ્ય is a wall to read.
    if (!byMessage.has(i.code)) byMessage.set(i.code, { message: i.message, ids: [] });
    byMessage.get(i.code).ids.push(i.id);
  }

  return [...byMessage.values()]
    .map(({ message, ids }) => {
      const shown = ids.slice(0, cap).join(', ');
      const rest = ids.length > cap ? ` and ${gu(ids.length - cap)} more` : '';
      // The message carries the offending value for some codes ("Duplicate number: 27"), so
      // the id list is appended to it rather than replacing it.
      return `${message.split(' - ')[0]} (${gu(ids.length)}): ${shown}${rest}`;
    })
    .join(' · ');
}

/**
 * §10 — what a role may not do, said in words.
 *
 * Module-level because the same sentence goes on the disabled button's `title` and into the
 * line beneath the bar, and two copies of it would eventually disagree. Each names what the
 * role cannot *do* rather than the permission it is missing: `darshan.disable` is a string
 * out of a migration, and it is not what the person reading this needs to repeat down a
 * phone line to whoever can grant it.
 */
const CANNOT = {
  publish: 'Your role cannot publish Darshan.',
  disable: 'Your role cannot turn a Darshan off.',
  export: 'Your role cannot export Darshan.',
};

/**
 * `darshan_reorder()` raises four conditions of its own and every one of them arrives as
 * P0001 — whose mapping in lib/errors.js is a single fallback sentence that would say
 * nothing about any of them. They are identifiers chosen to be matched rather than
 * displayed, the same arrangement લેવલ ૪'s messages have; matched here rather than there
 * because all four belong to this one button and not to every save in the panel.
 *
 * The last three are unreachable from this page as it stands — it sends the whole
 * collection, and the working copy is built from a Map, so a duplicate, an empty id or an
 * unnamed દ્રશ્ય holding a target slot cannot come out of it. They are worded anyway: the
 * one that becomes reachable is `_conflict`, the moment a second સંચાલક adds a દ્રશ્ય while
 * this list is open, and "reload" is genuinely the fix.
 */
function orderError(e) {
  const m = String(e?.message || '');
  if (m.startsWith('darshan_reorder_denied')) {
    return 'You do not have permission to change the order of the Darshan.';
  }
  if (m.startsWith('darshan_reorder_duplicate')) {
    return 'The order sent listed the same Darshan twice. Reload the page and try again.';
  }
  if (m.startsWith('darshan_reorder_invalid_id')) {
    return 'The order sent was not readable. Reload the page and try again.';
  }
  if (m.startsWith('darshan_reorder_conflict')) {
    return 'A Darshan was added or moved by someone else while this page was open. Reload the page and arrange it again.';
  }
  return saveError(e);
}
