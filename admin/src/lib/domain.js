/**
 * The learning state machine, as the panel sees it.
 *
 * src/lib/stages.js is the authoritative definition — it is what the યુવક app actually
 * transitions through, and it mirrors the public.learning_stage enum in
 * supabase/migrations/0001_init.sql. §73 says not to write a second, competing copy of a
 * domain type, so the panel imports it rather than redeclaring eight stage names that
 * would drift on the first change.
 *
 * The dependency runs one way only — admin → src — and reaches a file with no React and
 * no Supabase in it, only constants and pure functions. Nothing in src/ imports anything
 * from admin/, so the યુવક bundle is untouched by this (§5, §50), and
 * scripts/verify-admin-separation.mjs checks that claim on every build.
 *
 * This barrel exists so that if stages.js later moves into shared/domain/, one import
 * path changes instead of nine.
 */
export {
  STAGE,
  STAGE_ORDER,
  isStage,
  safeStage,
  nextStage,
} from '../../../src/lib/stages.js';

/**
 * STAGE_LABEL is the one export that does *not* come from src/lib/stages.js. The stage
 * names there are what a યુવક reads and stay Gujarati; the panel is English, so the same
 * keys are relabelled in ./labels.js and re-exported under the same name — consumer pages
 * import STAGE_LABEL from this barrel exactly as before.
 */
export { STAGE_LABEL_EN as STAGE_LABEL } from './labels.js';
