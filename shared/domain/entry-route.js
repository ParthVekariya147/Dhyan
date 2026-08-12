/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE DOES THIS YUVAK BELONG RIGHT NOW? — asked once, answered here (§10)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every route decision in the યુવક app used to be a condition inside whichever component
 * happened to be mounted: Login pushed '/', PublicOnly pushed '/', Guarded pushed
 * '/welcome', Register pushed '/welcome'. Four opinions, and they disagreed — signing in
 * as a યુવક who had not passed the પ્રવેશદ્વાર went login → '/' → '/welcome', two
 * navigations and a flash of the મુખપૃષ્ઠ he was not entitled to see (§15).
 *
 * So the decision is a pure function of what is known about the યુવક, it lives here, and
 * the components only render what it returns. Pure and in shared/domain/ for the same
 * reason everything else here is: it can be asserted in scripts/test-domain.mjs without a
 * browser, a Supabase project or a router, and the states below are then facts rather
 * than four components' guesses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module does NOT decide
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **It never decides whether a level is open.** લેવલ ૪'s gate is the published
 *   configuration's business and the server re-checks it in `level4_submit` (§37); લેવલ
 *   ૩'s threshold is `profiles.level4_unlocked`, which only a database trigger may write.
 *   Nothing here grants anything — it answers "which page should he be looking at", and
 *   every page still asks its own questions on arrival.
 * * **It never writes.** No progress is created, advanced or reset by routing (§23).
 * * **It does not know the URLs of the levels themselves.** /level/3, /level/4 and their
 *   children are reached from the મુખપૃષ્ઠ; the only routes named here are the four a
 *   યુવક can be *sent* to without having asked.
 */

/** The four states of §10, and there are exactly four. */
export const ENTRY_STATE = {
  /** No session. He has not told us who he is yet. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Signed in, but has never passed the પ્રવેશદ્વાર — લેવલ ૧ is not behind him. */
  NEW_USER: 'NEW_USER',
  /** Signed in, લેવલ ૧ done, still climbing. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Signed in and every level of §7 is open to him. */
  COMPLETED: 'COMPLETED',
};

/** The only destinations this module may name. */
export const ENTRY_ROUTE = {
  REGISTER: '/register',
  LOGIN: '/login',
  /** લેવલ ૧ — the વિડિયો and the two questions. A new યુવક's first screen (§6). */
  LEVEL1: '/welcome',
  /** The મુખપૃષ્ઠ — the dashboard, and the place a returning યુવક resumes from (§24). */
  HOME: '/',
};

/**
 * Where a returning યુવક may be put back down.
 *
 * Front doors only. A યુવક who closed the app inside a લેવલ ૪ કસોટી is NOT dropped back
 * into that કસોટી on his next login: an attempt is a thing he sits down to on purpose
 * (and, since 0016, one he may only have once), and resuming him into it would be the app
 * making that decision for him. The level's own list is as deep as a resume goes.
 *
 * /welcome is in the set because a યુવક who has passed the gate can legitimately be
 * re-watching the વિડિયો — the questions are asked once, the વિડિયો is not.
 */
export const RESUMABLE_ROUTES = new Set([
  ENTRY_ROUTE.LEVEL1,
  '/darshan',
  '/level/3',
  '/level/4',
]);

/**
 * The routes a યુવક may reach without a session. Everything else is protected (§11).
 */
export const PUBLIC_ROUTES = new Set([ENTRY_ROUTE.LOGIN, ENTRY_ROUTE.REGISTER]);

/**
 * What state is this યુવક in?
 *
 * `profileMissing` is the awkward one and it is worth naming precisely. A signed-in યુવક
 * with no `profiles` row can mean two very different things:
 *
 *   1. the row genuinely does not exist — he is mid-registration, between the auth account
 *      and the profile insert. That is a NEW_USER and લેવલ ૧ is where he belongs.
 *   2. the read failed — a dead connection, a 429. He may have three years of સાધના behind
 *      him, and answering "new user" would march him back to the વિડિયો he watched in
 *      2023 (§23: routing must never reset progress).
 *
 * They are indistinguishable from `profile == null` alone, which is why the caller passes
 * `profileError` separately. When the read failed we assume the more experienced યુવક and
 * leave him where he asked to be; the pages themselves degrade gracefully on a null
 * profile, and the next successful read corrects the answer.
 */
