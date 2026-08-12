import { useEffect, useState } from 'react';
import { parseDriveFolderLink, DEFAULT_DRIVE_FOLDER_ID } from '../../../../../shared/domain/drive.js';
import { listDriveFolder } from '../../../features/darshan/services/importService';
import { updateAppSettings } from '../services/settingsService';
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
 */
export default function DriveFolderCard({ folderId, onSaved }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => setValue(folderId || ''), [folderId]);

  const parsed = parseDriveFolderLink(value || DEFAULT_DRIVE_FOLDER_ID);
  const inUse = folderId || DEFAULT_DRIVE_FOLDER_ID;

  async function save() {
    if (!parsed.ok) return setMsg({ tone: 'danger', text: parsed.gu });
    setBusy(true);
    setMsg(null);
    try {
      // The id, never the pasted link: everything downstream interpolates this into a
      // drive.google.com URL, and storing the raw paste would push that parse onto every
      // reader — including the Netlify function, which must not trust what it is given.
      await updateAppSettings({ driveFolderId: parsed.id });
      setMsg({ tone: 'ok', text: 'Saved.' });
      onSaved?.();
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
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
    setBusy(true);
    setMsg(null);
    try {
      const files = await listDriveFolder(parsed.id);
      setMsg({ tone: 'ok', text: `Found ${files.length} image${files.length === 1 ? '' : 's'} in this folder.` });
    } catch (e) {
      setMsg({ tone: 'danger', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Darshan image folder</h2>
      <p className="card-note">
        The Google Drive folder every દ્રશ્ય's picture comes from. Images are served straight
        from Google — nothing is uploaded or copied here. Paste the folder link (Share → Copy
        link) or just the id.
      </p>

      <div className="field">
        <label htmlFor="driveFolder">Drive folder link or ID</label>
        <input
          id="driveFolder"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={DEFAULT_DRIVE_FOLDER_ID}
          spellCheck={false}
        />
        <span className="hint">
          {value && !parsed.ok
            ? parsed.gu
            : `In use: ${inUse}${folderId ? '' : ' (default)'}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={save} disabled={busy || !parsed.ok}>
          Save folder
        </button>
        <button className="btn btn-ghost" type="button" onClick={check} disabled={busy || !parsed.ok}>
          Check folder
        </button>
      </div>

      {msg && (
        <div className={`notice notice-${msg.tone}`} role="status" style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}

      <p className="card-note" style={{ marginTop: 14 }}>
        The folder must be shared as <strong>Anyone with the link</strong>, otherwise Google
        will not serve the images to યુવકો.
      </p>
    </div>
  );
}
