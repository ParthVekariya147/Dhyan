import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { shouldOfferReinstall } from '../../shared/domain/appicon.js';
import './install-prompt.css';

/**
 * "નવો આઇકન આવ્યો છે" - the one thing the app can do about an iPhone's home screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists at all, when nothing like it exists for Android
 * ────────────────────────────────────────────────────────────────────────────
 *
 * iOS reads `apple-touch-icon` exactly once: at the moment "Add to Home Screen" is tapped. It
 * copies the bitmap into SpringBoard and never looks at the page again. There is no API, no
 * manifest field, no cache header and no service-worker trick that revises it afterwards -
 * shared/domain/appicon.js states this at length and it is worth restating here, because this
 * component looks like something that could be replaced by better code and cannot be. The
 * icon on that home screen is genuinely unreachable. The only route to a new one is removing
 * the app and adding it again, and that is an act only the person holding the phone can
 * perform.
 *
 * Android is the opposite case and gets nothing, deliberately. Chrome re-fetches the manifest
 * netlify/functions/manifest.js serves roughly once a day, sees an icon that differs from the
 * installed WebAPK's, and has Play Services mint a new one - it lands within a day or two with
 * nobody asked to do anything. Showing this sheet there would be instructing a યુવક to delete
 * and reinstall his app to fix something that was already fixing itself, which is worse than
 * saying nothing: it spends trust on a chore that had no purpose.
 *
 * So both conditions have to hold - iPhone, and already installed - and the second one is the
 * subtler of the two. Somebody reading this in Safari has not copied any bitmap into
 * SpringBoard yet; useAppIcon() has already rewritten the link he WILL copy, so he needs no
 * instructions and the sheet would be describing a problem he does not have.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Once per icon, not once per open
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `varni.appicon.seen` holds the version this phone was last told about, and
 * shouldOfferReinstall() compares it with the version in force. A counter rather than a
 * timestamp, for the reason that function's own note sets out: phone clocks disagree with each
 * other and with the machine the સંચાલક uploaded from, and a comparison between two of them
 * produces a notice that either never appears or never stops.
 *
 * A stored value that is absent, unreadable or from the future all fall the same way - show it
 * - because the failure this exists to prevent is a સંઘ looking at last year's mark and nobody
 * knowing why.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it borrows install-prompt.css rather than bringing its own
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This and InstallSheet are the same object: a bottom-anchored sheet about the home screen,
 * with a heading, a sentence, three numbered steps and a way out. A second stylesheet saying
 * that again in different pixels is two descriptions of one thing, and they drift - the app
 * would end up with two sheets that are almost the same, which reads as a mistake rather than
 * as a family.
 *
 * They can never be on screen together, which is what makes sharing a z-index safe: the
 * install invitation computes `mode: 'none'` for anybody already installed
 * (src/lib/installPrompt.js), and "already installed" is a precondition of this one.
 */

/** Which icon version this phone has already been told about. */
const APP_ICON_SEEN_KEY = 'varni.appicon.seen';

/**
 * An iPhone or an iPad, including an iPad that reports itself as a Mac.
 *
 * The second test is not paranoia. Since iPadOS 13 Safari sends a desktop user-agent by
 * default, so a `/ipad/` match alone misses every modern iPad - and an iPad is a device this
 * app is genuinely added to a home screen on. `MacIntel` plus a touch screen is the accepted
 * way to tell one from an actual Mac, which reports `maxTouchPoints: 0`.
 */
