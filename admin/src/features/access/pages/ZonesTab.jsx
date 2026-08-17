import { useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import DataTable from '../../../components/DataTable';
import { AsyncBlock, TableSkeleton } from '../../../components/StateBlocks';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { StatusBadge } from '../../../components/StatCard';
import { roleLabel } from '../../../../../shared/domain/permissions.js';
import { zonesOf } from '../../../../../shared/domain/geography.js';
import { isUnrestricted, scopeDiff, scopeSummary } from '../../../../../shared/domain/scope.js';
import { listAdmins, listRoles, roleLabels } from '../../users/services/adminService';
import { listScopes, loadGeography, scopeWriteError, setAdminScope } from '../services/scopeService';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * Zone access — which યુવકો each સંચાલક can see
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The other half of /access. Every other tab here answers "what may he do"; this one answers
 * "whose data", which the panel had no way to express at all before 0051. `users.read` is one
 * bit and it has always meant every યુવક in every zone, so a સંઘ that wanted "he looks after
 * વરાછા" had to choose between giving somebody everybody and giving him nobody.
 *
 * ── Its own tab rather than a column on Administrators ──────────────────────
 *
 * The Administrators tab is about appointments: who exists, what role he holds, whether the
 * account is on. Its rows already carry five actions and four dialogs. A zone editor there
 * would be a sixth control in a screen whose subject is somebody's job title, and the decision
 * being made here is a different one — it is about a *population*, and it wants the yuvak
 * counts per zone beside it to be made at all. "Retire વેડરોડ" is a different decision at 3
 * યુવકો than at 300, and so is "give Ramesh વેડરોડ".
 *
 * A Zones column IS shown on Administrators, though, and it links here. A scoped administrator
 * who is invisible on the list where administrators live is exactly the "why can he not see
 * this yuvak" question that has nowhere to be answered.
 *
 * ── The rule that is stated on screen, every time ───────────────────────────
 *
 * **Nobody ticked means every zone.** It is written into `caller_scope()`, into
 * shared/domain/scope.js and into the empty state of the dialog below, because it is the one
 * thing about this screen that is not guessable: an empty set of tick boxes looks like "he sees
 * nothing", and it means the opposite. Getting that backwards in a person's head is how
 * somebody is given the whole સંઘ while believing he has been locked out of it.
 *
 * ── None of this is the boundary ────────────────────────────────────────────
 *
 * Nothing rendered here decides anything. `admin_scopes_guard()` re-applies every rule as a
 * BEFORE trigger — scope.assign is required, nobody may change his own scope, a SUPER_ADMIN may
 * not be scoped — and the narrowing itself is `public.scoped_profiles`, twelve restrictive
 * policies and a raise inside four functions. A યુવક who edits the checks out of his own copy
 * of the bundle gets a button that produces a refusal, which is the correct outcome and the
 * reason the refusal is shown in full rather than swallowed.
 */

export default function ZonesTab() {
  const { can, user } = useAdminAuth();

  const [pending, setPending] = useState(null); // the administrator being edited
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState(null);

  const adminState = useAsync(() => listAdmins({}), []);
  const roleState = useAsync(() => listRoles(), []);
  const geoState = useAsync(() => loadGeography(), []);
  const scopeState = useAsync(() => listScopes(), []);

  const admins = adminState.data?.rows || [];
  const roles = roleState.data || [];
  const labels = roleLabels(roles);
  const label = (key) => roleLabel(key, labels);

  const cities = geoState.data?.cities || [];
  const zones = geoState.data?.zones || [];
  const scopes = scopeState.data || {};

  /*
    Retired zones are offered when somebody is already scoped to one, and not otherwise.

    0050's rule for a place is "nobody new here, and it is still shown everywhere a યુવક who is
    already in it appears". A scope is the same shape of fact: putting a new person in charge of
    a closed zone is meaningless, and hiding a closed zone that somebody IS scoped to would make
    his tick box vanish from the screen while the row it represents stayed in the database and
    went on narrowing everything he opens.
  */
  const offered = (adminId) => {
    const held = new Set(scopes[adminId] || []);
    return zones.filter((z) => z.status === 'ACTIVE' || held.has(z.id));
  };

  const scopeOf = (a) => scopes[a.id] || null;

  const open = (a) => {
    setFailure('');
    setNote(null);
    setDraft(scopes[a.id] || []);
    setPending(a);
  };

  const close = () => {
    if (busy) return;
    setPending(null);
    setFailure('');
  };

  const reload = () => {
    scopeState.retry();
    // The counts move with the scope only for the person looking, so this is not strictly
    // needed after saving somebody else's zones. It is re-read anyway because the alternative
    // is a screen whose numbers are right on first load and stale after every save.
    geoState.retry();
  };

  const save = async () => {
    if (!pending) return;
    setBusy(true);
    setFailure('');
    try {
      const { added, removed } = scopeDiff(scopes[pending.id], draft);
      if (!added.length && !removed.length) {
        setPending(null);
        return;
      }
      await setAdminScope(pending.id, draft);
      setPending(null);
      setNote({
        tone: 'notice-ok',
        text: draft.length
          ? `${pending.name} now sees ${scopeSummary(draft, zones)} only. It applies to his very next request - there is nothing for him to reload.`
          : `${pending.name} sees every zone again.`,
      });
      reload();
    } catch (e) {
      setFailure(scopeWriteError(e));
    } finally {
      setBusy(false);
    }
  };

  const isSelf = (a) => !!user && a.id === user.id;

  const columns = [
    {
      key: 'name',
      label: 'Name',
      pin: true,
      render: (a) => (
        <span style={{ display: 'inline-block', maxWidth: '100%', minWidth: 0 }}>
          <span style={{ display: 'block' }}>{a.name || '-'}</span>
          <span className="hint">{a.email}</span>
          {isSelf(a) && <span className="chip">You</span>}
        </span>
      ),
    },
    { key: 'role', label: 'Role', render: (a) => <StatusBadge tone="info">{label(a.role)}</StatusBadge> },
    {
      key: 'zones',
      label: 'Sees',
      /*
        "Every zone" and not an empty cell, because an empty cell in this column would be read
        as "no zones" - which is the exact inversion this whole screen is careful about. The
        unrestricted case is the common one and it is stated in words.
      */
      render: (a) => {
        const s = scopeOf(a);
        if (isUnrestricted(s)) return <span className="hint">Every zone</span>;
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            {s.map((z) => (
              <StatusBadge key={z} tone="warn">
                {zones.find((x) => x.id === z)?.name || z}
              </StatusBadge>
            ))}
          </span>
        );
      },
    },
  ];

  if (can('scope.assign')) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      render: (a) => <RowAction admin={a} self={isSelf(a)} onOpen={open} />,
    });
  }

  const state = {
    loading: adminState.loading || geoState.loading || scopeState.loading,
    error: adminState.error || geoState.error || scopeState.error,
    retry: () => {
      adminState.retry();
      roleState.retry();
      reload();
    },
  };

  return (
    <>
      {note && (
        <div className={`notice ${note.tone}`} role="status">
          {note.text}
        </div>
      )}

      <AsyncBlock
        state={{ ...state, isEmpty: !state.loading && !state.error && admins.length === 0 }}
        emptyTitle="No administrators"
        emptyIcon="🗺️"
        empty="There is nobody to limit to a zone yet. Appoint an administrator on the Administrators tab first."
        onRetry={state.retry}
        skeleton={<TableSkeleton cols={columns.length} />}
      >
        <>
          <DataTable
            caption="Zone access per administrator"
            columns={columns}
            rows={admins}
            rowKey={(a) => a.id}
          />

          <p className="card-note">
            An administrator with no zones set sees every zone - that is what an empty "Sees"
            cell means, and it is why this column says "Every zone" rather than being left
            blank. Setting zones narrows every list, count, report and export he can open, and
            it takes effect on his very next request. A Super Admin always sees the whole sangh
            and cannot be limited: somebody has to, or a zone can become invisible to everybody
            at once with no screen anywhere saying so.
          </p>
        </>
      </AsyncBlock>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `Zones for ${pending.name}` : ''}
        busy={busy}
        confirmLabel={draft.length ? 'Save these zones' : 'Let him see every zone'}
        danger={!draft.length && !isUnrestricted(pending && scopes[pending.id])}
        onCancel={close}
        onConfirm={save}
        body={
          pending && (
            <ZonePicker
              admin={pending}
              cities={cities}
              zones={offered(pending.id)}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              failure={failure}
              was={scopes[pending.id] || []}
            />
          )
        }
      />
    </>
  );
}

