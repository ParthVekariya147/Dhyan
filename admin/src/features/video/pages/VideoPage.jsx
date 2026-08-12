import { useEffect, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { getAppSettings, updateAppSettings } from '../../settings/services/settingsService';
import { AsyncBlock } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { validateYoutubeUrl, youtubeId } from '../../../../../shared/domain/settings.js';
import { saveError } from '../../../lib/errors';

/**
 * §33 — the પ્રવેશદ્વાર video link.
 *
 * The યુવક app reads this from settings/app on every visit (src/lib/useSettings.js), so
 * saving here changes the entry gate for everyone without a redeploy. That is the point:
 * PLAN.md lists the YouTube link as still pending from the સંચાલક, and it should not need
 * an engineer when it arrives.
 *
 * The URL is validated against the same shared rule the યુવક app applies. That app embeds
 * it in an iframe, so anything that does not resolve to a YouTube video id is refused
 * rather than saved and discovered later as a blank gate.
 *
 * Preview before save (§58): the admin sees the actual video playing before the change
 * reaches 2,000 people.
 */
export default function VideoPage() {
  const state = useAsync(() => getAppSettings(), []);
  const [url, setUrl] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = state.data?.youtubeUrl || '';
  useEffect(() => setUrl(current), [current]);

  const currentId = youtubeId(current);
  const changed = url.trim() !== current.trim();

  function preview() {
    const v = validateYoutubeUrl(url);
    if (!v.ok) {
      setErr(v.gu);
      setPreviewId(null);
      return;
    }
    setErr('');
    setPreviewId(v.id);
  }

  async function save() {
    const v = validateYoutubeUrl(url);
    if (!v.ok) {
      setErr(v.gu);
      setConfirm(false);
      return;
    }
    setBusy(true);
    try {
      await updateAppSettings({ youtubeUrl: v.url });
      // Audited by the `audit_settings` trigger (0004_rbac.sql), which reads the old and
      // new youtubeUrl out of the row itself and records VIDEO_UPDATED.
      setMsg({ tone: 'ok', text: 'Saved. Users will now see the new video.' });
      state.retry();
    } catch (e) {
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <PageHeader title="Video" sub="The YouTube video shown on the Entry Gate" />

      <AsyncBlock state={state} onRetry={state.retry}>
        <>
          {msg && <div className={`notice notice-${msg.tone}`} role="status">{msg.text}</div>}

          <div className="card">
            <h2>Current link</h2>
            {current ? (
              <p className="mono" style={{ wordBreak: 'break-all' }}>{current}</p>
            ) : (
              <div className="notice notice-warn">
                No link has been set yet — users do not see a video on the Entry Gate.
              </div>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="url">New link</label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setErr('');
                }}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <span className="hint">The full link or just the 11-character video id — both will work.</span>
            </div>

            {err && <div className="notice notice-danger" role="alert">{err}</div>}

            <div className="page-actions">
              <button className="btn btn-quiet" type="button" onClick={preview} disabled={!url.trim()}>
                Preview
              </button>
              <button className="btn" type="button" disabled={!changed || busy} onClick={() => setConfirm(true)}>
                Save
              </button>
            </div>
          </div>

          {(previewId || currentId) && (
            <div className="card">
              <h2>{previewId ? 'New video' : 'Current video'}</h2>
              <div style={{ aspectRatio: '16 / 9', maxWidth: 640 }}>
                <iframe
                  key={previewId || currentId}
                  src={`https://www.youtube-nocookie.com/embed/${previewId || currentId}`}
                  title="Video preview"
                  style={{ width: '100%', height: '100%', border: 0, borderRadius: 8 }}
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            </div>
          )}

          <ConfirmDialog
            open={confirm}
            title="Change the video?"
            body="This link will apply immediately on the Entry Gate for all users."
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}
