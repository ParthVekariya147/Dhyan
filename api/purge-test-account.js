/**
 * Vercel's entry point for finishing a test-account purge. The function is
 * netlify/functions/purge-test-account.js, unchanged.
 *
 * Note the 207 it can return - data gone, login left behind. The adapter passes any status
 * through untouched, so admin/src/features/users/services/userService.js reads the same three
 * outcomes here as on Netlify.
 */
import { handler } from '../netlify/functions/purge-test-account.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