/**
 * One button, and a sentence instead of a disabled one where the rule forbids it.
 *
 * Nothing is rendered disabled here for the same reason nothing is on the Administrators tab:
 * a greyed-out control tells somebody the panel can do a thing and that he is not trusted with
 * it, which is a sentence about him rather than about the product. Where the rule is about the
 * ROW rather than about the person pressing — a SUPER_ADMIN, or your own row — the button is
 * replaced by the reason, up front, because the guard would only ever answer with a refusal.
 */
function RowAction({ admin, self, onOpen }) {
  if (admin.role === 'SUPER_ADMIN') {
    return <span className="hint">A Super Admin always sees every zone.</span>;
  }
  if (self) {
    return <span className="hint">Your own zones can only be changed by another administrator.</span>;
  }
  if (admin.status === 'REVOKED') {
    return <span className="hint">Not an administrator.</span>;
  }
  return (
    <button className="btn btn-quiet btn-sm" type="button" onClick={() => onOpen(admin)}>
      Set zones
    </button>
  );
}

/**
 * The tick boxes, grouped by city.
 *
 * Grouped rather than listed flat because a zone id is only meaningful inside a city — 0050's
 * `normaliseZone()` drops a zone that cannot say which city it is in for exactly this reason —
 * and because the day there are two cities, a flat list of twenty zones is a list nobody can
 * read. With one city it renders as one group with a heading, which costs a line and means the
 * screen does not have to change shape later.
 *
 * The count beside each name is what makes the choice a decision rather than a guess.
 */
