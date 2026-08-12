import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { isSupabaseConfigured, supabaseConfigFromEnv } from '../../shared/supabase/client.js';
// The threshold has exactly one definition (shared/domain/constants.js) and one mirror,
// in supabase/migrations/0008's level4_unlock_threshold(). src/lib/constants.js is a
// re-export of the shared file, which is the import path the rest of src/ uses.
import { LEVEL4_UNLOCK_THRESHOLD } from './constants';
import { isISODay, msUntilISTMidnight, todayIST } from './daily';

/**
 * આજની ટિક — the day's ticks at લેવલ ૩ and લેવલ ૪ (§7, §9, §12).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The rule that shapes this entire file (§12)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * > ૨,૦૦૦ યુવક રોજ ૧૦૮ ટિક કરે તો દરરોજ લાખો વખત લખવાનું થાય.
 *
 * 2,000 × 108 = **216,000 writes a day** if a tick were a write. The original reasoning
 * was about Firebase's free quota and that quota is gone — but the sentence was never
 * really about the biller. Every one of those writes is a round trip on Surat mobile data
 * while a યુવક is trying to sit still and bring a દ્રશ્ય to mind, and a tick that has to
 * reach a server before it looks ticked is a tick that stutters on a weak signal. So:
 *
 *   1. **A tick is a localStorage write and nothing else.** Instant, offline, free.
 *   2. **The day's *score* goes to Postgres periodically and on leaving the page** — one
 *      upsert carrying `(user_id, date, level3_score, level4_score)`.
 *   3. **One યુવક = one row per day**, `on conflict (user_id, date)`. Never one per tick.
 *      That shape is not ours to choose: `public.progress`'s primary key is exactly
 *      `(user_id, date)` (0001_init.sql:46-58), and 0008's unlock trigger reads
 *      `level3_score` off it per row, so "in a single day" is only expressible because
 *      the row *is* the day.
 *   4. **A failed write loses nothing.** The phone holds the truth; the failure sits in
 *      an outbox and is retried on the next interval, on `online`, on the next visit —
 *      and even a day that ended while the app was closed is still in there waiting.
 *      §9 says the day's result is kept forever, and a dropped connection is not an
 *      exception to that.
 *
 * At a 60-second flush window a 10-minute sitting costs ~10 writes; across 2,000 યુવકો
 * that is ~20,000 a day — roughly one every four seconds for the whole zone, against
 * 216,000 for the naive version.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this module does NOT do
 * ────────────────────────────────────────────────────────────────────────────
 *
 * * **It never writes `profiles.level4_unlocked`.** That flag is earned, not claimed:
 *   0008_level4_unlock.sql derives it with an AFTER trigger on the very row written here,
 *   and `profiles_guard_level4()` corrects any client that tries to set it. This module
 *   writes the score and then *asks* for the profile again. See flush().
 * * **It counts no streaks** (§10). There is no consecutive-day anything anywhere in this
 *   file; `progress` rows are independent and 'કુલ દિવસ' is a count of rows, which can
 *   only ever go up.
 * * **It stores no scene content.** Ticks are stable scene ids (§21), so re-encoding an
 *   image or rewording a વર્ણન cannot invalidate a day.
 */

const configured = isSupabaseConfigured(supabaseConfigFromEnv(import.meta.env));

/**
 * 60 seconds.
 *
 * Long enough that a burst of ticking coalesces into one row write; short enough that a
 * browser killed outright (iOS does this) loses at most a minute of *lag*, never data —
 * the outbox below survives in localStorage and goes out on the next open. The flushes
 * that actually matter are the event-driven ones (hide, pagehide, unmount, midnight);
 * this interval is the safety net under them, not the primary mechanism.
 */
const FLUSH_INTERVAL_MS = 60_000;

/** One record per યુવક, replaced wholesale at midnight — never one key per date. */
export const dayKey = (uid) => `varni:day:${uid}`;

/**
 * Days whose score has not yet been accepted by Postgres.
 *
 * Kept separately from the tick record because the two have different lifetimes: the
 * ticks are cleared at midnight (§9) while an unflushed score must outlive that clearing,
 * or a યુવક who ticked ૯૦ at 23:50 on a dead connection would lose the whole evening at
 * 00:00. It is a map `{ 'YYYY-MM-DD': { l3, l4 } }` and in practice holds one entry —
 * two only when yesterday never got out.
 */
export const outboxKey = (uid) => `varni:day-outbox:${uid}`;

const readLocal = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, quota, or a value some other version wrote
  }
};

