/**
 * Vercel's entry point for appointing a સંચાલક. The function is
 * netlify/functions/create-admin.js, unchanged - including the part that matters most, that
 * step 2 runs with the caller's own token so admins_guard() actually sees an auth.uid().
 *
 * The adapter forwards `authorization` verbatim, which is the header that whole design rests
 * on. Reached at /api/create-admin on both hosts; admin/src/features/users/services/adminService.js
 * calls that one path.
 */
import { handler } from '../netlify/functions/create-admin.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
