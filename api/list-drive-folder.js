/**
 * Vercel's entry point for the Drive folder listing. The function is
 * netlify/functions/list-drive-folder.js, unchanged.
 *
 * This is the one endpoint the panel calls at its literal Netlify path -
 * `/.netlify/functions/list-drive-folder`, hard-coded in
 * admin/src/features/darshan/services/importService.js with a comment explaining that it
 * deliberately does not use an /api alias. That path means nothing to Vercel, so vercel.json
 * rewrites it here. The client is not touched: it calls one URL and both hosts answer it.
 */
import { handler } from '../netlify/functions/list-drive-folder.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