function isApplePhone() {
  try {
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/**
 * Is this a launched app rather than a browser tab?
 *
 * Two readings because neither covers iOS and everything else at once: `navigator.standalone`
 * is Safari's own and is the only one that answers on an iPhone, and the display-mode query is
 * the standard one. Both are consulted rather than only the Apple one, so that a future iOS
 * that implements display-mode does not silently turn this off.
 */
function isInstalled() {
  try {
    if (navigator.standalone === true) return true;
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  } catch {
    return false;
  }
}

/**
 * `NaN` for "this phone has not been told about any icon", which shouldOfferReinstall() reads
 * as older than anything. Private mode - where localStorage throws on read - falls there too,
 * and the consequence is honest: a phone that cannot remember a dismissal is shown the notice
 * again on the next open. That is the right direction. The alternative, treating an unreadable
 * store as "already seen", hides the notice permanently on exactly the handsets least likely
 * to have been reinstalled.
 */
function readSeen() {
  try {
    const raw = localStorage.getItem(APP_ICON_SEEN_KEY);
    return raw === null ? NaN : Number(raw);
  } catch {
    return NaN;
  }
}

export default function ReinstallNotice({ icon }) {
  const auth = useAuth();
  const closeRef = useRef(null);

  /**
   * Both platform readings are taken once, at mount, and never again.
   *
   * `navigator.standalone` does not change for the life of a document, and re-reading it on
   * every render would be an invitation for a media query to answer differently mid-session -
   * an iPad in Split View has been known to - which would make the sheet appear and vanish
   * under a thumb.
   */
  const [eligible] = useState(() => isApplePhone() && isInstalled());
  const [seen, setSeen] = useState(readSeen);

  const version = icon?.version ?? 0;
  const open = eligible && Boolean(auth?.user) && !auth?.loading
    && shouldOfferReinstall({ version, seen });

  /**
   * Remember this version, and close.
   *
   * The write happens before the state change so that a dismissal survives a phone that is
   * closed in the same instant. A storage failure is swallowed and the local state still
   * closes the sheet: he asked for it to go away, and it goes away for this session at least.
   */
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(APP_ICON_SEEN_KEY, String(version));
    } catch {
      /* private mode; the notice returns on the next open. See readSeen(). */
    }
    setSeen(version);
  }, [version]);

  /**
   * Escape closes it, and the "સમજાયું" button takes focus when it opens.
   *
   * The same two rules InstallSheet follows, and for the same reason: this dialog appears
   * unasked-for, so the first thing a keyboard or screen-reader user meets should be the way
   * out of it rather than anything it wants from him.
   */
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div className="install-scrim" onClick={dismiss}>
      {/*
        The handler above closes on the backdrop; this one stops a tap INSIDE the card from
        bubbling up to it, or every press on the sheet would also count as a press on the way
        out of it.
      */}
      <div
        className="install-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reinstall-title"
        aria-describedby="reinstall-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="install-title" id="reinstall-title">
          નવો આઇકન આવ્યો છે
        </h2>

        <p className="install-body" id="reinstall-body">
          તમારા આઇફોનની હોમ સ્ક્રીન પરનો જૂનો આઇકન આપોઆપ બદલાશે નહીં. નવો આઇકન જોવા માટે એપ કાઢીને ફરી ઉમેરો.
        </p>

        {/*
          "Remove App", "Safari", "Share" and "Add to Home Screen" are left in English on
          purpose - they are the words iOS itself prints on the screen he is looking at, and a
          translated instruction would send him hunting for a phrase that is not there. The
          same decision InstallSheet's iOS steps make.
        */}
        <ol className="install-steps">
          <li>
            <span className="install-step-n" aria-hidden="true">
              ૧
            </span>
            હોમ સ્ક્રીન પરના આઇકનને દબાવી રાખો અને Remove App પસંદ કરો
          </li>
          <li>
            <span className="install-step-n" aria-hidden="true">
              ૨
            </span>
            Safari માં આ પાનું ખોલો
          </li>
          <li>
            <span className="install-step-n" aria-hidden="true">
              ૩
            </span>
            Share દબાવીને Add to Home Screen પસંદ કરો
          </li>
        </ol>

        <button className="btn" type="button" ref={closeRef} onClick={dismiss}>
          સમજાયું
        </button>
      </div>
    </div>
  );
}
