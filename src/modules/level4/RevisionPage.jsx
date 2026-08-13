import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { L4_ACTIVITY_STATUS, markRevision, useLevel4Activity } from '../../lib/level4';
import { JOURNEY_PAGE, usePageSpec } from '../../lib/journey';
import { gu } from '../../lib/scenes';
import { useImageRetry } from '../../lib/useImageRetry';
import PageIntro from '../../components/PageIntro';
import Lightbox from '../darshan/Lightbox';
/*
  Two stylesheets, both belonging to other modules and neither modified.

  Vite ships a chunk's CSS with the chunk (see the long note in darshan.css), so a class
  defined in levels.css is simply *absent* on a route that has not imported it — and this
  route is its own lazy chunk. Importing them is therefore not a shortcut, it is the only
  way these rules exist here at all. Nothing new is declared: the shell is લેવલ ૩'s
  (`.level-wrap`, `.level-head`, `.level-locked`, `.btn-inline`) and the picture is the
  દર્શન feed's (`.feed`, `.card`, `.frame`, `.cap`, `.lb`), because this screen is exactly
  those two things put together and must not introduce a third visual language.
*/
import '../levels/levels.css';
import '../darshan/darshan.css';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — લેવલ ૪, પુનરાવર્તન (/level/4/:activityId/revision)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Show the દર્શન behind one કસોટી's numbers again, so a યુવક who could not
 *                place them all can look and then try again. The learning half of લેવલ ૪.
 *
 * Input          useLevel4Activity() — this કસોટી's full entries (image, title, વર્ણન,
 *                number) in the સંચાલક's order, plus its status.
 * Visible        Each item's master image, its વર્ણન, its number; a lightbox on tap.
 * Actions        Look. Enlarge. Go back to the કસોટી.
 * Persisted      `revision_count` only — a number the સંચાલક reads. Nothing gates on it,
 *                and a failed write is swallowed rather than allowed to block the way back.
 * Completion     None. Nothing here is finished, scored or required.
 * Next           /level/4/:activityId — ફરી કસોટી આપો, the same કસોટી, whether or not it has
 *                already been passed (0017: there is no attempt limit).
 * Previous       /level/4 — the કસોટી list (and મુખપૃષ્ઠ, in the bar).
 * Excluded       Ticks, submission, right-and-wrong, any count of what was missed, any
 *                word that reads as a correction — and a PDF, a thumbnail or a re-encode:
 *                these are the same master images the દર્શન feed renders, at the same
 *                quality, through the same pipeline (§17, §31).
 * Loading        Three dots inside the shell, with both bar links present.
 * Locked         A કસોટી not yet reached renders no images at all — showing them would
 *                hand over the answers to a કસોટી he is about to sit.
 * Empty          Items all withheld → said plainly, with લેવલ ૪ as the way on.
 * Error          One Gujarati line from src/lib/level4.js, and a way onward.
 * Source of truth  The published લેવલ ૪ configuration for which items and in what order;
 *                  the દર્શન collection for the artwork; shared/domain/journey.js for the
 *                  words.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * પુનરાવર્તન — the revision screen for one લેવલ ૪ કસોટી (§17, §18, §31, §32).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this screen is
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The કસોટી before it shows numbers and nothing else. This shows the દર્શન those numbers
 * stand for — the picture, the number, the વર્ણન — for **exactly this activity's items, in
 * the સંચાલક's order** (§26), and then offers the way back to the કસોટી. It is the answer
 * to an incomplete attempt, and it is worded as an invitation rather than a correction:
 * nothing here counts what was missed, nothing here is red, and nothing here says he
 * failed (§1 rule 4). An attempt that did not complete simply means there is more to look
 * at, and this is where you look.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * No PDF. No thumbnail. No re-encode. (§17, §31)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * "ચિત્રની ક્વોલિટી ઊંચી જ રહેવી જોઈએ" is a requirement, and every one of those three would
 * break it. The images here are the same `entry.url` the દર્શન feed renders — Google's
 * image CDN at `w1600-rj-v1` — and the enlarged view is the same `fullUrl` at `w2560`,
 * fetched by the same `<Lightbox>` component, unchanged. There is one pipeline for artwork
 * in this application and this screen is on it; it does not own a copy of anything.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §32 — an activity's worth of images without pulling them all at once
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A કસોટી can hold twenty or thirty દ્રશ્યો, and at ~130 KB apiece a naïve render would ask
 * Surat mobile data for several megabytes before painting anything. So the priority is
 * spelled out per image rather than left to the browser: the first is eager and high, the
 * second is eager and low — fetched while the first decodes, so scrolling one card down is
 * instant — and everything after it is `loading="lazy"`, which works because each src is a
 * real URL. See RevisionScene below.
 */
