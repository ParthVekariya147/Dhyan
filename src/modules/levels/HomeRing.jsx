import { useAuth } from '../../lib/auth';
import { useScenes } from '../../lib/useScenes';
import { useDailyProgress } from '../../lib/progress';
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
  const { profile } = useAuth();
  const { total } = useScenes();
  const P = useDailyProgress();

  // Read from the profile, never derived here and never written — the flag is the
  // database's (0008_level4_unlock.sql). See src/lib/progress.js.
  const active = profile?.level4_unlocked ? 4 : 3;

  return (
    <ProgressRing
      score={active === 4 ? P.score4 : P.score3}
      total={total}
      label="આજની પ્રગતિ"
      sub={`લેવલ ${active === 4 ? '૪ — ફક્ત નંબર' : '૩ — વર્ણન યાદી'}`}
    />
  );
}
