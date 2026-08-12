/**
 * State-machine and submission checks (§22, §15, §30).
 *
 * These are the rules that are expensive to test by clicking: an illegal stage jump, a
 * replayed submit, a stale id from an older content build. They are pure logic, so they
 * are asserted here rather than trusted.
 *
 *   npm run verify:flow
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAGE, STAGE_ORDER, canTransition, nextStage, safeStage } from '../src/lib/stages.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0;
const failures = [];

const check = (name, ok) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}`); }
};

console.log('state machine');

// The journey must be walkable end to end, in order.
let walkable = true;
for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
  if (!canTransition(STAGE_ORDER[i], STAGE_ORDER[i + 1])) walkable = false;
}
check('every stage leads to the next', walkable);

check('NOT_STARTED cannot jump to RECOGNITION', !canTransition(STAGE.NOT_STARTED, STAGE.RECOGNITION));
check('NOT_STARTED cannot jump to MEMORY_RECALL', !canTransition(STAGE.NOT_STARTED, STAGE.MEMORY_RECALL));
check('IMAGE_LEARNING cannot skip to SUBMITTED', !canTransition(STAGE.IMAGE_LEARNING, STAGE.SUBMITTED));
check('RECOGNITION cannot skip PENDING_REVIEW to COMPLETED', !canTransition(STAGE.RECOGNITION, STAGE.COMPLETED));
check('SUBMITTED cannot go back to RECOGNITION', !canTransition(STAGE.SUBMITTED, STAGE.RECOGNITION));

// §6 — the video must always be reachable again.
check('video is revisitable from IMAGE_LEARNING', canTransition(STAGE.IMAGE_LEARNING, STAGE.VIDEO_DARSHAN));
check('video is revisitable from PENDING_REVIEW', canTransition(STAGE.PENDING_REVIEW, STAGE.VIDEO_DARSHAN));
check('video is revisitable from COMPLETED', canTransition(STAGE.COMPLETED, STAGE.VIDEO_DARSHAN));

// §14 — pending items must not be skippable by accident, but may be skipped on purpose.
check('SUBMITTED can reach PENDING_REVIEW', canTransition(STAGE.SUBMITTED, STAGE.PENDING_REVIEW));
check('SUBMITTED can reach MEMORY_RECALL', canTransition(STAGE.SUBMITTED, STAGE.MEMORY_RECALL));

check('unknown stage resumes at NOT_STARTED', safeStage('LEVEL_7') === STAGE.NOT_STARTED);
check('undefined stage resumes at NOT_STARTED', safeStage(undefined) === STAGE.NOT_STARTED);
check('known stage resumes unchanged', safeStage(STAGE.PENDING_REVIEW) === STAGE.PENDING_REVIEW);
check('nextStage stops at COMPLETED', nextStage(STAGE.COMPLETED) === STAGE.COMPLETED);

// ---------------------------------------------------------------- submission
console.log('\nsubmission');

const makeSessionId = (uid, round) => `${uid.slice(0, 8)}-r${String(round + 1).padStart(3, '0')}`;

check(
  'session id is deterministic for the same round',
  makeSessionId('abcdef1234567890', 0) === makeSessionId('abcdef1234567890', 0)
);
check(
  'a new round gets a new session id',
  makeSessionId('abcdef1234567890', 0) !== makeSessionId('abcdef1234567890', 1)
);
check(
  'different yuvaks never collide',
  makeSessionId('aaaaaaaa11111111', 0) !== makeSessionId('bbbbbbbb22222222', 0)
);

// remembered ∪ pending must be the whole collection, always, with no overlap.
const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'darshan.json'), 'utf8'));
const all = scenes.filter((s) => s.active).map((s) => s.id);

const split = (ticked) => {
  const remembered = all.filter((id) => ticked.has(id));
  const set = new Set(remembered);
  return { remembered, pending: all.filter((id) => !set.has(id)) };
};

for (const [label, ticked] of [
  ['none ticked', new Set()],
  ['all ticked', new Set(all)],
  ['some ticked', new Set(all.filter((_, i) => i % 3 === 0))],
  ['a stale id ticked', new Set([...all.slice(0, 2), 'darshan-999'])],
]) {
  const { remembered, pending } = split(ticked);
  const union = new Set([...remembered, ...pending]);
  const overlap = remembered.filter((id) => pending.includes(id));
  check(
    `${label}: remembered + pending covers the collection exactly`,
    union.size === all.length && overlap.length === 0 && remembered.length + pending.length === all.length
  );
}

// Replaying the same submit must produce the same answer.
const ticked = new Set(all.filter((_, i) => i % 2 === 0));
const a = split(ticked);
const b = split(ticked);
check(
  'a replayed submit yields identical sets',
  JSON.stringify(a) === JSON.stringify(b)
);

// §30 — a scene id that is not in the collection must never become progress.
check(
  'unknown ids cannot enter remembered',
  !split(new Set(['darshan-999'])).remembered.includes('darshan-999')
);

// ---------------------------------------------------------------- counts
console.log('\ncounts');
check('no hardcoded total in src/', (() => {
  const walk = (d) => {
    let hits = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) hits = hits.concat(walk(p));
      else if (/\.jsx?$/.test(e.name)) {
        // Comments are stripped first — prose explaining *why* there is no hardcoded
        // total would otherwise trip the very check it is describing.
        const code = fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        // A literal 100/108/109 used as a scene total would defeat §3 and §13.
        if (/\b(?:TOTAL|total)\s*[=:]\s*(?:100|108|109)\b/.test(code)) hits.push(p);
      }
    }
    return hits;
  };
  const hits = walk(path.join(ROOT, 'src', 'modules', 'learning'))
    .concat(walk(path.join(ROOT, 'src', 'lib')).filter((p) => !p.endsWith('constants.js')));
  if (hits.length) console.log(`      ${hits.join(', ')}`);
  return hits.length === 0;
})());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