export default function RevisionPage() {
  const { activityId } = useParams();
  const { loading, error, activity, scenes, status, canOpen } = useLevel4Activity(activityId);
  // What this screen is for, from shared/domain/journey.js — never typed in here.
  const spec = usePageSpec(JOURNEY_PAGE.LEVEL4_REVISION);
  const [active, setActive] = useState(null);

  const open = useCallback((item) => setActive(item), []);
  const close = useCallback(() => setActive(null), []);

  if (loading) {
    return (
      <Shell>
        <div className="spinner-page"><span className="dot" /><span className="dot" /><span className="dot" /></div>
      </Shell>
    );
  }

  /*
    Every state below ends with a way onward — §1 forbids a dead end, and a screen that
    only explains why it is empty is one. The error itself arrives from src/lib/level4.js
    already in Gujarati; no Postgres text can reach here.
  */
  if (error) {
    return (
      <Shell>
        <section className="level-empty">
          <p>{error}</p>
          <Link to="/level/4" className="btn-quiet btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Shell>
    );
  }

  if (!activity) {
    // Either the configuration is not published yet, or this id is not in the one that is —
    // an old link, or a version the સંચાલક has since replaced. Same sentence for both:
    // the difference is not something a યુવક can act on differently.
    return (
      <Shell>
        <section className="level-empty">
          <p>આ કસોટી અત્યારે મળતી નથી. લેવલ ૪ પરથી ફરી પસંદ કરો.</p>
          <Link to="/level/4" className="btn-quiet btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Shell>
    );
  }

  /*
    Locked, so the દર્શન is not rendered at all.

    The server would refuse the submit anyway (§2.3 steps 1–3), and this page writes
    nothing — but showing an activity's દ્રશ્યો to a યુવક who has not reached it would hand
    him the answers to a કસોટી he is about to sit, and offering something that cannot be
    used is its own small unkindness. Solid gold and no lock language beyond the one word:
    a closed કસોટી is ahead of him, not withheld from him.
  */
  if (!canOpen) {
    return (
      <Shell>
        <section className="level-locked">
          <div className="locked-mark" aria-hidden="true">🔒</div>
          <h2>{activityTitle(activity)}</h2>
          <p className="locked-line">આ કસોટી હજુ ખૂલી નથી.</p>
          <p className="locked-sub">
            આ પહેલાંની કસોટી પૂરી થાય પછી આ આપોઆપ ખૂલશે. ક્રમ કદી તૂટતો નથી.
          </p>
          <Link to="/level/4" className="btn-gold btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Shell>
    );
  }

  if (!scenes.length) {
    // The items are all withheld or emptied — the સંચાલક's doing, and his to undo. Said
    // plainly, with no suggestion that the યુવક is looking in the wrong place.
    return (
      <Shell>
        <section className="level-empty">
          <p>આ કસોટીનાં દ્રશ્યો હમણાં તૈયાર થઈ રહ્યાં છે. થોડા વખતમાં અહીં આવશે.</p>
          <Link to="/level/4" className="btn-quiet btn-inline">લેવલ ૪ ની યાદી</Link>
        </section>
      </Shell>
    );
  }

  const done = status === L4_ACTIVITY_STATUS.COMPLETED;

  return (
    <Shell>
      <header className="level-head">
        {/* The કોડ is the સંચાલક's label, printed and never branched on. */}
        <p className="level-eyebrow">લેવલ ૪{activity.code ? ` · કસોટી ${gu(activity.code)}` : ''}</p>
        <h1>{activityTitle(activity)}</h1>

        {activity.description && <p className="level-note">{activity.description}</p>}

        {/*
          The count, and then the description.

          The count stays a line of its own because it is about *this* કસોટી and changes
          with it; what does not change — that there is nothing to tick here, that touching
          a picture enlarges it, that this is દર્શન and not a test — is the shared
          description, which also carries 'આમાં આ નથી' for the યુવક who arrives here
          expecting to be marked (§16: revision is not a penalty and is never counted as
          one).
        */}
        <p className="level-note">આ કસોટીનાં {gu(scenes.length)} દ્રશ્યો.</p>

        <PageIntro spec={spec} />

        {/*
          The only thing the previous attempt is allowed to say. Never a count of what was
          missed, never a score, never the word ખોટું (§1 rule 4) — one line of welcome for
          the યુવક who has already passed, and one line of invitation for everyone else.
        */}
        <p className="level-note">
          {done
            ? 'આ કસોટી તમે પૂરી કરી લીધી છે. દર્શન જેટલી વાર કરવાં હોય એટલી વાર કરી શકશો, અને કસોટી ફરી આપવી હોય તો એ પણ થઈ શકે.'
            : 'જેટલી વાર દર્શન કરવાં હોય એટલી વાર કરો, લીલા મનમાં રાખો. પછી ફરી કસોટી આપો.'}
        </p>
      </header>

      {/*
        The same `<main className="feed">` the દર્શન feed renders, and keyed by id for the
        same reason (§3): the printed number is the સંચાલક's to change and two દ્રશ્યો can
        briefly carry the same one, which as a key would drop a card.

        Not batched behind a sentinel as DarshanFeed is. That mechanism exists to hold back
        a hundred-odd cards; an activity is a handful, and every one of them is something
        this યુવક has just been asked to bring to mind — scrolling to the end should not
        wait on an IntersectionObserver. The per-image priorities below do the work instead.
      */}
      <main className="feed">
        {scenes.map((item, i) => (
          <RevisionScene key={item.id} item={item} rank={i} onOpen={open} />
        ))}
      </main>

      {/*
        One foot, one door, for both યુવકો on this page (0017).

        The one who has not passed is here to look before trying again — the way back to the
        કસોટી is the point of the page. The one who *has* passed may sit it again whenever he
        likes, so he gets the same door; only the line above it changes, because "ધ્યાનથી
        જોયું?" would read as unfinished business to someone who finished.

        This is the button the સંચાલક asked for after 0016 removed it: a યુવક who opens a
        completed કસોટી, looks through its દર્શન, and wants to sit it again should be able to
        do that from the bottom of the page he is already on.
      */}
      <div className="level-foot">
        <p>
          {done
            ? 'ફરી કસોટી આપવી હોય તો અહીંથી આપી શકશો - પૂરી થયેલી કસોટી પૂરી જ રહેશે.'
            : 'લીલા મનમાં બરાબર બેસી ગઈ? હવે ફરી કસોટી આપો.'}
        </p>
        {/*
          §18, §22 — the count is bumped *on the way*, not on arrival, because what it
          records is that he went and looked before trying again.

          A <Link> rather than a button with an await: the navigation must not wait on the
          round trip, and it must not be cancelled by it. `markRevision` is left in flight —
          a client-side route change tears down no fetch — and its failure is swallowed on
          purpose. `revision_count` is a number the સંચાલક reads; nothing anywhere gates on
          it, so a dropped connection must never be the reason a યુવક cannot get back to
          his કસોટી (§1: never a dead end).
        */}
        <Link
          to={`/level/4/${activityId}`}
          className="btn-gold btn-inline"
          style={{ fontFamily: 'inherit' }}
          onClick={() => { markRevision(activityId).catch(() => {}); }}
        >
          ફરી કસોટી આપો
        </Link>
      </div>

      <Lightbox item={active} onClose={close} />
    </Shell>
  );
}

