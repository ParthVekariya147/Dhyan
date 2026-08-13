/**
 * The learning journey as one explicit state machine.
 *
 * Deliberately a single `currentStage` string rather than a bag of booleans
 * (isVideoDone / isSubmitted / showPending / …). Booleans multiply: six of them
 * describe 64 combinations, of which only seven are real, and the other 57 are bugs
 * waiting to be reached — "submitted but the video was never watched", "reviewing
 * pending items that were never calculated". One field with declared transitions
 * cannot represent those states at all.
 */

export const STAGE = {
  NOT_STARTED: 'NOT_STARTED',
  VIDEO_DARSHAN: 'VIDEO_DARSHAN',
  IMAGE_LEARNING: 'IMAGE_LEARNING',
  RECOGNITION: 'RECOGNITION',
  SUBMITTED: 'SUBMITTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  MEMORY_RECALL: 'MEMORY_RECALL',
  COMPLETED: 'COMPLETED',
};

/** Forward order of the journey. */
export const STAGE_ORDER = [
  STAGE.NOT_STARTED,
  STAGE.VIDEO_DARSHAN,
  STAGE.IMAGE_LEARNING,
  STAGE.RECOGNITION,
  STAGE.SUBMITTED,
  STAGE.PENDING_REVIEW,
  STAGE.MEMORY_RECALL,
  STAGE.COMPLETED,
];

/**
 * Allowed transitions.
 *
 * Backward edges exist only where the product asks for them: the video may be watched
 * again at any time (§6, "user must be able to watch the video again"), and a yuvak who
 * has finished may begin a fresh round. Everything else moves forward only, so no
 * screen can be reached out of order by editing a URL or replaying a stale write.
 */
const TRANSITIONS = {
  [STAGE.NOT_STARTED]: [STAGE.VIDEO_DARSHAN],
  [STAGE.VIDEO_DARSHAN]: [STAGE.IMAGE_LEARNING],
  [STAGE.IMAGE_LEARNING]: [STAGE.RECOGNITION, STAGE.VIDEO_DARSHAN],
  [STAGE.RECOGNITION]: [STAGE.SUBMITTED, STAGE.IMAGE_LEARNING, STAGE.VIDEO_DARSHAN],
  [STAGE.SUBMITTED]: [STAGE.PENDING_REVIEW, STAGE.MEMORY_RECALL],
  [STAGE.PENDING_REVIEW]: [STAGE.MEMORY_RECALL, STAGE.VIDEO_DARSHAN],
  [STAGE.MEMORY_RECALL]: [STAGE.COMPLETED, STAGE.VIDEO_DARSHAN],
  [STAGE.COMPLETED]: [STAGE.VIDEO_DARSHAN, STAGE.MEMORY_RECALL],
};

export const isStage = (s) => Object.prototype.hasOwnProperty.call(TRANSITIONS, s);

export function canTransition(from, to) {
  if (!isStage(from) || !isStage(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** The stage that normally follows — used by every "આગળ વધો" button. */
export function nextStage(from) {
  const i = STAGE_ORDER.indexOf(from);
  return i === -1 || i === STAGE_ORDER.length - 1 ? from : STAGE_ORDER[i + 1];
}

/**
 * A resumed stage is only honoured if it is a stage we recognise. An unknown value —
 * an old build's name, or a hand-edited document — resumes at the start rather than
 * dropping the yuvak into a blank screen.
 */
export function safeStage(value) {
  return isStage(value) ? value : STAGE.NOT_STARTED;
}

/** Gujarati labels, for progress indicators and headings. */
export const STAGE_LABEL = {
  [STAGE.NOT_STARTED]: 'શરૂ કરો',
  [STAGE.VIDEO_DARSHAN]: 'વિડિયો દર્શન',
  [STAGE.IMAGE_LEARNING]: 'દર્શન',
  [STAGE.RECOGNITION]: 'ઓળખ',
  [STAGE.SUBMITTED]: 'પરિણામ',
  [STAGE.PENDING_REVIEW]: 'બાકી દર્શન',
  [STAGE.MEMORY_RECALL]: 'સ્મૃતિ દર્શન',
  [STAGE.COMPLETED]: 'પૂરું થયું',
};
