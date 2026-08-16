import { useEffect, useState } from 'react';
import {
  DHUN_AUTOPLAY_KEY,
  resolveDhunAutoplay,
} from '../../../../../shared/domain/settings.js';
import { updateAppSettings } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * Whether the ધૂન starts by itself when a યુવક signs in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What the switch actually decides
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Not "is there music" — that is DhunCard below, and it is unaffected. This decides **who
 * presses play**. On, and the app behaves as it always has: the yuvak arrives and the dhun
 * fades in under him (§8). Off, and the corner button, both track names and the volume
 * slider are all exactly where they were, but nothing sounds until he taps.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Off means the file is never fetched, and that is the reason this exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The player's <audio> is `preload="none"`, so the MP3's bytes are requested by the call to
 * play() and by nothing else. With this off there is no such call until a finger causes one.
 *
 * The saving is a first visit, not every visit, and the distinction is worth keeping straight
 * because overstating it would make this card lie: the objects are immutable and served with a
 * one-year cache-control (0007_dhun_storage.sql), so a yuvak who has heard the dhun once is
 * playing it out of his own cache thereafter. What autoplay-off avoids is that first download
 * being spent on a yuvak who opened the app to tick a Darshan and leave - and it is spent
 * again on every phone that clears its cache or installs the app fresh.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why a Save button and not a switch that writes on the click
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §57 - nothing 2,000 people will hear changes on a single click. A live-writing switch is
 * one stray tap from re-enabling music in a room full of yuvaks, and there would be no moment
 * in which the સંચાલક had decided anything. It does not get the full ConfirmDialog that
 * removing a dhun gets, because the two are not comparable: this is one boolean, reversible
 * in the same two clicks that set it, and destroys nothing. The checkbox is the choice, the
 * button is the decision.
 */
export default function DhunAutoplayCard({ autoplay, onSaved }) {
  const { can } = useAdminAuth();

  /**
   * Same split as everything else on this page: `settings.read` opens the card,
   * `settings.update` moves the switch. Disabled rather than hidden - whether the app greets
   * a yuvak with music is exactly the sort of thing a VIEWER is asked about, and he should be
   * able to read the answer off the screen instead of guessing. The boundary is the RLS
   * policy on `settings` (0004_rbac.sql:650); this is only where it becomes visible.
   */
  const mayEdit = can('settings.update');

  /*
    Through the same resolver the yuvak app runs, never a looser read of this panel's own. It
    is the resolver that decides an absent key means on, and a card that decided that for
    itself would be a second answer to one question - the fault shared/domain/settings.js is
    written to prevent. It also matters more here than it looks: every settings row in the
    database predates this key, so "absent" is the state nearly every project is in.
  */
  const inUse = resolveDhunAutoplay(autoplay).on;

  const [on, setOn] = useState(inUse);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Re-seeded when the row is re-read, so a save (or another admin's save arriving on a
  // retry) leaves the checkbox agreeing with what is stored rather than with what was typed.
  useEffect(() => {
    setOn(inUse);
    setMsg(null);
  }, [inUse]);

  // Nothing to save when the box already holds what is in force: re-saving writes a settings
  // row and files an audit entry for a change that did not happen (§41).
  const changed = on !== inUse;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await updateAppSettings({ [DHUN_AUTOPLAY_KEY]: { on } });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.
      setMsg({
        tone: 'ok',
        text: on
          ? 'Saved. The dhun starts on its own again, from each yuvak’s next visit.'
          : 'Saved. From his next visit a yuvak hears nothing until he taps the corner button.',
      });
      onSaved?.();
    } catch (e) {
      // §31 - a failed save leaves the checkbox where he put it and offers the button again.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>Dhun autoplay</h2>
        {/* Colour is never the only signal - the word says the same thing (§43). */}
        <StatusBadge tone={inUse ? 'ok' : 'off'}>
          {inUse ? 'Starts on its own' : 'Yuvak taps to start'}
        </StatusBadge>
      </div>

      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        This decides who presses play, not whether there is music. The corner button, both dhun
        names and the volume slider stay exactly where they are either way.
      </p>

      <div className="field">
        {/* .check gives the row a --tap-tall hit area, so the label and the box are one target
            big enough for a thumb rather than a 16px square. */}
        <label className="check" htmlFor="dhun-autoplay">
          <input
            id="dhun-autoplay"
            type="checkbox"
            checked={on}
            onChange={(e) => {
              setOn(e.target.checked);
              // A "Saved." that survives the next click is a lie about the control in front
              // of him.
              setMsg(null);
            }}
            disabled={!mayEdit || busy}
            aria-describedby="dhun-autoplay-help"
          />
          Start the dhun automatically when a yuvak signs in
        </label>
        <span className="hint" id="dhun-autoplay-help">
          {on
            ? 'On: the dhun fades in by itself, as it does today. The MP3 is pulled down the first time each phone plays it - after that it comes from that phone’s own cache - so the cost is one download per yuvak, paid whether or not he wanted music.'
            : 'Off: nothing is downloaded and nothing sounds until the yuvak taps the corner button, which reads લોડ કરો until he does. A yuvak who had already turned the dhun off himself is unaffected - his own choice is still his.'}
        </span>
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || busy || !changed}
        >
          {busy ? 'Saving…' : 'Save autoplay'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {/* §31 - the failure is not the end of the road. Same call, nothing reset. */}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
            Try again
          </button>
        )}
      </div>

      {/*
        Said here because it is the question this switch raises and the switch cannot answer
        it: a yuvak already inside the app does not hear the change. settings/app is read once
        per visit, so this reaches a phone on its next load - which for an installed app can be
        days (see the note over SessionCard on why that is).
      */}
      <p className="card-note">
        This reaches a yuvak the next time the app loads, not while he is in it. Nothing here
        stops a dhun that is already playing on someone’s phone.
      </p>
    </div>
  );
}

/* Layout constant at module scope - a fresh object per render is work nobody asked for.
 * Tokens only; admin.css owns every value. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
