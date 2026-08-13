/**
 * English labels for vocabulary the યુવક app must keep showing in Gujarati.
 *
 * The panel is English; src/ is Gujarati. Where a label is rendered by both apps — the
 * learning stages (src/lib/stages.js STAGE_LABEL) and the zone/subzone names
 * (shared/domain/constants.js ZONES, SUBZONES) — the shared definition cannot simply be
 * translated in place without changing what a yuvak reads. So the Gujarati stays where it
 * is and the panel keeps its own map here, admin-only, imported by nothing in src/.
 *
 * The keys are the shared ones: STAGE from src/lib/stages.js, and the `id` of each entry
 * in ZONES/SUBZONES. A new stage or subzone appears here as `undefined` and the helpers
 * fall back to the raw id, which is visible rather than blank.
 */
import { STAGE } from '../../../src/lib/stages.js';

/** Mirrors STAGE_LABEL in src/lib/stages.js, key for key. */
export const STAGE_LABEL_EN = {
  [STAGE.NOT_STARTED]: 'Not started',
  [STAGE.VIDEO_DARSHAN]: 'Video Darshan',
  [STAGE.IMAGE_LEARNING]: 'Darshan',
  [STAGE.RECOGNITION]: 'Recognition',
  [STAGE.SUBMITTED]: 'Result',
  [STAGE.PENDING_REVIEW]: 'Remaining Darshan',
  [STAGE.MEMORY_RECALL]: 'Memory Darshan',
  [STAGE.COMPLETED]: 'Complete',
};

export const stageLabelEn = (s) => STAGE_LABEL_EN[s] || s || '-';

/** Mirrors SUBZONES in shared/domain/constants.js, keyed by id. */
export const SUB_ZONE_LABEL_EN = {
  vedroad: 'Vedroad',
  varachha: 'Varachha',
  navsari: 'Navsari',
};

/** Drop-in replacement for subZoneName() from shared/domain/constants.js. */
export const subZoneNameEn = (id) => SUB_ZONE_LABEL_EN[id] || id || '-';

/** Mirrors ZONES in shared/domain/constants.js, keyed by id. */
export const ZONE_LABEL_EN = {
  surat: 'Surat',
};

export const zoneNameEn = (id) => ZONE_LABEL_EN[id] || id || '-';
