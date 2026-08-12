import DarshanFeed from './DarshanFeed';
import ProgressBar from '../../components/ProgressBar';
import BackToTop from '../../components/BackToTop';
import { gu } from '../../lib/scenes';
import { useScenes } from '../../lib/useScenes';

/**
 * Level 2 — PDF દર્શન.
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
        <DarshanFeed items={scenes} />
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
