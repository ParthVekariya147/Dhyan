import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ask for a દ્રશ્ય's picture again when the request failed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What goes wrong without this
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every દ્રશ્ય is served by Google's image CDN (shared/domain/drive.js — lh3.googleusercontent
 * .com), and lh3 answers **429 Too Many Requests** when a client asks for too much of it too
 * quickly. It is not an error about the file: the same URL, asked for a second later, returns
 * the picture. But nothing in a browser retries a failed `<img>`. The element fires `error`
 * once and stays empty for as long as the page is open — so a moment of throttling on a
 * scroll through ૧૦૯ દર્શન leaves a યુવક with a blank frame under a વર્ણન, on the level whose
 * entire purpose is looking at the picture, with nothing to tap and no way to ask again.
 *
 * That is the dead end §1 forbids, and it is invisible to whoever is testing: it needs a slow
 * connection or a fast scroll to reproduce, and it fixes itself on reload.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why the delays are jittered, which is the part that actually matters
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A 429 is almost never suffered alone. The દર્શન feed mounts ten cards at a time, so ten
 * images are requested together and the throttle takes several of them at once. If each one
 * retried after exactly the same delay, all of them would arrive at lh3 together a second
 * later — the identical burst that was refused the first time, re-sent. The randomised
 * spread is what turns a simultaneous retry into a sequence lh3 will serve.
 *
 * Backoff doubles, and stops. Three attempts over roughly two seconds covers throttling and
 * a dropped connection; past that the cause is not transient — a દ્રશ્ય withdrawn from Drive,
 * a folder unshared — and retrying forever would be a phone quietly hammering a URL that is
 * never going to answer, on mobile data, for as long as the page stays open.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * How a caller uses it
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   const { attempt, onError } = useImageRetry();
 *   <img key={attempt} src={url} onError={onError} … />
 *
 * `key` and not a changed `src`: the URL must stay exactly what shared/domain/drive.js built,
 * because a cache-busting parameter bolted onto an lh3 URL is a different URL — it defeats
 * the browser cache the whole image strategy depends on (§25), and it asks Google for a
 * variant nobody has verified it serves. Changing the key remounts the element, which is a
 * fresh request for the same address. A failed response is not cached, so it genuinely goes
 * back to the network.
 */
export function useImageRetry({ max = 3, baseDelay = 700 } = {}) {
  const [attempt, setAttempt] = useState(0);
  /* The count is held in a ref as well as in state because `onError` has to read it to
     decide whether to schedule anything, and it is called from an event handler that may
     fire several times before React has re-rendered with the new value. */
  const attempts = useRef(0);
  const timer = useRef(null);

  // A card scrolled past mid-backoff must not wake up and request anything.
  useEffect(() => () => clearTimeout(timer.current), []);

  const onError = useCallback(() => {
    if (attempts.current >= max) return;
    const next = (attempts.current += 1);
    const delay = baseDelay * 2 ** (next - 1);
    clearTimeout(timer.current);
    // ±25%, so ten images throttled together do not re-arrive together.
    timer.current = setTimeout(() => setAttempt(next), delay * (0.75 + Math.random() * 0.5));
  }, [max, baseDelay]);

  return { attempt, onError };
}