/** The title is the સંચાલક's and may be empty — the screen still needs a name. */
const activityTitle = (a) => a.title || 'પુનરાવર્તન';

/**
 * મુખપૃષ્ઠ and the way back to લેવલ ૪, on every state this page can be in.
 *
 * Repeated around each branch rather than wrapped once at the top, so that the બાર is
 * present in the loading and locked states too — a screen a યુવક can reach and not leave
 * is the dead end §1 is about.
 */
function Shell({ children }) {
  return (
    <div className="level-wrap">
      <header className="level-bar">
        <Link className="linklike" to="/">મુખપૃષ્ઠ</Link>
        <Link className="linklike" to="/level/4">લેવલ ૪</Link>
      </header>
      {children}
    </div>
  );
}

/**
 * One દ્રશ્ય on the revision screen — DarshanCard's markup and behaviour, with §32's
 * priority added.
 *
 * DarshanCard itself is not reused, and the reason is one attribute: its `loading="lazy"`
 * is unconditional, which is right for a hundred-card feed reached by scrolling and wrong
 * for the first image of a short list a યુવક was just sent to look at. Everything else is
 * deliberately identical — the same `.card`/`.frame`/`.cap` classes, the same
 * IntersectionObserver reveal, the same `object-fit: contain` frame reserved by aspect
 * ratio so nothing shifts as the bytes arrive, the same single `<img src>` with no
 * `srcset` and no format negotiation.
 *
 * `rank` is the position in this activity, and it decides only how hard the browser is
 * asked to work:
 *
 *   0  eager + high — the image he is looking at.
 *   1  eager + low  — the prefetch. Requested now so it is there when he scrolls, but
 *                     behind the first one, which is the whole difference between
 *                     "prefetched" and "two images competing".
 *   ≥2 lazy         — fetched as they approach, and their layout and paint skipped
 *                     entirely while they are far away (`content-visibility`, the same
 *                     technique levels.css uses on the tick rows, applied inline because
 *                     this module owns no stylesheet of its own).
 */
