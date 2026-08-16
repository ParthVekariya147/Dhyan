import { useEffect, useState } from 'react';
import { validateDailyPrompt } from '../../../../../shared/domain/daily-prompt.js';
import { updateDailyPrompt } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * "આજે તમે શું કર્યું?" — whether ક્રમાંક asks, and whether it asks by opening.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What the two switches actually decide
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A યુવક opens ક્રમાંક to find out where he stands, and until today is written down the board
 * he is reading does not have his day on it. So the app puts the day's form in front of him at
 * that moment. There are two separate decisions in that sentence and they are separate controls:
 *
 *   **Ask at all.** Off, and ક્રમાંક is exactly the board it was before this existed — no
 *   sheet, no button, and the day's record is not even read from that page. આજની પ્રગતિ is
 *   untouched and is still reached from મારું; this switch is about the board, never about the
 *   feature.
 *
 *   **Open by itself.** Off, and the sheet never appears unasked. The button at the foot of the
 *   board stays, so nothing is taken away from a યુવક who wants to write his day down — he is
 *   simply not interrupted to do it. This is the setting for a સંઘ whose યુવકો mostly do their
 *   ધ્યાન away from the phone, where an evening sheet would more often than not be asking about
 *   a day the app has no evidence of.
 *
 * The sheet ALSO never opens itself when the app recorded nothing that day, and that is not a
 * setting. It is a fact about the data rather than a decision about a સંઘ, and a switch that
 * let an empty form be put in front of every યુવક every evening would be a switch for doing the
 * one thing the design refuses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a Save button and not switches that write on the click
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §57 — nothing 2,000 people will see changes on a single click. A live-writing switch is one
 * stray tap from putting a form in front of every યુવક in the સંઘ, and there would be no moment
 * at which the સંચાલક had decided anything. It does not get the full ConfirmDialog: this is two
 * booleans, reversible in the same two clicks that set them, and it destroys nothing.
 */
