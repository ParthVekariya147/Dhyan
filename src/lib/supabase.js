import { lazySupabase } from '../../shared/supabase/client.js';

/**
 * The યુવક app's client. The સંચાલક panel builds its own from the same factory, so the
 * two never share a session object even though they share an origin.
 *
 * Lazy on purpose: importing this must not throw when the env vars are missing, or the
 * 2,000 yuvaks get a white page instead of a sentence telling them what happened. See
 * lazySupabase() for the whole reasoning.
 */
export const supabase = lazySupabase(import.meta.env);