export function resolveEntryState({ user, profile, profileError = false } = {}) {
  if (!user) return ENTRY_STATE.UNAUTHENTICATED;

  if (!profile) {
    return profileError ? ENTRY_STATE.IN_PROGRESS : ENTRY_STATE.NEW_USER;
  }

  // લેવલ ૧ is the પ્રવેશદ્વાર, and `gate_passed_at` is the one stamp that says he is past
  // it. This is the same test App.jsx has always applied — it has only moved.
  if (!profile.gate_passed_at) return ENTRY_STATE.NEW_USER;

  // "Completed" here means the whole ladder of §7 is open to him: લેવલ ૪ is the last one
  // and `level4_unlocked` is earned, never claimed (0008's trigger writes it). It changes
  // no destination — the મુખપૃષ્ઠ is where both climbers and finishers resume — but it is
  // the honest name for the state, and the home tiles read it.
  return profile.level4_unlocked ? ENTRY_STATE.COMPLETED : ENTRY_STATE.IN_PROGRESS;
}

/**
 * The single question of §10: given everything known, which page?
 *
 * `returning` distinguishes the two doors of §4. A completely new visitor who opens the
 * application URL is shown નોંધણી — that is the first-entry experience, and asking a
 * યુવક who has never been here to find the registration link under a login form is
 * getting it exactly backwards. `returning` is set when we have positive evidence he has
 * been here before: he asked for a protected page by its URL (so he knows it exists), or
 * he asked for /login himself.
 *
 * `lastRoute` is the resume of §7/§25. It is a front door he actually stood at, recorded
 * on this device; anything unrecognised falls back to the મુખપૃષ્ઠ, so a stale or hand-
 * edited value can never send him somewhere that does not exist.
 */
export function resolveEntryRoute({
  user,
  profile,
  profileError = false,
  lastRoute = null,
  returning = false,
} = {}) {
  const state = resolveEntryState({ user, profile, profileError });

  switch (state) {
    case ENTRY_STATE.UNAUTHENTICATED:
      return returning ? ENTRY_ROUTE.LOGIN : ENTRY_ROUTE.REGISTER;

    // §6 — straight to લેવલ ૧, never to a મુખપૃષ્ઠ where he has to find it himself.
    case ENTRY_STATE.NEW_USER:
      return ENTRY_ROUTE.LEVEL1;

    default:
      return RESUMABLE_ROUTES.has(lastRoute) ? lastRoute : ENTRY_ROUTE.HOME;
  }
}

/**
 * May he see the page he asked for, and if not, where does he go instead?
 *
 * Returns `{ allow, to, state }`. `to` is meaningful only when `allow` is false, and is
 * always a route he is entitled to — so a caller can redirect to it without asking a
 * second question, and two redirects in a row are impossible by construction.
 *
 * Three rules, and nothing else is enforced here:
 *
 *   1. **No session, no protected page** (§11). Knowing a URL has never been permission.
 *      Where he is sent depends on whether he arrived at the front door or deep-linked:
 *      the root is a first visit until proven otherwise, so it opens નોંધણી; any other
 *      path was typed, bookmarked or refreshed by somebody who has been here, so it opens
 *      લોગિન. Both carry a link to the other (§19).
 *   2. **A યુવક who has not passed the પ્રવેશદ્વાર is held at લેવલ ૧** — the rule App.jsx
 *      has always enforced, unchanged (§7: preserve the existing business rule).
 *   3. **Everyone else sees what they asked for.** In particular a refresh on /level/4
 *      returns to /level/4 (§12), and no authenticated યુવક is ever shown નોંધણી or
 *      લોગિન again.
 */
export function guardRoute({ path, user, profile, profileError = false } = {}) {
  const state = resolveEntryState({ user, profile, profileError });

  if (state === ENTRY_STATE.UNAUTHENTICATED) {
    return {
      allow: false,
      state,
      to: path === ENTRY_ROUTE.HOME ? ENTRY_ROUTE.REGISTER : ENTRY_ROUTE.LOGIN,
    };
  }

  if (state === ENTRY_STATE.NEW_USER && path !== ENTRY_ROUTE.LEVEL1) {
    return { allow: false, state, to: ENTRY_ROUTE.LEVEL1 };
  }

  return { allow: true, state, to: path };
}
