/**
 * Vercel's entry point for the mobile login. The function itself is
 * netlify/functions/login-mobile.js, unchanged and unduplicated - see server/vercel-adapter.js
 * for why the rules live there and only there.
 *
 * Reached at /api/login-mobile on both hosts: on Netlify through the redirect in netlify.toml,
 * here because Vercel routes the api/ directory by filename. src/lib/auth.jsx calls that one
 * path and does not know which host answered.
 */
import { handler } from '../netlify/functions/login-mobile.js';
import { toVercel } from '../server/vercel-adapter.js';

export default toVercel(handler);
