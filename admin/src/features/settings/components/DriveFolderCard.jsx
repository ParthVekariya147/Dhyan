import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseDriveFolderLink, DEFAULT_DRIVE_FOLDER_ID } from '../../../../../shared/domain/drive.js';
import { listDriveFolder } from '../../../features/darshan/services/importService';
import { updateAppSettings } from '../services/settingsService';
import { useAdminAuth } from '../../../lib/adminAuth';
import { StatusBadge } from '../../../components/StatCard';
import { saveError } from '../../../lib/errors';

/**
 * Where the દર્શન artwork lives — one Google Drive folder, named here rather than in code.
 *
 * This is the root of the whole image path. Every દ્રશ્ય's picture is a file in this folder,
 * addressed by its Drive id; the bulk import resolves the sheet's ફોટો ફાઈલ column against
 * this folder's listing, and `npm run darshan` builds content/darshan.json from it.
 *
 * It has a default (the folder the collection lives in today) so nothing breaks if it is
 * never set. What it buys is that moving to a second folder — a new batch, a re-shoot, a
 * different sub-collection — is something the સંચાલક does in a text box rather than something
 * that needs a developer and a deploy (§62).
 *
 * A folder **link** is accepted as well as a bare id, because Share → Copy link is what a
 * person actually has in hand; `parseDriveFolderLink` pulls the id out of either. It refuses
 * a link to a single file with a message saying so, since that is the likely wrong paste.
 *
 * §26 — the card is written so it cannot be mistaken for an upload box. Nothing is stored
 * here: this names the *source*, and the two things downstream of it (the bulk import, and
 * the URL every યુવક's browser fetches) are said in the card rather than left to be inferred
 * from the word "folder".
 */
