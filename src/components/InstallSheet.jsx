import { useEffect, useRef } from 'react';
import { dismissInstall, promptInstall } from '../lib/installPrompt';
import { appIconLinks } from '../../shared/domain/appicon.js';
import './install-prompt.css';

/**
 * The invitation to put ધ્યાન on the home screen - the sheet itself.
 *
 * This is the lazy half of the pair. InstallPrompt.jsx is the gate: it is eager, because
 * something has to be watching when Chrome hands the event over, and it is a dozen lines
 * so that being eager costs almost nothing. Everything with weight - this markup, the
 * three Gujarati sentences, the stylesheet - is here, in a chunk that is fetched only on
 * the load where there is actually something to ask.
 *
 * The split is not cosmetic. scripts/verify-admin-separation.mjs holds the યુવક entry
 * chunk to a threshold set just above its measured size, and the entry chunk is what a
 * યુવક downloads before the લોગિન field appears. An install dialog most visitors will
 * never see has no business being in front of it (§14, slow networks).
 *
 * `mode` is passed in rather than read again here, so the gate and the sheet cannot
 * disagree about which platform this is. `icon` is passed for the same reason and it is
 * the same rule src/App.jsx states over <ReinstallNotice />: useAppIcon() is the single
 * place the setting is turned into an icon, so the tab's mark and this sheet cannot
 * disagree about which one is in force.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The mark used to be drawn here, in hand-written SVG. It must not be again.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A rounded square, a gold ring and a gold dot, written inline: a decoration that looked
 * enough like the app's icon to be taken for it, and never was it. It could not change
 * when a સંચાલક chose a new mark, because it read nothing - so the sheet that invites a
 * યુવક to put ધ્યાન on his home screen showed him one icon while the home screen was
 * about to receive another. There was no error and nothing to notice; it simply drifted
 * the moment the icon setting shipped in 0042.
 *
 * So it is an <img> of whatever `appIconLinks()` resolves - the સંચાલક's icon, or the
 * favicon the build ships when he has chosen none. Both are the real mark. Nothing about
 * the app's appearance is written twice.
 */
export default function InstallSheet({ mode, icon }) {
  const closeRef = useRef(null);

  /**
   * Escape closes it, and the "પછી" button takes focus when it opens.
   *
   * Focus goes to the dismissal rather than to "હોમ સ્ક્રીન પર ઉમેરો" deliberately. This
   * dialog appears unasked-for, and the first thing a keyboard or screen-reader user
   * meets should be the way out of it, not the action it wants. A stray Enter on arrival
   * then closes the sheet instead of opening a system install dialog he never requested.
   *
   * There is no "is it open?" condition here or below: this component is mounted only
   * while there is something to offer and unmounted the moment there is not, so being
   * rendered at all IS the open state. A second copy of that condition inside the sheet
   * would be one more thing that can disagree with the gate.
   */
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') dismissInstall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ios = mode === 'ios';

  return (
    <div className="install-scrim" onClick={dismissInstall}>
      {/*
        The click handler above closes on the backdrop; this one stops a tap INSIDE the
        card from bubbling up to it. Without the second, every press on the sheet - the
        install button included - would also count as a press on the backdrop.
      */}
      <div
        className="install-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        aria-describedby="install-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="install-head">
          <span className="install-mark" aria-hidden="true">
            {/*
              `alt=""` with the wrapper already aria-hidden: the icon carries no information
              the હેડિંગ beside it does not already give, so a screen reader should walk past
              it rather than announce the app's name twice.
            */}
            <img className="install-mark-img" src={appIconLinks(icon).icon} alt="" width="44" height="44" />
          </span>
          <div>
            <h2 className="install-title" id="install-title">
              હોમ સ્ક્રીન પર ઉમેરો
            </h2>
            <p className="install-sub">નીલકંઠ વર્ણી ધ્યાન</p>
          </div>
        </div>

        <p className="install-body" id="install-body">
          ફોનની હોમ સ્ક્રીન પર ઉમેરી લો - પછી બ્રાઉઝર ખોલ્યા વગર, એક ટેપમાં ધ્યાન શરૂ થશે.
        </p>

        {ios ? (
          <>
            {/*
              iOS has no install event and no API - Safari's share menu is the only way in,
              so here the dialog can do nothing but show him where it is. The two menu
              names are left in English on purpose: they are what iOS itself prints, and a
              translated instruction would send him looking for words that are not on his
              screen.
            */}
            <ol className="install-steps">
              <li>
                <span className="install-step-n" aria-hidden="true">
                  ૧
                </span>
                નીચેની પટ્ટીમાં શેર બટન દબાવો
              </li>
              <li>
                <span className="install-step-n" aria-hidden="true">
                  ૨
                </span>
                યાદીમાંથી "Add to Home Screen" પસંદ કરો
              </li>
              <li>
                <span className="install-step-n" aria-hidden="true">
                  ૩
                </span>
                ઉપર જમણે "Add" દબાવો
              </li>
            </ol>
            <button className="btn" type="button" ref={closeRef} onClick={dismissInstall}>
              સમજાઈ ગયું
            </button>
          </>
        ) : (
          <>
            {/*
              The button says what it does - "હોમ સ્ક્રીન પર ઉમેરો" - rather than "ઇન્સ્ટોલ કરો".
              One tap on it opens the phone's own install sheet and the icon lands on the
              home screen; nothing is downloaded from a store and there is no second screen
              of ours in between. The word "install" describes what the browser calls the
              operation, not what the યુવક gets, and what he gets is the app on his home
              screen.
            */}
            <button className="btn" type="button" onClick={promptInstall}>
              હોમ સ્ક્રીન પર ઉમેરો
            </button>
            <button
              className="btn btn-quiet"
              type="button"
              ref={closeRef}
              onClick={dismissInstall}
            >
              પછી
            </button>
          </>
        )}
      </div>
    </div>
  );
}