function RevisionScene({ item, rank, onOpen }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const eager = rank <= 1;
  const { attempt, onError } = useImageRetry();
  /*
    The number a યુવક reads — useScenes()'s continuous ૧…N (ORDERING.md §4), the same one
    the કસોટી he has just come from printed. Emphatically **not** `rank + 1`: `rank` is a
    position in this activity and decides only how hard the browser is asked to work
    (see above). Numbering these ૧…N would tell him a દ્રશ્ય he ticked as ૩૧ is called ૧ on
    the very screen that exists to help him place it.
  */
  const n = item.displayIndex;

  return (
    <article
      className="card"
      ref={ref}
      style={
        eager
          ? undefined
          : // `auto <h>` rather than a fixed height: the browser remembers each card's real
            // size once measured, so scrolling back up lands where it did before.
            { contentVisibility: 'auto', containIntrinsicSize: 'auto 420px' }
      }
    >
      <div
        className="frame"
        onClick={() => onOpen(item)}
        role="button"
        tabIndex={0}
        aria-label={`દ્રશ્ય ${gu(n)} મોટું જુઓ`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(item);
          }
        }}
      >
        {/* Retried if the CDN refuses it — src/lib/useImageRetry.js. This screen is the one
            offered to a યુવક who did not remember enough, so a દ્રશ્ય that silently fails to
            arrive here is the one he most needed to see. */}
        <img
          key={attempt}
          src={item.url}
          alt={item.t}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={rank === 0 ? 'high' : rank === 1 ? 'low' : 'auto'}
          decoding="async"
          /* Load-bearing: lh3 throttles per referrer — see driveImageUrl in shared/domain/drive.js. */
          referrerPolicy="no-referrer"
          onError={onError}
        />
      </div>
      <div className="cap">
        <span className="txt">{item.t}</span>
        {/* Gujarati numerals (§14) — every number a યુવક reads goes through gu(), including
            the ones inside a caption. The દર્શન feed's own card now does the same, so this
            screen and the one it borrows its markup from print an identical badge. */}
        <span className="num">{gu(n)}</span>
      </div>
    </article>
  );
}