const writeLocal = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage denied. Postgres still receives the score on the next flush, so the day is
    // not lost — only the ability to resume it after a refresh is.
    return false;
  }
};

// ---------------------------------------------------------------- pure helpers
// Everything below is a plain function of its arguments so the day boundary, the
// tick→score derivation and the unlock check can be tested without a browser.

/** A fresh, empty day. Sets, because every row on screen asks "am I ticked?" once. */
export const emptyDay = (date) => ({ date, l3: new Set(), l4: new Set() });

const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

/**
 * Whatever localStorage handed back → a day record, or null if it is not one.
 *
 * Deliberately does not check the ids against the scene list: this module has no scene
 * list and must not acquire one (§62 — no total lives outside useScenes()). A દ્રશ્ય the
 * સંચાલક withdrew mid-day is dropped by prune() below, which is called by the level page
 * because that is where the current list actually is.
 */
export function sanitiseDay(raw) {
  if (!raw || typeof raw !== 'object' || !isISODay(raw.date)) return null;
  return { date: raw.date, l3: new Set(ids(raw.l3)), l4: new Set(ids(raw.l4)) };
}

const serialiseDay = (d) => ({ date: d.date, l3: [...d.l3], l4: [...d.l4] });

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** Whatever localStorage handed back → `{ 'YYYY-MM-DD': { l3, l4 } }`. */
export function sanitiseOutbox(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [date, v] of Object.entries(raw)) {
    if (!isISODay(date) || !v || typeof v !== 'object') continue;
    out[date] = { l3: count(v.l3), l4: count(v.l4) };
  }
  return out;
}

/**
 * The day's score, from the ticks on this phone and the row that was already there.
 *
 * `baseline` is the score Postgres held for this date when the app opened, and it acts as
 * a floor. Two cases need it, and both are real:
 *
 *   * localStorage was cleared or evicted halfway through the day (private mode, an iOS
 *     storage purge). Without a floor the next flush would *overwrite* the morning's ૫૦
 *     with the afternoon's ૩.
 *   * the યુવક picked up a second phone. Same arithmetic.
 *
 * §1 rule 4 decides this: a ધ્યાન already done is never taken away. The visible cost is
 * that on the second phone the ring can read ૫૦ with no box ticked, and the level page
 * says so in words rather than leaving him to wonder — see LevelPage's baseline note.
 *
 * The floor is latched at load and never re-read, so un-ticking on the phone that owns
 * the day behaves normally: its own baseline was ૦ that morning.
 */
export const scoreOf = (ticks, baseline = 0) => Math.max(ticks?.size ?? 0, count(baseline));

/**
 * §7 — has this day's લેવલ ૩ score opened લેવલ ૪?
 *
 * Asked here only to decide *when to flush* and when to re-read the profile. The answer
 * that counts is `profiles.level4_unlocked`, set by the trigger in 0008 on the row this
 * module writes. Nothing here ever writes that flag.
 */
export const earnsLevel4 = (level3Score) => level3Score >= LEVEL4_UNLOCK_THRESHOLD;

/** One row per (યુવક, day) — the shape §12 insists on, and `progress`'s primary key. */
export function progressRows(uid, outbox, at = new Date().toISOString()) {
  return Object.entries(outbox).map(([date, s]) => ({
    user_id: uid,
    date,
    level3_score: s.l3,
    level4_score: s.l4,
    // `progress.updated_at` defaults on insert only, so an upsert that lands as an UPDATE
    // would otherwise keep the timestamp of the first write of the day — and the
    // dashboard's "છેલ્લે ક્યારે" reads exactly this column (§11).
    updated_at: at,
  }));
}

/** Never lower a banked score by re-banking a smaller one (a partial local record). */
export function bank(outbox, date, l3, l4) {
  const prev = outbox[date];
  return {
    ...outbox,
    [date]: { l3: Math.max(count(l3), prev?.l3 ?? 0), l4: Math.max(count(l4), prev?.l4 ?? 0) },
  };
}

/**
 * The upsert, sent by hand so it can carry `keepalive`.
 *
 * supabase-js issues an ordinary `fetch`, and an ordinary fetch started while the page is
 * being torn down is cancelled with it — which is the one moment a flush matters most.
 * `keepalive: true` tells the browser to finish the request after the document is gone.
 * `navigator.sendBeacon` cannot be used instead: it sets no headers, and PostgREST needs
 * `apikey`, `Authorization` and `Prefer: resolution=merge-duplicates` to perform an upsert
 * as this યુવક. The URL is precisely what `.upsert(rows, { onConflict: 'user_id,date' })`
 * builds, so both paths hit the same policy — "own progress writable/updatable"
 * (0004_rbac.sql:602-610) — with the same row.
 *
 * The keepalive body cap is 64 KiB; these rows are ~110 bytes each and there is almost
 * never more than one.
 */
