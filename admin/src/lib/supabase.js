import { lazySupabase } from '../../../shared/supabase/client.js';

/**
 * The સંચાલક panel's client, built from the same factory as the યુવક app's.
 *
 * It carries no extra privilege. Authorisation is `public.is_admin()` inside Postgres,
 * evaluated on every policy — so a yuvak who loads this panel sees nothing, and the
 * panel needs no secret of its own (§13, §50).
 *
 * Lazy on purpose: AdminAuthProvider imports this at the top of the file and separately
 * checks isSupabaseConfigured() to raise `unconfigured`. Building the client on import
 * threw before that check could run, so the notice it feeds was unreachable.
 */
export const supabase = lazySupabase(import.meta.env);
