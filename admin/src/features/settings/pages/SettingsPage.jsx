import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { getAppSettings, getLevelsConfig, updateAppSettings } from '../services/settingsService';
/* Lives in settings['levels'] rather than settings['app'], which is why it arrives on a read
   of its own below. It is here because this is where a સંચાલક looks for it. Points used to be
   its neighbour and now has a section of its own - see the card below where it stood. */
import LeaderboardCard from '../components/LeaderboardCard';
import { AsyncBlock, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import DhunCard from '../components/DhunCard';
import DriveFolderCard from '../components/DriveFolderCard';
import GalleryCard from '../components/GalleryCard';
import {
  DEFAULT_TICK_WORD,
  SLIDESHOW_KEY,
  TICK_WORD_KEY,
  TICK_WORD_MAX,
  resolveTickWord,
  validateTickWord,
} from '../../../../../shared/domain/settings.js';
import { saveError } from '../../../lib/errors';

/**
 * §34, §35 — application settings, in one controlled document.
 *
 * settings/app is read by every yuvak on every visit, so a careless write here is felt
 * immediately by 2,000 people. Hence: merge writes only, confirmation before saving, and
 * an audit entry after (§41) — written by the database, not from here.
 *
 * On roles (§35): saving this page needs `settings.update`, which SUPER_ADMIN and ADMIN
 * hold and CONTENT_MANAGER, COORDINATOR and VIEWER do not
 * (shared/domain/permissions.js). The check that matters is the one in the RLS policy on
 * the settings table; this page is only where it becomes visible.
 */
export default function SettingsPage() {
  const state = useAsync(() => getAppSettings(), []);

  /*
    The second row this page reads, and the only one that is not `settings['app']`.

    `getLevelsConfig()` hands back the level list and the લેવલ ૪ gate as well, which the two
    cards below do not use — that is deliberate rather than wasteful. Reading the whole row
    through the function that already exists keeps one reader of `settings['levels']` in this
    panel instead of two, so the day a fourth key is added to that row there is one place that
    learns about it. The Levels page makes exactly this call for its own reasons.
  */
  const levelsRow = useAsync(() => getLevelsConfig(), []);
  const { can } = useAdminAuth();

  /**
   * The route is gated on `settings.read`, so a VIEWER reaches this page and should be able
   * to read what is configured — that is the whole point of the split in AdminShell's NAV
   * note. What he must not be offered is a Save the policy will refuse after he has typed a
   * paragraph into the maintenance box. So the controls are **disabled, not hidden**: what
   * is in force stays legible, and the reason the button will not move is written next to
   * it rather than left to be discovered.
   */
  const mayEdit = can('settings.update');

  const [form, setForm] = useState({
    appName: '',
    maintenance: false,
    maintenanceMessage: '',
    tickWordOn: DEFAULT_TICK_WORD.show,
    tickWordText: DEFAULT_TICK_WORD.text,
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');
  // Whether the word field has been touched, so its rule is shown as a helper before the
  // first edit and as an error only after one. A field that is red the moment the page
  // paints is telling the સંચાલક off for something he has not done yet (§31).
  const [wordTouched, setWordTouched] = useState(false);

  useEffect(() => {
    if (!state.data) return;
    // Through the same resolver the users' app uses, never a looser read of this panel's
    // own — the field must show what is actually in force, including when the stored value
    // is one this panel would not have written.
    const word = resolveTickWord(state.data[TICK_WORD_KEY]);
    setForm({
      appName: state.data.appName || '',
      maintenance: !!state.data.maintenance,
      maintenanceMessage: state.data.maintenanceMessage || '',
      tickWordOn: word.show,
      tickWordText: word.text,
    });
    setWordTouched(false);
    setErr('');
  }, [state.data]);

  const set = (k) => (e) => {
    // A "Saved." that survives the next keystroke is a lie about the form in front of him.
    // Clearing the result on edit is what keeps the save-state a statement about what is on
    // screen rather than about what was on screen a minute ago.
    setMsg(null);
    setErr('');
    if (k === 'tickWordText' || k === 'tickWordOn') setWordTouched(true);
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  };

  /*
    The same shared rule the save runs, evaluated as he types so the message arrives at the
    keystroke that caused it. It is *display only* — save() below validates again and is the
    authority, because a live check that drifted from the saved one would be a second answer
    to one question, which is precisely what shared/domain/settings.js is written to prevent.
  */
  const wordDraft = { show: form.tickWordOn, text: form.tickWordText.replace(/\s+/g, ' ').trim() };
  const wordCheck = validateTickWord(wordDraft);
  const wordError = err || (wordTouched && !wordCheck.ok ? wordCheck.gu : '');

  async function save() {
    const word = { show: form.tickWordOn, text: form.tickWordText.replace(/\s+/g, ' ').trim() };
    /*
      Validated before anything is written, and with the shared rule rather than a check of
      this page's own. A word this panel accepted and resolveTickWord() then replaced would
      leave the સંચાલક looking at his own word in this field while every યુવક read a
      different one — the two-answers-to-one-question fault the Level 4 gate note in
      shared/domain/settings.js exists to prevent.
    */
    const v = validateTickWord(word);
    if (!v.ok) {
      setErr(v.gu);
      setWordTouched(true);
      setConfirm(false);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await updateAppSettings({
        appName: form.appName.trim(),
        maintenance: form.maintenance,
        maintenanceMessage: form.maintenanceMessage.trim(),
        [TICK_WORD_KEY]: word,
      });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), not from here.
      setMsg({ tone: 'ok', text: 'Saved - this is what users see now.' });
      state.retry();
    } catch (e) {
      // §31 — a failed save leaves the typing where it is and offers the same button again.
      // Nothing is reset and nothing is retried automatically: a settings write that 2,000
      // people feel is not something to repeat without being asked.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        sub="Name, maintenance, the two dhun, the Drive folder and the gallery slideshow - all in the settings/app row"
      />

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={5} />}>
        <>
          {/*
            One read-only banner for the page rather than one per card. A VIEWER is told once
            why nothing moves; repeating it above the dhun and the folder would be three
            copies of one sentence on a screen he cannot act on at all.
          */}
          {!mayEdit && (
            <div className="notice notice-warn" role="status">
              You can read every setting here, but saving needs the <strong>settings.update</strong>{' '}
              permission. The controls are shown so you can see what is in force.
            </div>
          )}

          <div className="card">
            <div style={cardHead}>
              <h2 style={{ marginBottom: 0 }}>General</h2>
              {/* Colour is never the only signal — the word in the badge says the same (§43). */}
              <StatusBadge tone={form.maintenance ? 'warn' : 'ok'}>
                {form.maintenance ? 'Maintenance on' : 'App open'}
              </StatusBadge>
            </div>
            <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
              These reach every yuvak on his next visit. Nothing here needs a deploy.
            </p>

            <div className="field">
              <label htmlFor="appName">App name</label>
              <input
                id="appName"
                type="text"
                value={form.appName}
                onChange={set('appName')}
                disabled={!mayEdit || busy}
                placeholder="નીલકંઠ વર્ણી ધ્યાન"
                aria-describedby="appName-help"
              />
              <span className="hint" id="appName-help">
                Shown in the app's own header. Leave it empty to keep the built-in name.
              </span>
            </div>

            <div className="field">
              {/* .check gives the row a --tap-tall hit area, so the label and the box are one
                  target big enough for a thumb rather than a 16px square. */}
              <label className="check" htmlFor="maint">
                <input
                  id="maint"
                  type="checkbox"
                  checked={form.maintenance}
                  onChange={set('maintenance')}
                  disabled={!mayEdit || busy}
                  aria-describedby="maint-help"
                />
                Turn on Maintenance
              </label>
              <span className="hint" id="maint-help">
                While this is on, users see the message below instead of the app.
              </span>
            </div>

            <div className="field">
              <label htmlFor="mm">Maintenance message</label>
              <textarea
                id="mm"
                rows="2"
                value={form.maintenanceMessage}
                onChange={set('maintenanceMessage')}
                disabled={!mayEdit || busy}
                aria-describedby="mm-help"
              />
              <span className="hint" id="mm-help">
                Written in Gujarati, and read by someone who cannot get in - say when he
                should come back, not what broke.
              </span>
            </div>

            {/*
              The word a ticked row carries, in the General card and saved by its button.

              Not a card of its own, and not on the Levels page: it is a field of
              settings/app exactly as the app name is, and the `audit_settings` trigger
              records a write to that row as one SETTINGS_UPDATED — so a separate Save here
              would put two entries in the log for one visit and describe an edit that never
              happened as two.

              Where it appears is stated in the hint rather than left to be discovered. A
              setting whose effect a સંચાલક cannot find is a setting he will change twice and
              then leave alone.
            */}
            <div
              className="field"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)' }}
            >
              <label className="check" htmlFor="tw-on">
                <input
                  id="tw-on"
                  type="checkbox"
                  checked={form.tickWordOn}
                  onChange={set('tickWordOn')}
                  disabled={!mayEdit || busy}
                  aria-describedby="tw-on-help"
                />
                Show a word on a ticked row
              </label>
              <span className="hint" id="tw-on-help">
                Level 4 tests show a number and a box and nothing else, so the row is mostly
                empty. With this on, the word below appears inside a row the moment the user
                ticks it, and goes when he unticks it. Turn it off and the rows stay exactly
                as they are now.
              </span>
            </div>

            <div className={`field${wordError ? ' is-invalid' : ''}`}>
              <label htmlFor="tw">The word</label>
              <input
                id="tw"
                type="text"
                maxLength={TICK_WORD_MAX}
                value={form.tickWordText}
                onChange={set('tickWordText')}
                placeholder={DEFAULT_TICK_WORD.text}
                disabled={!mayEdit || busy || !form.tickWordOn}
                aria-describedby="tw-help"
                aria-invalid={wordError ? 'true' : undefined}
              />
              <span className="hint" id="tw-help">
                {/* The counter is the limit made visible rather than announced only on
                    refusal — maxLength already stops the typing, and a stopped keyboard with
                    no explanation reads as a broken field. */}
                <span className="mono">
                  {form.tickWordText.trim().length}/{TICK_WORD_MAX}
                </span>{' '}
                characters - it has to fit inside a row on a phone. One word for every row:
                it is the same on all of them, and it never says anything about the Darshan
                behind the number.
              </span>
              {wordError && (
                <span className="field-error" role="alert">
                  <span aria-hidden="true">⚠</span> {wordError}
                </span>
              )}
            </div>

            <div className="form-actions">
              <button
                className={`btn${busy ? ' is-busy' : ''}`}
                type="button"
                onClick={() => setConfirm(true)}
                disabled={busy || !mayEdit}
              >
                {busy ? 'Saving…' : 'Save settings'}
              </button>
              {msg && (
                <span
                  className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
                  role={msg.tone === 'ok' ? 'status' : 'alert'}
                >
                  {msg.text}
                </span>
              )}
              {/* §31 — a failed save must offer the way out of it, on the spot. The second
                  attempt skips the dialog: it was already confirmed, and asking twice for one
                  decision teaches him to click through it. */}
              {msg?.tone === 'danger' && (
                <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
                  Try again
                </button>
              )}
            </div>
          </div>

          {/*
            §8 — the two ધૂન. Same row, same permission, so it belongs on this page rather
            than on a route of its own: `dhun` is a field of settings/app exactly as
            `youtubeUrl` is, and the audit trail records both as one SETTINGS_UPDATED.
            It reads and writes through its own service (dhunService.js), because uploading
            an MP3 to Storage is nothing like saving a text field and merging the two would
            make this page harder to read, not smaller.
          */}
          <DhunCard dhun={state.data?.dhun} onSaved={state.retry} />

          {/*
            The Drive folder every દ્રશ્ય's image comes from. Same row, same permission, and
            like DhunCard it saves through its own path — it validates a folder link and can
            read the folder back, neither of which the general form above knows how to do.
          */}
          <DriveFolderCard folderId={state.data?.driveFolderId} onSaved={state.retry} />

          {/*
            How long લેવલ ૨'s fullscreen viewer holds each દ્રશ્ય on આપોઆપ. Same row and same
            permission as everything above; separate because it has a bound the database
            enforces (0018) and therefore a refusal path of its own, which belongs beside the
            field that caused it rather than under a Save shared with the maintenance message.
          */}
          <GalleryCard slideshow={state.data?.[SLIDESHOW_KEY]} onSaved={state.retry} />

          {/*
            ────────────────────────────────────────────────────────────────────
            Points and the leaderboard — the same page, a different row
            ────────────────────────────────────────────────────────────────────

            Everything above this line is `settings['app']`, read once into `state`. These two
            are `settings['levels']` — the row that also holds the level names and the લેવલ ૪
            gate — so they arrive on their own read, in `levelsRow`.

            They were on the Levels page first, on the reasoning that a setting belongs with
            the row it lives in. That reasoning was about the database and this is a question
            about the panel: a સંચાલક looking for "how many points is લેવલ ૩ worth" opens
            Settings, and a card he cannot find is a card that does not exist. The row it is
            written into is an implementation detail he has no reason to know.

            The second read costs one request on a page that already makes several, and it is
            deliberately NOT merged into the `app` read: two rows are two rows, and a single
            `useAsync` covering both would mean a failure to read the level configuration
            blanking the maintenance message and the ધૂન beside it. Its own AsyncBlock, so it
            reports its own outcome and carries its own retry — the rule this whole panel
            follows (UserDetailPage.jsx:41).
          */}
          <AsyncBlock
            state={levelsRow}
            onRetry={levelsRow.retry}
            skeleton={<FormSkeleton fields={4} />}
          >
            <>
              {/*
                ──────────────────────────────────────────────────────────────
                Points moved out, and this card is not a courtesy
                ──────────────────────────────────────────────────────────────

                A four-number card stood here and edited the same
                `settings['levels'].value.points` object that Point Management now edits. Two
                editors of one object would have been untidy; these two would have been
                destructive. The old card's save wrote `{...currentRow, points: <what the card
                held>}` - correctly merging at the *row* level, so the level list and the લેવલ ૪
                gate survived, but replacing the `points` object wholesale. It knew four keys.
                The engine now stores `version`, `effectiveFrom`, `disabled`, `repeat` and
                `tick` beside them, so one save from this page would have silently deleted the
                entire rule configuration - the repeat prices, the તિક mode, every switched-off
                activity - and the only symptom would have been awards quietly reverting to the
                flat per-day rule with nothing on any screen able to say why.

                So the card was removed rather than taught the new keys: a second editor that
                has to be kept in step with the first is the same bug with a longer fuse. This
                is the pointer that replaces it, kept because a સંચાલક who has always found
                points on this page must not conclude the feature is gone.
              */}
              <div className="card">
                <h2 style={{ marginBottom: 0 }}>Points</h2>
                <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
                  Point values, repeat rules, the Level 3 tick mode and per-test prices are now
                  set in their own section, together with the ledger they pay into.
                </p>
                <Link to="/points">Open Point Management</Link>
              </div>
              {/*
                Below the values it ranks people by, because that is the order of the
                decisions: what an act is worth comes before who is ahead of whom.
              */}
              <LeaderboardCard leaderboard={levelsRow.data?.leaderboard} onSaved={levelsRow.retry} />
            </>
          </AsyncBlock>

          {/*
            Not "Elsewhere" as a paragraph any more. Three settings of the same row live on
            three other pages, and a list of named destinations is findable in a way a
            sentence with links buried in it is not.
          */}
          <div className="card">
            <h2>Configured on another page</h2>
            <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
              All of these are saved into the same settings collection. Each has its own
              validation, so each has its own page.
            </p>
            <ul style={linkList}>
              <li style={linkRow}>
                <Link to="/video">Video</Link>
                <span className="hint">The YouTube link on the Entry Gate.</span>
              </li>
              <li style={linkRow}>
                <Link to="/levels">Levels</Link>
                <span className="hint">
                  Which levels are offered, what they are called, and what opens Level 4.
                </span>
              </li>
              <li style={linkRow}>
                <Link to="/navigation">Navigation</Link>
                <span className="hint">
                  The buttons at the bottom of a phone - which ones, in what order, and under
                  what word.
                </span>
              </li>
              <li style={linkRow}>
                <Link to="/levels/4">Level 4</Link>
                <span className="hint">
                  The sub-levels (4.1, 4.2 …) and which Darshan each one asks for.
                </span>
              </li>
            </ul>
          </div>

          <ConfirmDialog
            open={confirm}
            title="Save settings?"
            body={
              form.maintenance
                ? 'Maintenance is on: users will see the maintenance message instead of the app, immediately.'
                : 'This change will apply immediately for all users.'
            }
            confirmLabel="Save settings"
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants.
 *
 * These are the few shapes admin.css has no class for, and they are objects at module
 * scope rather than inline literals so React is not handed a fresh style object on every
 * keystroke. Every value is a token: nothing here may invent a colour, a radius or a gap
 * (admin.css, "HOW TO USE THIS FILE").
 * ------------------------------------------------------------------------- */

/** Card title with a status beside it. `wrap` is what keeps the badge off the title on a
 *  320px screen instead of squeezing both. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};

const linkList = { listStyle: 'none', display: 'grid', gap: 'var(--sp-3)' };

/** Name over description, so a long Gujarati caption wraps under the link rather than
 *  pushing it out of the card. */
const linkRow = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };
