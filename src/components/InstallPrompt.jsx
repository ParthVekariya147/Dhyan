import { lazy, Suspense, useSyncExternalStore } from 'react';
import {
  getInstallServerState,
  getInstallState,
  subscribeInstall,
} from '../lib/installPrompt';

/**
 * The gate in front of "એપ્લિકેશન ઇન્સ્ટોલ કરો".
 *
 * Two components rather than one, and the division is by weight. This half is eager
 * because it has to be: `beforeinstallprompt` is fired once, at a moment Chrome chooses,
 * and there is no way to ask for it again — so a listener has to already exist (see
 * src/lib/installPrompt.js, which attaches it at import). This file is therefore kept
 * deliberately small: a subscription, a comparison, and a lazy import.
 *
 * The other half — the sheet, its three Gujarati sentences and its stylesheet — is
 * fetched only when `mode` says there is something to offer. On the ordinary load
 * (already installed, already dismissed, or a browser that cannot install) this renders
 * null and no chunk is requested at all.
 *
 * `fallback={null}` and not a spinner: this dialog was not asked for by the યુવક, so the
 * app must not put a loading state in front of whatever he WAS doing while a 2 KB chunk
 * arrives. It appears when it is ready or not at all.
 */
const InstallSheet = lazy(() => import('./InstallSheet'));

export default function InstallPrompt() {
  const { mode } = useSyncExternalStore(
    subscribeInstall,
    getInstallState,
    getInstallServerState
  );

  if (mode === 'none') return null;

  return (
    <Suspense fallback={null}>
      <InstallSheet mode={mode} />
    </Suspense>
  );
}
