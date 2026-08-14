import { useState } from 'react';
import { RuleCard, RuleError, controlRow } from './RuleFields';
import { StatusBadge } from '../../../components/StatCard';
import { gu } from '../../../lib/format';
import { dataError } from '../../../lib/errors';
import { todayIST } from '../../../../../shared/domain/constants.js';
import {
  MANUAL_MAX,
  MANUAL_REASON_MIN,
  awardManualPoints,
  findYuvaks,
  pointsSaveError,
} from '../services/pointsService';

/**
 * Section 8 - crediting or debiting one યુવક by hand.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This writes a new row. It cannot edit one, and it must not look as though it can
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `admin_award_manual_points()` inserts; there is no UPDATE and no DELETE anywhere in the ledger's
 * grants. §15 asks for it that way and it is also the only shape that survives being asked about
 * later: an edited row can say what the total is but not what happened, and the ledger exists to
 * answer the second question. A correction that was itself a mistake is corrected by a third row,
 * and all three stay.
 *
 * A yuvak's points therefore never "become" a number here. An adjustment of -50 is a row of -50
 * sitting beside everything he has earned, with the reason and the name of whoever wrote it -
 * both of which the ledger's own `point_transactions_manual_needs_reason` constraint insists on.
 * That is why the reason is required by the form as well: a required field is not a formality
 * when it is the only account of why somebody's total moved.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the form is separate from the rules above it
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything else on this page is configuration, saved by one button, taking effect from now on.
 * This one acts on one person immediately and cannot be undone by re-saving. Sharing a Save with
 * the rule set would mean an admin adjusting the repeat default and handing out 500 points in one
 * unremarkable press.
 *
 * It holds its own state, does its own read and reports its own outcome, the way DhunCard and
 * GalleryCard do on the Settings page.
 */