async function upsertKeepalive(rows, token) {
  const { url, key } = supabaseConfigFromEnv(import.meta.env);
  const res = await fetch(`${url}/rest/v1/progress?on_conflict=user_id%2Cdate`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`progress upsert failed: ${res.status}`);
}

// ---------------------------------------------------------------- the hook

/**
 * Mountable from anywhere that needs today's numbers — the level pages tick through it,
 * the home page only reads. Mounting it costs one row read and starts no traffic: the
 * flush timer does nothing while the outbox is empty.
 */
export function useDailyProgress() {
  const { user, session, profile, refreshProfile } = useAuth();
  const uid = user?.id ?? null;

  const [day, setDay] = useState(() => emptyDay(todayIST()));
  const [baseline, setBaseline] = useState({ l3: 0, l4: 0 });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Read from callbacks that must not be rebuilt on every tick — a flush handler whose
  // identity changed 108 times a sitting would add and remove 108 window listeners.
  const dayRef = useRef(day);
  const outboxRef = useRef({});
  const baseRef = useRef(baseline);
  const uidRef = useRef(uid);
  const tokenRef = useRef(null);
  const unlockedRef = useRef(false);
  const refreshRef = useRef(null);
  const inFlightRef = useRef(false);
  /**
   * Has the floor been read yet? Nothing may be sent before it has.
   *
   * The race this closes is small and expensive: a યુવક opens the app, ticks one દ્રશ્ય and
   * immediately backgrounds it, all before the `select` below has come back. The outbox
   * then holds `{ l3: 1 }` with no floor applied, and the flush on `visibilitychange`
   * would upsert **1 over the 50 he had already done this morning** — the precise loss
   * scoreOf()'s floor exists to prevent, arriving through the one door it did not cover.
   * Holding the flush costs a fraction of a second and the outbox survives in localStorage
   * regardless, so the worst case is a later write, never a lost one.
   */
  const floorReadyRef = useRef(false);

  uidRef.current = uid;
  tokenRef.current = session?.access_token ?? null;
  unlockedRef.current = Boolean(profile?.level4_unlocked);
  refreshRef.current = refreshProfile;

  // ---------------------------------------------------------------- flush
  const flush = useCallback(async ({ keepalive = false } = {}) => {
    const id = uidRef.current;
    if (!id || !configured) return;
    if (!floorReadyRef.current) return; // see floorReadyRef — never send an unfloored score

    const pending = outboxRef.current;
    const dates = Object.keys(pending);
    if (!dates.length) return;
    // A second flush while one is in the air would send the same row twice for no gain.
    // The keepalive path ignores this: the page is leaving and there is no "later".
    if (inFlightRef.current && !keepalive) return;

    // Snapshot what is being sent, so a tick that happens mid-flight is not silently
    // marked as written when the reply arrives.
    const sent = Object.fromEntries(dates.map((d) => [d, { ...pending[d] }]));
    const rows = progressRows(id, sent);

    inFlightRef.current = true;
    if (!keepalive) setSaving(true);
    try {
      if (keepalive && tokenRef.current) {
        await upsertKeepalive(rows, tokenRef.current);
      } else {
        const { error } = await supabase
          .from('progress')
          .upsert(rows, { onConflict: 'user_id,date' });
        if (error) throw error;
      }

      const after = { ...outboxRef.current };
      for (const d of dates) {
        if (after[d] && after[d].l3 === sent[d].l3 && after[d].l4 === sent[d].l4) delete after[d];
      }
      outboxRef.current = after;
      writeLocal(outboxKey(id), after);
      setSyncError(null);

      /*
        §7 — the level is the database's to open, so this asks rather than assumes.

        The row that just landed fires progress_unlock_level4() inside the same
        transaction (0008_level4_unlock.sql:165), which sets profiles.level4_unlocked.
        Re-reading the profile is how that reaches the screen without a reload; doing it
        only when a sent row actually qualifies, and only while the flag is still false,
        keeps it to exactly one extra read in a યુવક's lifetime.
      */
      if (!unlockedRef.current && rows.some((r) => earnsLevel4(r.level3_score))) {
        refreshRef.current?.();
      }
    } catch (err) {
      // Not a failure the યુવક has to act on, and never presented as one (§1 rule 4):
      // the ticks are on the phone, the outbox still holds the day, and the retries below
      // will get it out. `syncError` only drives a quiet reassurance line.
      setSyncError(err?.code || 'sync-failed');
    } finally {
      inFlightRef.current = false;
      if (!keepalive) setSaving(false);
    }
  }, []);

  // ---------------------------------------------------------------- commit
  /**
   * Phone first, always (§12). Postgres learns about it at the next flush.
   *
   * `stamp: false` is the midnight rollover: it replaces the tick record without banking
   * a score, because banking `{l3: 0, l4: 0}` would write a zero row for every યુવક who
   * left the app open overnight — ~2,000 pointless writes at 00:00 sharp.
   */
  const commit = useCallback(
    (next, { stamp = true } = {}) => {
      const id = uidRef.current;
      dayRef.current = next;
      setDay(next);
      if (!id) return;

      writeLocal(dayKey(id), serialiseDay(next));
      if (!stamp) return;

      const before = outboxRef.current[next.date]?.l3 ?? 0;
      const l3 = scoreOf(next.l3, baseRef.current.l3);
      const l4 = scoreOf(next.l4, baseRef.current.l4);

      const box = { ...outboxRef.current, [next.date]: { l3, l4 } };
      outboxRef.current = box;
      writeLocal(outboxKey(id), box);

      /*
        The one tick that is worth a round trip of its own: the ૮૦th.

        Everything else can wait a minute, but this is the tick that opens લેવલ ૪, and the
        opening happens in Postgres — the trigger cannot fire on a row that has not been
        sent. Waiting up to 60 seconds to tell a યુવક that the last level of the સાધના is
        now his would be a strange silence. Fires once, on the crossing, not on every tick
        above the threshold.
      */
      if (!unlockedRef.current && !earnsLevel4(before) && earnsLevel4(l3)) flush();
    },
    [flush]
  );

  // ---------------------------------------------------------------- load
  useEffect(() => {
    if (!uid) {
      const fresh = emptyDay(todayIST());
      dayRef.current = fresh;
      outboxRef.current = {};
      baseRef.current = { l3: 0, l4: 0 };
      setDay(fresh);
      setBaseline({ l3: 0, l4: 0 });
      setReady(false);
      return;
    }

    let alive = true;
    floorReadyRef.current = false;

    const today = todayIST();
    const stored = sanitiseDay(readLocal(dayKey(uid)));
    let box = sanitiseOutbox(readLocal(outboxKey(uid)));

    let start;
    if (stored && stored.date === today) {
      start = stored;
    } else {
      /*
        §9 — the app was closed across midnight (the ordinary case: he ticks in the
        evening and opens it again the next morning). The ticks clear. The day itself is
        banked first, because it may never have been flushed, and §9 is explicit that the
        result is kept forever while only the ticks are cleared.
      */
      if (stored && stored.l3.size + stored.l4.size > 0) {
        box = bank(box, stored.date, stored.l3.size, stored.l4.size);
      }
      start = emptyDay(today);
      writeLocal(dayKey(uid), serialiseDay(start));
      writeLocal(outboxKey(uid), box);
    }

    dayRef.current = start;
    outboxRef.current = box;
    baseRef.current = { l3: 0, l4: 0 };
    setDay(start);
    setBaseline({ l3: 0, l4: 0 });
    // Ready on the *local* record, not on the server read. The board is drawn from the
    // phone and must appear instantly (§14, slow networks); the floor below only ever
    // raises a number, never removes a tick.
    setReady(true);

    if (!configured) {
      // Nothing to read and nothing to send; flush() is a no-op either way.
      floorReadyRef.current = true;
      return () => { alive = false; };
    }

    // The floor, read once per (યુવક, day). See scoreOf().
    supabase
      .from('progress')
      .select('level3_score, level4_score')
      .eq('user_id', uid)
      .eq('date', today)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        // No row yet is the normal morning state, and an unreadable one must not stop the
        // day — the phone is authoritative for the ticks either way.
        const next = error || !data
          ? { l3: 0, l4: 0 }
          : { l3: count(data.level3_score), l4: count(data.level4_score) };
        baseRef.current = next;
        setBaseline(next);

        /*
          Raise anything already waiting for *today* to the floor before it is sent.

          A pending entry can predate the floor in two ways: a tick that happened in the
          moments before this reply arrived, or an entry left in localStorage by a visit
          that never got its write out. Either could be lower than the row on the server,
          and an upsert is a replacement, not a maximum. bank() takes the larger, and only
          for a date that is already pending — creating an entry here would write a row
          for every યુવક who merely opened the app.
        */
        if (outboxRef.current[today]) {
          outboxRef.current = bank(outboxRef.current, today, next.l3, next.l4);
          writeLocal(outboxKey(uid), outboxRef.current);
        }

        floorReadyRef.current = true;
        // Anything left over from a previous visit — including yesterday — goes out now.
        flush();
      });

    return () => {
      alive = false;
    };
  }, [uid, flush]);

  // ---------------------------------------------------------------- midnight (§9)
  useEffect(() => {
    if (!uid) return;

    let timer = 0;

    const rollIfNeeded = () => {
      const today = todayIST();
      if (dayRef.current.date === today) return;
      // Yesterday's score is already in the outbox (every tick stamped it), so clearing
      // the board loses nothing — but send it now rather than at the next interval, while
      // the app is demonstrably awake.
      flush();
      baseRef.current = { l3: 0, l4: 0 };
      setBaseline({ l3: 0, l4: 0 });
      commit(emptyDay(today), { stamp: false });
    };

    /*
      Re-armed each time rather than set once, and re-checked on waking.

      A phone that sleeps through midnight does not reliably run a timer that was due at
      00:00 — it may fire hours late or, on iOS, be dropped when the tab is frozen. So the
      timer is only the fast path; `visibilitychange` re-asks the question every time the
      app comes back, which is what actually clears the board for most યુવકો the next
      morning. Both funnel through the same rollIfNeeded(), which is a no-op if the date
      has not in fact moved.
    */
    const arm = () => {
      clearTimeout(timer);
      // +2s so the timer cannot land a hair before midnight and compute yesterday again.
      timer = setTimeout(() => {
        rollIfNeeded();
        arm();
      }, msUntilISTMidnight() + 2000);
    };
    arm();

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        // Leaving: §12's "when the yuvak leaves the page". `beforeunload` is unreliable on
        // mobile — Safari and Chrome for Android may never fire it — and this is the event
        // that does fire, including when the app is backgrounded rather than closed.
        flush({ keepalive: true });
        return;
      }
      rollIfNeeded();
      flush();
    };

    const onHide = () => flush({ keepalive: true });
    const onOnline = () => flush();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);

    const interval = setInterval(() => flush(), FLUSH_INTERVAL_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
      // Navigating away inside the app fires no visibility or pagehide event at all —
      // tapping મુખપૃષ્ઠ is exactly "leaving the page" for §12's purposes.
      flush();
    };
  }, [uid, flush, commit]);

  // ---------------------------------------------------------------- actions
  const toggle = useCallback(
    (level, id) => {
      const cur = dayRef.current;
      const key = level === 4 ? 'l4' : 'l3';
      const next = new Set(cur[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      commit({ ...cur, [key]: next });
    },
    [commit]
  );

  /**
   * Drop ticks for દ્રશ્યો that are no longer shown.
   *
   * The valid set comes from the caller because it comes from useScenes(), which applies
   * the સંચાલક's overlay and the content gate — a દ્રશ્ય he withdrew at noon must stop
   * counting towards the score, or the ring reads out of a collection that no longer
   * matches what is on screen (§62). Compares sizes first so it can be called from an
   * effect on every render without looping.
   */
  const prune = useCallback(
    (validIds) => {
      if (!validIds?.size) return;
      const cur = dayRef.current;
      const l3 = new Set([...cur.l3].filter((id) => validIds.has(id)));
      const l4 = new Set([...cur.l4].filter((id) => validIds.has(id)));
      if (l3.size === cur.l3.size && l4.size === cur.l4.size) return;
      commit({ ...cur, l3, l4 });
    },
    [commit]
  );

  const retry = useCallback(() => flush(), [flush]);

  return useMemo(
    () => ({
      ready,
      date: day.date,
      ticked3: day.l3,
      ticked4: day.l4,
      // Derived, never stored — the score IS the count of ticks (with the load-time floor).
      score3: scoreOf(day.l3, baseline.l3),
      score4: scoreOf(day.l4, baseline.l4),
      // How much of the day arrived before this phone did. Zero in the ordinary case; the
      // level page explains it in words when it is not, rather than showing a ring that
      // disagrees with the boxes.
      carried3: Math.max(0, baseline.l3 - day.l3.size),
      carried4: Math.max(0, baseline.l4 - day.l4.size),
      isTicked: (level, id) => (level === 4 ? day.l4 : day.l3).has(id),
      toggle,
      prune,
      saving,
      // Truthy only while a write is owed. Never rendered as an error (§1 rule 4).
      syncError,
      retry,
    }),
    [ready, day, baseline, toggle, prune, saving, syncError, retry]
  );
}
