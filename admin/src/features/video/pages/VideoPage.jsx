import { useEffect, useState } from 'react';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { getAppSettings, updateAppSettings } from '../../settings/services/settingsService';
import { AsyncBlock, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader, StatusBadge } from '../../../components/StatCard';
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
  const { can } = useAdminAuth();

  /**
   * The route is `settings.read`, so a VIEWER gets here and should be able to see — and
   * play — the video that is on the gate today. What he is not offered is a Save the RLS
   * policy on `settings` will refuse. Disabled, not hidden: the link, the player and the
   * validation all stay, because reading what is configured is exactly what the read
   * permission is for (AdminShell's NAV note makes the same split).
   */
  const mayEdit = can('settings.update');

  const [url, setUrl] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = state.data?.youtubeUrl || '';
  useEffect(() => {
    setUrl(current);
    setPreviewId(null);
    setErr('');
  }, [current]);

  const currentId = youtubeId(current);
  const changed = url.trim() !== current.trim();
  const showingId = previewId || currentId;

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
      // Nothing is cleared. The link he pasted stays in the box and the Try again beside
      // this message re-runs the same save — §31, a failure has to have a way out of it.
      setMsg({ tone: 'danger', text: saveError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <PageHeader title="Video" sub="The YouTube video shown on the Entry Gate" />

      <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={3} />}>
        <>
          {!mayEdit && (
            <div className="notice notice-warn" role="status">
              You can see and play the video that is set, but changing it needs the{' '}
              <strong>settings.update</strong> permission.
            </div>
          )}

          <div className="card">
            <div style={cardHead}>
              <h2 style={{ marginBottom: 0 }}>Entry Gate video</h2>
              <StatusBadge tone={currentId ? 'ok' : 'warn'}>
                {currentId ? 'A video is set' : 'No video set'}
              </StatusBadge>
            </div>

            {/*
              §35 — the absence of a link is a state with a name and a next step, not a gap
              in the page. It is also the state this project actually starts in, so it is
              worth more than a blank line.
            */}
            {current ? (
              <dl className="kv" style={{ marginBottom: 'var(--sp-4)' }}>
                <dt>In force now</dt>
                {/* break-all: a YouTube URL is one long unbreakable token and would push the
                    card past the viewport on a 320px phone. */}
                <dd className="mono" style={{ wordBreak: 'break-all' }}>{current}</dd>
              </dl>
            ) : (
              <div className="notice notice-warn" role="status">
                <strong>No link has been set yet.</strong> Users reach the Entry Gate and see
                no video there. Paste a YouTube link below to fill it.
              </div>
            )}

            <div className={`field${err ? ' is-invalid' : ''}`}>
              <label htmlFor="url">{current ? 'Replace with' : 'YouTube link'}</label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setErr('');
                  setMsg(null);
                }}
                disabled={!mayEdit || busy}
                placeholder="https://www.youtube.com/watch?v=…"
                spellCheck={false}
                aria-describedby="url-help"
                aria-invalid={err ? 'true' : undefined}
              />
              <span className="hint" id="url-help">
                The full link or just the 11-character video id - both will work. Preview it
                first: the panel plays the real video, so what you see here is what reaches
                the gate.
              </span>
              {err && (
                <span className="field-error" role="alert">
                  <span aria-hidden="true">⚠</span> {err}
                </span>
              )}
            </div>

            <div className="form-actions">
              {/* Preview before Save, in that order on the row, because that is the order
                  §58 asks for them to be used in. */}
              <button className="btn btn-quiet" type="button" onClick={preview} disabled={!url.trim()}>
                Preview
              </button>
              <button
                className={`btn${busy ? ' is-busy' : ''}`}
                type="button"
                disabled={!mayEdit || !changed || busy}
                onClick={() => setConfirm(true)}
              >
                {busy ? 'Saving…' : 'Save link'}
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
                <button className="btn btn-quiet btn-sm" type="button" onClick={save} disabled={busy}>
                  Try again
                </button>
              )}
            </div>
          </div>

          {showingId && (
            <div className="card">
              <div style={cardHead}>
                <h2 style={{ marginBottom: 0 }}>{previewId ? 'Preview' : 'On the gate now'}</h2>
                <StatusBadge tone={previewId ? 'info' : 'ok'}>
                  {previewId ? 'Not saved yet' : 'Live'}
                </StatusBadge>
              </div>

              {/*
                The frame is fluid up to 640px and keeps 16:9 at every width, so on a 320px
                phone it shrinks rather than spilling. Nothing here caps the resolution:
                YouTube's own player picks the stream, and the iframe is given the full
                width it is allowed to have — a smaller box would be a smaller video for no
                reason.
              */}
              <div style={{ aspectRatio: '16 / 9', width: '100%', maxWidth: 640 }}>
                <iframe
                  key={showingId}
                  src={`https://www.youtube-nocookie.com/embed/${showingId}`}
                  title={previewId ? 'Preview of the new video' : 'The video currently on the Entry Gate'}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 0,
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface-sunken)',
                  }}
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>

              {previewId && previewId !== currentId && (
                <p className="card-note">
                  This is the link in the box above, not the one users see. It reaches the
                  Entry Gate only when you press <strong>Save link</strong>.
                </p>
              )}
            </div>
          )}

          <ConfirmDialog
            open={confirm}
            title="Change the video?"
            body="This link will apply immediately on the Entry Gate for all users."
            confirmLabel="Save link"
            busy={busy}
            onConfirm={save}
            onCancel={() => setConfirm(false)}
          />
        </>
      </AsyncBlock>
    </>
  );
}

/* Layout constant at module scope, so typing in the link box does not allocate a new style
 * object per keystroke. Tokens only; admin.css owns every value. */
const cardHead = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--sp-3)',
};
