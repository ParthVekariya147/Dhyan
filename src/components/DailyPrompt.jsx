import { lazy, Suspense } from 'react';
import { useDailyPromptSetting } from '../lib/dailyRecord';

/**
 * The gate in front of "આજે તમે શું કર્યું?".
 *
 * Two components rather than one, and the division is by weight — the same split
 * InstallPrompt/InstallSheet make and for the same reasons. This half reads one field of one
 * settings row and decides whether the feature exists at all. The other half carries the form,
 * the day's record, the countdown, two stylesheets and the whole of the daily-record client.
 *
 * **A project with the prompt switched off pays for one small settings read and nothing else.**
 * No chunk is fetched, `daily_record_get()` is never called from this route, and ક્રમાંક is
 * byte for byte the board it was before this feature existed. That is what makes `enabled:
 * false` a true no-op rather than a cheap one — the same standard useSessionExpiry() holds
 * itself to in src/lib/useAppShell.js.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Nothing is drawn while the switch is still arriving
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `loading` is honoured rather than treated as "off". The setting defaults to ON, so guessing
 * during the round trip would draw the button, and then either keep it or take it away — a
 * control that appears and vanishes under a thumb reaching for it. One round trip of nothing is
 * the honest state, and the board behind it is fully readable throughout.
 *
 * `fallback={null}` on the Suspense for the same reason InstallPrompt gives: this was not asked
 * for by the યુવક, so the app must not put a loading state in front of the board he WAS reading
 * while a small chunk arrives. It appears when it is ready, or not at all.
 */
const DailySheet = lazy(() => import('./DailySheet'));

/**
 * @param {object} props
 * @param {() => void} [props.onSaved]  the board is stale now — a saved day changes the ranking.
 */
export default function DailyPrompt({ onSaved }) {
  const { setting, loading } = useDailyPromptSetting();

  if (loading || !setting.enabled) return null;

  return (
    <Suspense fallback={null}>
      {/* `autoOpen` is resolved here and passed down, so the stored row is turned into a
          decision in exactly one place. resolveDailyPrompt() already reports it as false
          whenever the feature is off, so the sheet cannot be handed a combination the panel
          does not offer. */}
      <DailySheet autoOpen={setting.autoOpen} onSaved={onSaved} />
    </Suspense>
  );
}
