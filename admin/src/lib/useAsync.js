import { useCallback, useEffect, useRef, useState } from 'react';
import { dataError } from './errors';

/**
 * One-shot data loading with loading / error / retry, and no listener left behind.
 *
 * §83 — the panel uses plain reads, not Realtime subscriptions. A user list or an audit
 * log does not need to update itself, and a subscription per page across a handful of
 * admins is a standing cost against a free-tier budget that has to serve 2,000 yuvaks
 * (§84).
 *
 * The `alive` flag is the unsubscribe: an in-flight read whose component has unmounted
 * (or whose deps changed) must not write state.
 */
export function useAsync(fn, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, error: null, data: null });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (skip) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => alive && setState({ loading: false, error: null, data }))
      .catch((e) => alive && setState({ loading: false, error: dataError(e), data: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, skip]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}
