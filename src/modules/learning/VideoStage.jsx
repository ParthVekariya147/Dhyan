import { useSettings, youtubeId } from '../../lib/useSettings';

/**
 * Stage 1 — વિડિયો દર્શન (§6).
 *
 * The video source is whatever the સંચાલક has put in `settings/app.youtubeUrl`, read
 * through the existing hook. No URL is invented here, and none is hardcoded: changing
 * the video is a Firestore edit, not a deploy.
 *
 * The iframe is only mounted once the yuvak asks for it. YouTube's embed pulls well
 * over a megabyte of player before a frame appears, and §24 wants the shell interactive
 * immediately — so the poster is a cheap placeholder and the player is opt-in.
 */
export default function VideoStage({ onContinue }) {
  const { settings, loading } = useSettings();
  const id = youtubeId(settings?.youtubeUrl);

  return (
    <section className="stage stage-video">
      <header className="runner-head">
        <h2>વિડિયો દર્શન</h2>
      </header>

      <p className="runner-hint">
        શાંત ચિત્તે આ વિડિયો નિહાળો. પછી દર્શન શરૂ થશે.
      </p>

      {loading ? (
        <div className="video-shell is-loading" />
      ) : id ? (
        <div className="video-shell">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}`}
            title="વર્ણી ધ્યાન વિડિયો"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        // Never a dead end: a missing link must not lock every yuvak out of the સાધના.
        <div className="notice">
          <p>વિડિયોની લિંક હજી ગોઠવાઈ નથી.</p>
          <p className="notice-sub">સંચાલક લિંક મૂકશે એટલે અહીં દેખાશે. ત્યાં સુધી દર્શન ચાલુ રાખી શકો છો.</p>
        </div>
      )}

      {id && (
        <p className="runner-hint">
          <a className="linklike" href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">
            YouTube પર ખોલો
          </a>
        </p>
      )}

      <nav className="runner-nav runner-nav-single">
        <button type="button" className="btn-gold" onClick={onContinue}>
          દર્શન શરૂ કરો
        </button>
      </nav>
    </section>
  );
}
