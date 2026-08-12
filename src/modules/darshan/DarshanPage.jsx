import { Link } from 'react-router-dom';
import DarshanFeed from './DarshanFeed';
import ProgressBar from '../../components/ProgressBar';
import BackToTop from '../../components/BackToTop';
import { gu } from '../../lib/scenes';
import { useScenes } from '../../lib/useScenes';

/**
 * Level 2 — દર્શન.
 *
 * Not "PDF દર્શન" any more, here or on the home page (shared/domain/settings.js). Nothing
 * on this route has been a PDF for a long time: every card below is the master image
 * itself, served straight from Google's image CDN, and naming the level after a file
 * format it does not use only described the app to itself.
 *
 * Both the count and the feed come from `useScenes`, never from a typed-in number. The
 * header used to read a literal ૧૦૦ over a feed built from the raw manifest, so it went
 * on claiming ૧૦૦ whatever the Drive folder and the સંચાલક's sheet actually produced, and
 * a scene the સંચાલક had withheld was shown anyway.
 *
 * `useScenes` applies both gates — finalised in the content (master image + વર્ણન), and
 * not withheld by the સંચાલક — so what is counted here is exactly what is shown below it.
 */
export default function DarshanPage() {
  const { scenes, total, loading } = useScenes();

  return (
    <>
      <ProgressBar />

      <header className="site-header">
        <h1>નીલકંઠ વર્ણી ધ્યાન</h1>
        <p>{loading ? ' ' : `${gu(total)} દ્રશ્યોનું ક્રમબદ્ધ દર્શન`}</p>
        <div className="rule" />
      </header>

      {/*
        The feed waits for the overlay rather than rendering the manifest and pulling
        scenes back out. A યુવક seeing a દર્શન appear and then vanish would be the one
        thing §1 forbids; a moment of the same three dots he already sees between batches
        is not.

        The placeholder reserves a full viewport. Without it the footer sits directly
        under the header while loading and is shoved down when the cards arrive — a
        layout shift the delivery suite measures and fails on (§14). Holding the height
        keeps CLS at zero.
      */}
      {loading ? (
        <div className="sentinel" style={{ minHeight: '100vh' }}>
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      ) : (
        <>
          <DarshanFeed items={scenes} />

          {/*
            The end of the દર્શન, and the two ways on from it — exactly two, and nothing else.

            Why only two: the ladder of §7 runs ૧ → ૨ → ૩, so the bottom of લેવલ ૨ has one
            step forward (લેવલ ૩) and one step back to the thing લેવલ ૨ builds on (the
            વિડિયો of લેવલ ૧, which /welcome replays for a યુવક who has already passed the
            પ્રવેશદ્વાર). A 'મુખપૃષ્ઠ' button here would be a third, sideways choice at the one
            moment the app should be pointing forward — and the browser's back button and
            the home page's own tiles already cover it. There is no 'પૂરું કરો' either: §9,
            same as લેવલ ૩ — દર્શન records nothing, so there is nothing to submit.

            Both are plain <Link>s and neither writes anything. That is the requirement, not
            an omission: a યુવક who goes back to the વિડિયો must find today's લેવલ ૩ ticks
            exactly as he left them, so this page must not touch `progress` on the way out.

            **Rendered outside DarshanFeed, and never gated on the feed being finished.**
            The feed mounts scenes ten at a time behind an IntersectionObserver sentinel
            (DarshanFeed.jsx). Had these buttons lived after that sentinel's `done` check,
            they would exist only once every batch had mounted — and a યુવક on a network
            slow enough that a batch never resolves, or with the observer starved by a
            background tab, would reach the bottom of the page and find no way on at all.
            That is the dead end §1 forbids. Here they are in the DOM from the first paint
            after loading, below the feed, whatever the feed is doing above them.
          */}
          <nav className="darshan-actions" aria-label="આગળ શું">
            <Link to="/welcome" className="btn-quiet btn-inline">વિડિયો દર્શન</Link>
            <Link to="/level/3" className="btn-gold btn-inline" aria-label="આગળ — લેવલ ૩">
              આગળ
            </Link>
          </nav>
        </>
      )}

      <footer>
        ચિત્રો: © Swaminarayan Temple Karelibaug-Vadodara &amp; Kundaldham
        <br />
        જય સ્વામિનારાયણ 🙏
      </footer>

      <BackToTop />
    </>
  );
}