export default function DailyPromptCard({ dailyPrompt, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * The same split as every other card on this page: `settings.read` opens it, `settings.update`
   * moves the switches. Disabled rather than hidden — whether the app asks a યુવક about his day
   * is exactly the sort of thing a VIEWER is asked about, and he should be able to read the
   * answer off the screen instead of guessing. The boundary is the RLS policy on `settings`
   * (0004); this is only where it becomes visible.
   */
  const mayEdit = can('settings.update');

  /*
    Already resolved by getLevelsConfig(), through the same resolveDailyPrompt() the યુવક app
    runs — never a looser read of this panel's own. It is the resolver that decides an absent key
    means ON, and a card that decided that for itself would be a second answer to one question.
    That matters more than it looks here: every settings row in the database predates this key,
    so "absent" is the state every project is currently in.
  */
  const inUse = dailyPrompt ?? { enabled: true, autoOpen: true };

  const [enabled, setEnabled] = useState(inUse.enabled);
  const [autoOpen, setAutoOpen] = useState(inUse.autoOpen);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Re-seeded when the row is re-read, so a save — or another સંચાલક's save arriving on a
  // refresh — leaves the switches agreeing with what is stored rather than with what was typed.
  useEffect(() => {
    setEnabled(inUse.enabled);
    setAutoOpen(inUse.autoOpen);
    setMsg(null);
  }, [inUse.enabled, inUse.autoOpen]);

  /*
    Switching the whole thing off takes "opens by itself" down with it, here as well as in the
    resolver and in the trigger. Three places is not duplication — it is the same rule stated
    where each of them can act on it: the resolver so a stored contradiction reads as off, the
    trigger so one cannot be written, and this so the સંચાલક never SEES the combination and then
    has his save refused for a state the screen offered him.
  */
  const onEnabled = (next) => {
    setEnabled(next);
    if (!next) setAutoOpen(false);
    // A "Saved." that survives the next click is a lie about the control in front of him.
    setMsg(null);
  };

  // Nothing to save when the switches already hold what is in force: re-saving writes a settings
  // row and files an audit entry for a change that did not happen (§41).
  const changed = enabled !== inUse.enabled || autoOpen !== inUse.autoOpen;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      /*
        Through the shared validator before the write, so the panel refuses exactly what the
        database refuses and says the same sentence about it. This should never fire — the
        control above cannot produce an invalid pair — which is the point: it is the check that
        catches a future edit to this card, not one that catches the સંચાલક.
      */
      const v = validateDailyPrompt({ enabled, autoOpen });
      if (!v.ok) {
        setMsg({ tone: 'danger', text: v.gu });
        return;
      }

      await updateDailyPrompt(v.dailyPrompt);
      // Audited by the `audit_settings` trigger (0004), not from here.
      setMsg({
        tone: 'ok',
        text: !enabled
          ? 'Saved. ક્રમાંક is just the board again - no sheet and no button.'
          : autoOpen
            ? 'Saved. The form opens on ક્રમાંક when the app has seen something a yuvak has not written down yet.'
            : 'Saved. The form no longer opens by itself. The button at the foot of ક્રમાંક is still there.',
      });
      onSaved?.();
    } catch (e) {
      // §31 — a failed save leaves the switches where he put them and offers the button again.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
        <h2 style={{ marginBottom: 0 }}>Daily record prompt</h2>
        {/* Colour is never the only signal — the word says the same thing (§43). */}
        <StatusBadge tone={inUse.enabled ? 'ok' : 'off'}>
          {!inUse.enabled ? 'Not asked' : inUse.autoOpen ? 'Opens by itself' : 'Button only'}
        </StatusBadge>
      </div>

      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        A yuvak opens ક્રમાંક to see where he stands, and until today is written down the board
        does not have his day on it. This decides whether the app asks him there. આજની પ્રગતિ is
        unaffected either way - it is still reached from મારું.
      </p>

      <div className="field">
        <label className="check" htmlFor="daily-prompt-enabled">
          <input
            id="daily-prompt-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
            disabled={!mayEdit || busy}
            aria-describedby="daily-prompt-enabled-help"
          />
          Ask about today on ક્રમાંક
        </label>
        <span className="hint" id="daily-prompt-enabled-help">
          {enabled
            ? 'On: the day’s form is reachable from the board - as a sheet, a button, or both, depending on the switch below.'
            : 'Off: ક્રમાંક is exactly the board it was before this feature. Nothing is drawn and the day’s record is not read from that page at all.'}
        </span>
      </div>

      <div className="field">
        <label className="check" htmlFor="daily-prompt-auto">
          <input
            id="daily-prompt-auto"
            type="checkbox"
            checked={autoOpen}
            onChange={(e) => {
              setAutoOpen(e.target.checked);
              setMsg(null);
            }}
            // Disabled rather than hidden while the feature is off: a control that vanishes
            // takes its explanation with it, and the સંચાલક is left unable to see what turning
            // the first switch back on would do.
            disabled={!mayEdit || busy || !enabled}
            aria-describedby="daily-prompt-auto-help"
          />
          Open the form by itself
        </label>
        <span className="hint" id="daily-prompt-auto-help">
          {autoOpen
            ? 'On: the form opens over the board when the app has recorded something today that the yuvak has not written down yet. Never when the app recorded nothing - there is no question worth putting then - and never once the day is saved. પછી closes it for that visit and it asks again on his next.'
            : 'Off: the form never appears unasked. The button at the foot of the board still opens it, so a yuvak who did his ધ્યાન away from the phone can still say so.'}
        </span>
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save prompt'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {/* §31 — the failure is not the end of the road. Same call, nothing reset. */}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      {/*
        The question this card raises and cannot answer: when does a phone see the change. The
        settings row is read once per visit to ક્રમાંક, so it lands on the next open of that
        page - which is minutes for a yuvak using the app and can be days for one who is not.
      */}
      <p className="card-note" style={{ marginBottom: 0 }}>
        A yuvak already inside the app keeps the old behaviour until his next visit to ક્રમાંક -
        the setting is read when that page opens, not while he is on it.
      </p>
    </div>
  );
}
