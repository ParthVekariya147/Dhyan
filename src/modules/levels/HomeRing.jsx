import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
import { useLevel4Gate } from '../../lib/level4';
import ProgressRing from './ProgressRing';
import './levels.css';

/**
 * The home page's પ્રગતિ ચક્ર (§10).
 *
 * A separate component, and loaded lazily by src/pages/Home.jsx, for one reason: it needs
 * useScenes(), which pulls in `content/darshan.json` — the manifest describing every image
 * variant of every દ્રશ્ય. src/App.jsx imports Home eagerly, so importing this directly
 * would drag that manifest into the bundle a યુવક downloads before he has even signed in,
 * undoing the split that App.jsx's દર્શન and journey routes were written to preserve.
 *
 * §10: **only the active level's ring.** લેવલ ૩'s until લેવલ ૪ opens, લેવલ ૪'s after.
 * Both scores are kept in `progress` either way, so nothing is lost by not showing both —
 * a યુવક in the middle of his ધ્યાન has one number that means something to him.
 */
export default function HomeRing() {
  const { total } = useScenes();
  const P = useDailyProgress();

  /*
    Which level's ring this is, from the gate the સંચાલક published (decision #3).

    It read `profile.level4_unlocked` — 0008's fixed ૮૦ — which is no longer the same
    question. With a threshold of ૫૦ a યુવક would have લેવલ ૪ open, be working through its
    કસોટીઓ, and still be shown લેવલ ૩'s ring on the page he lands on every morning.

    Before the answer arrives the ring is લેવલ ૩'s. That is the right way to be wrong for a
    moment: લેવલ ૩ is where every day starts (§9 clears it nightly), it is open to everyone,
    and P.score3 is already on screen from localStorage — so the ring shows a real number
    immediately and refines rather than jumping from a placeholder.
  */
  const gate = useLevel4Gate();
  const active = gate.ready && gate.published && gate.gateOpen ? 4 : 3;

  return (
    <ProgressRing
      score={active === 4 ? P.score4 : P.score3}
      total={total}
      label="આજની પ્રગતિ"
      /*
        લેવલ ૪ is no longer 'ફક્ત નંબર' — that was the flat 1 → N list with 'જવાબ જુઓ', and
        it is now a ladder of કસોટીઓ the સંચાલક composes (decision #1). Named plainly here
        rather than described, because what it contains is his to change and this line is
        not re-read when he changes it.
      */
      sub={active === 4 ? 'લેવલ ૪' : 'લેવલ ૩ — વર્ણન યાદી'}
    />
  );
}
