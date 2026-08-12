import { Link } from 'react-router-dom';
import DarshanFeed from './DarshanFeed';
import ProgressBar from '../../components/ProgressBar';
import BackToTop from '../../components/BackToTop';
import NavArrow from '../../components/NavArrow';
import PageIntro from '../../components/PageIntro';
import { gu } from '../../lib/scenes';
import { useScenes } from '../../lib/useScenes';
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લેવલ ૨, દર્શન (/darshan)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        A યુવક studies the whole દર્શન collection: picture, title, વર્ણન, number.
 *                This is the learning half of the સાધના — the memory support that લેવલ ૩
 *                and લેવલ ૪ take away again.
 *
 * Input          useScenes() — the published collection, both gates applied.
 * Visible        Every દ્રશ્ય's master image, its વર્ણન, its printed number; the count.
 * Actions        Look. Tap an image to enlarge it. Go on, or go back.
 * Persisted      Nothing. This page writes nothing at all — see the footer note.
 * Completion     None. There is nothing to finish here and nothing is recorded.
 * Next           /level/3 — લેવલ ૩, વર્ણન યાદી.
 * Previous       /welcome — લેવલ ૧, the વિડિયો.
 * Excluded       Ticks, scoring, right-and-wrong, a 'પૂરું કરો' button, a મુખપૃષ્ઠ button at
 *                the foot (it would be a third, sideways choice — see below), and **a PDF**.
 *                This level is not "PDF દર્શન" and has not been for a long time: the cards
 *                below are the master images themselves.
 * Loading        Three dots holding a full viewport, so nothing shifts when the cards land.
 * Error / empty  useScenes() degrades to an empty list; the two ways on stay on screen.
 * Source of truth  દર્શન collection for the content; shared/domain/journey.js for the
 *                  description a યુવક reads.
 *
 * ────────────────────────────────────────────────────────────────────────────
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
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL2);

  return (
    <>
      <ProgressBar />

      <header className="site-header">
        <h1>નીલકંઠ વર્ણી ધ્યાન</h1>
        <p>{loading ? ' ' : `${gu(total)} દ્રશ્યોનું ક્રમબદ્ધ દર્શન`}</p>
        <div className="rule" />
      </header>

      {/*
        What this page is for, said on the page itself.

        Above the feed and not below it: the one thing a યુવક needs told here is that there
        is nothing to tick and nothing being counted — that looking *is* લેવલ ૨ — and a
        sentence saying so after a hundred cards would be read by nobody. It renders during
        `loading` too, so the page explains itself before it has anything to show.

        The words come from shared/domain/journey.js, so this level is described in one
        place for the યુવક, the સંચાલક panel and PAGES.md alike.
      */}
      <PageIntro spec={spec} />

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
            <Link to="/welcome" className="btn-quiet btn-inline">
              <NavArrow dir="back" />વિડિયો દર્શન
            </Link>
            <Link to="/level/3" className="btn-gold btn-inline" aria-label="આગળ — લેવલ ૩">
              આગળ<NavArrow />
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
