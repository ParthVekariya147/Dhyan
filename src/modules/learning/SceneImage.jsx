import { useImageRetry } from '../../lib/useImageRetry';

/**
 * One scene's artwork, on a learning stage.
 *
 * One `<img src>` at a real URL (§10), never a data-URI: that is what lets the browser
 * defer offscreen work and reuse its HTTP cache across visits. The originals were
 * base64-inlined, which defeated both.
 *
 * The width and encoding live in the URL itself (see driveImageUrl), so there is nothing to
 * negotiate here and no ladder to pick from.
 */
export default function SceneImage({ scene, eager = false, className = '' }) {
  /*
    Asked for again if the request failed — Google's CDN answers 429 under load and a browser
    retries nothing on its own (src/lib/useImageRetry.js). It matters more here than in the
    feed: the runner shows ONE દ્રશ્ય at a time, so a picture that never arrives is not a gap
    in a list, it is the entire screen, with 'આગળ' as the only way past a દર્શન he never saw.

    The hook runs before the `!scene` return: hooks may not be called conditionally, and this
    component is legitimately rendered with nothing (ScenePreload at the end of a runner).
  */
  const { attempt, onError } = useImageRetry();

  if (!scene) return null;

  return (
    <img
      key={attempt}
      className={className}
      src={scene.url}
      // The વર્ણન is the accessible description (§31). It is shown on screen as well,
      // because it is not burned into the artwork — the picture alone teaches nothing.
      alt={scene.t}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      draggable={false}
      /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
      referrerPolicy="no-referrer"
      onError={onError}
    />
  );
}

/**
 * Fetches the next scene while the yuvak is still looking at the current one (§25).
 *
 * Rendered rather than requested through `new Image()` so it is the same element, with the
 * same URL, that the next stage will mount — the browser then serves that stage from cache
 * instead of starting a second request. The wrapper collapses to nothing and is hidden from
 * assistive technology.
 */
export function ScenePreload({ scene }) {
  if (!scene) return null;
  return (
    <div aria-hidden="true" className="scene-preload">
      <SceneImage scene={scene} eager />
    </div>
  );
}