function ZonePicker({ admin, cities, zones, draft, setDraft, busy, failure, was }) {
  const toggle = (id) =>
    setDraft((d) => (d.includes(id) ? d.filter((z) => z !== id) : [...d, id].sort()));

  const { added, removed } = scopeDiff(was, draft);
  const changed = added.length || removed.length;

  // Cities that actually have zones on offer. A city whose every zone is retired would
  // otherwise render as a heading with nothing under it.
  const shown = cities.filter((c) => zonesOf(zones, c.id).length > 0);

  return (
    <>
      <p>
        Tick the zones {admin.name} may see. Every list, count, report and export in the panel is
        narrowed to them, and so is opening one yuvak by name - he is told the yuvak is not in a
        zone he looks after, rather than being shown an empty page.
      </p>

      {shown.map((c) => (
        <div className="field" key={c.id} style={{ marginTop: 'var(--sp-4)' }}>
          <label>{c.name}</label>
          {zonesOf(zones, c.id).map((z) => (
            <label className="check" key={z.id} htmlFor={`zone-${z.id}`}>
              <input
                id={`zone-${z.id}`}
                type="checkbox"
                checked={draft.includes(z.id)}
                onChange={() => toggle(z.id)}
                disabled={busy}
              />
              {z.name}
              <span className="hint" style={{ marginLeft: 'var(--sp-2)' }}>
                {z.yuvaks === 1 ? '1 yuvak' : `${z.yuvaks} yuvaks`}
                {z.status !== 'ACTIVE' && ' - closed'}
              </span>
            </label>
          ))}
        </div>
      ))}

      {/*
        The empty state, and it is the most important sentence on this screen.

        An empty set of tick boxes reads as "he sees nothing" and means the opposite. It is
        stated here, in the dialog, at the moment somebody has just cleared the last box - not
        only in the page note underneath the table, which by then is behind a modal.
      */}
      {!draft.length && (
        <div className="notice notice-warn" role="status">
          Nothing ticked means <strong>every zone</strong>, not no zones. Saving this gives{' '}
          {admin.name} the whole sangh again - which is how a limit is removed, and is not a way
          to lock somebody out.
        </div>
      )}

      {changed > 0 && draft.length > 0 && (
        <p className="hint">
          {added.length > 0 && `Adding ${added.length === 1 ? '1 zone' : `${added.length} zones`}. `}
          {removed.length > 0 &&
            `Removing ${removed.length === 1 ? '1 zone' : `${removed.length} zones`}. `}
          It applies to his very next request - there is nothing for him to reload, and nothing
          he is currently looking at stays visible.
        </p>
      )}

      {failure && (
        <div
          className="notice notice-danger"
          role="alert"
          style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
        >
          {failure}
        </div>
      )}
    </>
  );
}