export default function DriveFolderCard({ folderId, onSaved }) {
  const { can } = useAdminAuth();
  /**
   * Same split as everywhere else in this page: `settings.read` opens the card,
   * `settings.update` moves the folder. Disabled rather than hidden — which folder the
   * દર્શન come from is the single most useful fact on this card, and a VIEWER diagnosing a
   * wall of broken images needs to read it. "Check folder" stays live for everyone: it only
   * lists a public folder, writes nothing, and it is the one control that turns "the images
   * are broken" into a sentence.
   */
  const mayEdit = can('settings.update');

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(null); // null | 'save' | 'check'
  const [msg, setMsg] = useState(null);

  useEffect(() => setValue(folderId || ''), [folderId]);

  const parsed = parseDriveFolderLink(value || DEFAULT_DRIVE_FOLDER_ID);
  const inUse = folderId || DEFAULT_DRIVE_FOLDER_ID;
  // Only complain about what he actually typed. An empty box falls back to the default and
  // is a valid state, not a mistake to be marked in red (§31).
  const parseError = value.trim() && !parsed.ok ? parsed.gu : '';
  // Save is offered only when the box resolves to a *different* folder. Re-saving the id
  // already in force writes a settings row and files an audit entry for a change that did
  // not happen (§41), and a trail with entries that mean nothing is a trail nobody reads.
  const changed = parsed.ok && parsed.id !== inUse;

  async function save() {
    if (!parsed.ok) return setMsg({ tone: 'danger', text: parsed.gu });
    setBusy('save');
    setMsg(null);
    try {
      // The id, never the pasted link: everything downstream interpolates this into a
      // drive.google.com URL, and storing the raw paste would push that parse onto every
      // reader — including the Netlify function, which must not trust what it is given.
      await updateAppSettings({ driveFolderId: parsed.id });
      setMsg({ tone: 'ok', kind: 'save', text: 'Saved. New imports read from this folder.' });
      onSaved?.();
    } catch (e) {
      setMsg({ tone: 'danger', kind: 'save', text: saveError(e) });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Read the folder back before trusting it.
   *
   * A folder id that is well-formed but wrong — the સંચાલક's own Drive rather than the shared
   * one, or a folder whose sharing was never set to "Anyone with the link" — looks exactly
   * like a correct one in this box. The only way to tell is to ask, so this asks, and reports
   * the count. Cheap, and it turns a silent misconfiguration into a sentence.
   */
  async function check() {
    if (!parsed.ok) return setMsg({ tone: 'danger', text: parsed.gu });
    setBusy('check');
    setMsg(null);
    try {
      const files = await listDriveFolder(parsed.id);
      setMsg({
        tone: 'ok',
        kind: 'check',
        text: `Found ${files.length} image${files.length === 1 ? '' : 's'} in this folder.`,
      });
    } catch (e) {
      setMsg({ tone: 'danger', kind: 'check', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  /** Whatever failed, run again. No confirmation: neither of these is destructive. */
  const retry = () => (msg?.kind === 'check' ? check() : save());

  return (
    <div className="card">
      <div style={cardHead}>
        <h2 style={{ marginBottom: 0 }}>Darshan image source</h2>
        {/* Which of the two it is, in a word: the folder he chose, or the built-in one he
            has never touched. The distinction matters the day the images go missing. */}
        <StatusBadge tone={folderId ? 'info' : 'off'}>
          {folderId ? 'Custom folder' : 'Built-in default'}
        </StatusBadge>
      </div>

      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
        One Google Drive folder is the source of every દ્રશ્ય's picture. Nothing is uploaded or
        copied into this panel - the bulk import matches the sheet's ફોટો ફાઇલ column against
        this folder's listing, and each yuvak's browser then fetches the image straight from
        Google.
      </p>

      <div className={`field${parseError ? ' is-invalid' : ''}`}>
        <label htmlFor="driveFolder">Drive folder link or ID</label>
        <input
          id="driveFolder"
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMsg(null);
          }}
          disabled={!mayEdit || busy === 'save'}
          placeholder={DEFAULT_DRIVE_FOLDER_ID}
          spellCheck={false}
          aria-describedby="driveFolder-help"
          aria-invalid={parseError ? 'true' : undefined}
        />
        <span className="hint" id="driveFolder-help">
          Paste the folder link (Share → Copy link) or just the id. In use now:{' '}
          {/* break-all because a Drive id is one unbreakable 33-character token and would
              otherwise widen the card past a 320px screen. */}
          <span className="mono" style={{ wordBreak: 'break-all' }}>{inUse}</span>
          {folderId ? '' : ' (built-in default)'}
        </span>
        {parseError && (
          <span className="field-error" role="alert">
            <span aria-hidden="true">⚠</span> {parseError}
          </span>
        )}
      </div>

      <div className="form-actions">
        <button
          className={`btn${busy === 'save' ? ' is-busy' : ''}`}
          type="button"
          onClick={save}
          disabled={!mayEdit || Boolean(busy) || !parsed.ok || !changed}
        >
          {busy === 'save' ? 'Saving…' : 'Save folder'}
        </button>
        <button
          className={`btn btn-quiet${busy === 'check' ? ' is-busy' : ''}`}
          type="button"
          onClick={check}
          disabled={Boolean(busy) || !parsed.ok}
        >
          {busy === 'check' ? 'Checking…' : 'Check folder'}
        </button>
        {msg && (
          <span
            className={`save-state ${msg.tone === 'ok' ? 'is-ok' : 'is-error'}`}
            role={msg.tone === 'ok' ? 'status' : 'alert'}
          >
            {msg.text}
          </span>
        )}
        {msg?.tone === 'danger' && (
          <button className="btn btn-quiet btn-sm" type="button" onClick={retry} disabled={Boolean(busy)}>
            Try again
          </button>
        )}
      </div>

      {/*
        Kept as a warning, and kept where it cannot be scrolled past.

        This is a real operational failure mode, not advice: a folder shared to named people
        parses correctly, saves correctly and then serves nobody. The images simply do not
        appear, for all 2,000 યુવકો at once, with nothing anywhere to say why. "Check folder"
        above is the test for it.
      */}
      <div className="notice notice-warn" role="note" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
        The folder must be shared as <strong>Anyone with the link</strong>. If it is not,
        Google refuses the images and yuvaks see empty frames - the panel cannot tell the
        difference from the id alone.
      </div>

      {/* The other half of §26: where the folder is actually consumed. Only offered to
          somebody the import route will let in, so this is never a link into a refusal. */}
      {can('darshan.update') && (
        <p className="card-note">
          Bringing pictures in from this folder is done on the{' '}
          <Link to="/darshan/import">Darshan import</Link> page.
        </p>
      )}
    </div>
  );
}

/* Layout constant at module scope — a fresh object per keystroke is a re-render nobody
 * asked for. Tokens only; admin.css owns every value. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-2)',
};