export default function ManualAdjustCard({ mayEdit, onAwarded }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [chosen, setChosen] = useState(null);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayIST());

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // The rules are hints before the first attempt and errors only after one. A form that is red
  // the moment the page paints is telling the સંચાલક off for nothing (§31).
  const [tried, setTried] = useState(false);

  /**
   * The amount, as a **string** until it is sent.
   *
   * A number-typed state would answer `Number('')` with 0, and 0 is the one amount this function
   * refuses outright - so a half-typed box would look, for a keystroke, like a request the server
   * would reject for a reason the box could not explain. A leading '-' is kept: this is the only
   * field on the page where a negative is a real value.
   */
  const amount = parseSigned(points);
  const trimmedReason = reason.trim();

  const amountError =
    points.trim() === ''
      ? 'Enter a number of points. A minus sign takes points away.'
      : !Number.isFinite(amount)
        ? 'Enter a whole number, with a minus sign to take points away.'
        : amount === 0
          ? 'Enter something other than 0. An adjustment of nothing is not a correction.'
          : Math.abs(amount) > MANUAL_MAX
            ? `Between -${MANUAL_MAX} and ${MANUAL_MAX}.`
            : '';

  const reasonError =
    trimmedReason.length < MANUAL_REASON_MIN
      ? `Write a reason of at least ${MANUAL_REASON_MIN} characters. It is stored with the row and is the only account of why this total moved.`
      : '';

  const ready = !!chosen && !amountError && !reasonError;

  async function search(e) {
    e?.preventDefault?.();
    const t = term.trim();
    if (t.length < 2) {
      setSearchError('Type at least two characters, a full mobile number, or an SMK.');
      setResults(null);
      return;
    }
    setSearching(true);
    setSearchError('');
    setMsg(null);
    try {
      setResults(await findYuvaks(t));
    } catch (err) {
      setResults(null);
      setSearchError(dataError(err));
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    setTried(true);
    if (!ready) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await awardManualPoints({ userId: chosen.id, points: amount, reason: trimmedReason, date });
      setMsg({
        tone: 'ok',
        text:
          res.awarded > 0
            ? `Recorded. A new row of ${amount > 0 ? '+' : ''}${gu(amount)} was added for ${chosen.name} on ${res.date}. His total is now ${gu(res.total)}.`
            : 'Nothing was recorded. The server did not write a row for that amount.',
      });
      // The boxes that describe *this* adjustment are cleared; the yuvak stays chosen, because
      // two corrections for one person in a row is the ordinary case and re-searching for him
      // would be the panel making him type a name he has just typed.
      setPoints('');
      setReason('');
      setTried(false);
      onAwarded?.();
    } catch (err) {
      // §31 - a failed write leaves every box where it is and offers the button again. The
      // server's own refusal is shown when it wrote one: it names the bound it refused, which is
      // more specific than anything this form could say about it.
      setMsg({ tone: 'danger', text: pointsSaveError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <RuleCard
      id="pts-manual"
      title="Manual adjustment"
      badge="Writes a ledger row"
      badgeTone="info"
      intro="Credit or debit one yuvak. This adds a new transaction to the ledger and never edits or removes an existing one - a correction that was itself a mistake is corrected by another row, and all of them stay."
    >
      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          Adjusting a yuvak's points needs the <strong>settings.update</strong> permission - the
          same one that decides what a level is worth.
        </div>
      )}

      {/* A form element, so Enter in the search box searches instead of doing nothing. */}
      <form onSubmit={search} style={controlRow}>
        <div className="field" style={searchField}>
          <label htmlFor="pts-user-q">Find a yuvak</label>
          <input
            id="pts-user-q"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            disabled={!mayEdit || busy}
            placeholder="Name, SMK or mobile"
            aria-describedby="pts-user-q-help"
          />
          <span className="hint" id="pts-user-q-help">
            A full ten-digit mobile or an SMK matches exactly; anything else is tried as the start
            of a name.
          </span>
        </div>
        <div className="field" style={buttonField}>
          <button
            className={`btn btn-quiet${searching ? ' is-busy' : ''}`}
            type="submit"
            disabled={!mayEdit || busy || searching}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      <RuleError>{searchError}</RuleError>

      {results && results.length === 0 && (
        <p className="card-note" style={noTopMargin}>
          Nobody matched. Two things look the same here: no such yuvak, and a role without the{' '}
          <strong>users.read</strong> permission, which is answered with no rows rather than with a
          refusal. Check the spelling first.
        </p>
      )}

      {results && results.length > 0 && (
        <ul style={resultList}>
          {results.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={`pts-pick${chosen?.id === u.id ? ' is-on' : ''}`}
                onClick={() => {
                  setChosen(u);
                  setMsg(null);
                }}
                disabled={!mayEdit || busy}
              >
                <span className="pts-pick-name">{u.name || '-'}</span>
                <span className="hint">
                  {[u.smk, u.mobile].filter(Boolean).join(' · ') || 'No SMK or mobile on record'}
                </span>
                {u.status && u.status !== 'ACTIVE' && <StatusBadge tone="warn">{u.status}</StatusBadge>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <p className="card-note" style={chosenLine}>
          Adjusting <strong>{chosen.name}</strong>
          {chosen.smk ? ` (${chosen.smk})` : ''}.{' '}
          <button type="button" className="linklike" onClick={() => setChosen(null)} disabled={busy}>
            Choose somebody else
          </button>
        </p>
      )}

      <div style={controlRow}>
        {/* Not the shared NumberField: this is the one box on the page where a negative is a
            value rather than a mistake, so its bounds and its hint are its own. */}
        <div className={`field${tried && amountError ? ' is-invalid' : ''}`} style={amountField}>
          <label htmlFor="pts-manual-points">Points</label>
          <input
            id="pts-manual-points"
            type="number"
            inputMode="numeric"
            min={-MANUAL_MAX}
            max={MANUAL_MAX}
            step={1}
            value={points}
            onChange={(e) => {
              setPoints(e.target.value);
              setMsg(null);
            }}
            disabled={!mayEdit || busy}
            aria-invalid={tried && amountError ? 'true' : undefined}
            aria-describedby="pts-manual-points-help"
          />
          <span className="hint" id="pts-manual-points-help">
            A minus sign takes points away. Between <span className="mono">-{MANUAL_MAX}</span> and{' '}
            <span className="mono">{MANUAL_MAX}</span>, and never 0.
          </span>
        </div>

        <div className="field" style={dateField}>
          <label htmlFor="pts-manual-date">Business day</label>
          <input
            id="pts-manual-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!mayEdit || busy}
            aria-describedby="pts-manual-date-help"
          />
          <span className="hint" id="pts-manual-date-help">
            The day this is filed under, in India time. Leave it on today unless the correction
            belongs to an earlier day's total.
          </span>
        </div>
      </div>

      <div className={`field${tried && reasonError ? ' is-invalid' : ''}`}>
        <label htmlFor="pts-manual-reason">Reason</label>
        <textarea
          id="pts-manual-reason"
          rows="2"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setMsg(null);
          }}
          disabled={!mayEdit || busy}
          aria-invalid={tried && reasonError ? 'true' : undefined}
          aria-describedby="pts-manual-reason-help"
        />
        <span className="hint" id="pts-manual-reason-help">
          Required, and stored on the row with your name. Somebody reading this in a year should be
          able to tell what happened without asking anyone.
        </span>
      </div>

      <RuleError>{tried ? amountError || reasonError : ''}</RuleError>
      {tried && !chosen && <RuleError>Find and choose a yuvak first.</RuleError>}

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={submit}
          disabled={!mayEdit || busy}
        >
          {busy ? 'Recording…' : 'Record adjustment'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
      </div>
    </RuleCard>
  );
}

/**
 * A signed run of digits → a number, and anything else → NaN.
 *
 * Deliberately not `Number(text)`: `Number('')`, `Number(' ')` and `Number(null)` are all 0, and 0
 * is the one amount this form must refuse rather than send. NaN is passed through instead of
 * swallowed, because `Number.isFinite(NaN)` is false and that is exactly what the checks above
 * test.
 */
function parseSigned(textValue) {
  const t = String(textValue ?? '').trim();
  return t === '' || !/^-?\d+$/.test(t) ? NaN : Number(t);
}

/* ------------------------------------------------------------------ layout */

const searchField = { marginBottom: 'var(--sp-3)', flex: '1 1 240px' };

/** The button lines up with the box beside it rather than with its label. */
const buttonField = { marginBottom: 'var(--sp-3)', flex: '0 0 auto', justifyContent: 'flex-end' };

const amountField = { marginBottom: 'var(--sp-3)', flex: '0 1 200px' };

const dateField = { marginBottom: 'var(--sp-3)', flex: '0 1 230px' };

const resultList = {
  listStyle: 'none',
  display: 'grid',
  gap: 'var(--sp-2)',
  marginBottom: 'var(--sp-4)',
};

const chosenLine = { marginTop: 0, marginBottom: 'var(--sp-4)' };

const noTopMargin = { marginTop: 0 };
