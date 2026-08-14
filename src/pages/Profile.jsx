import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ZONES, subZoneName } from '../lib/constants';
import '../styles/forms.css';
import './profile.css';

/**
 * The ઝોન's name, in the same shape as `subZoneName()` beside it.
 *
 * There is exactly one ઝોન today (સુરત), so this looks like ceremony — and it is the same
 * ceremony `subZoneName()` already performs for the three સબઝોન: what is stored is an id
 * ('surat'), what a યુવક reads is Gujarati ('સુરત'), and the translation belongs beside the
 * list rather than inline on a page. Printing `profile.zone_id` directly would put a Latin
 * word on a Gujarati screen (§14) and would go on doing so unnoticed the day a second ઝોન
 * is added.
 *
 * Local rather than in shared/domain/constants.js because nothing else has asked for it
 * yet, and a helper with one caller is a helper that belongs next to its caller. The moment
 * the panel needs the same sentence it moves down there beside `subZoneName`.
 */
const zoneName = (id) => ZONES.find((z) => z.id === id)?.name || id || '-';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PAGE CONTRACT — મારું (/profile)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Purpose        Answer the one question the bottom bar's fourth button asks: who is this
 *                app signed in as, and how do I sign out of it. Nothing more.
 *
 * Input          useAuth() — `profile`, the યુવક's own row of `profiles`, and `isAdmin`,
 *                which is now `Boolean(effective_role())` rather than a test against a list
 *                of mobile numbers compiled into the bundle. No query of its own: every
 *                field on this screen is already in memory by the time <Guarded> lets the
 *                page render, so opening મારું costs zero requests. The role arrives on its
 *                own schedule and only decides whether one link is drawn, so the panel link
 *                may appear a moment after the rest — it is never waited for.
 * Visible        His નામ, મોબાઈલ નંબર, ઝોન and સબઝોન — plus SMK, but only for whoever has
 *                one; નોંધણી no longer asks for it (0027_smk_optional.sql). The સેટિંગ
 *                link; the લોગ આઉટ button; and, for whoever has one, the સંચાલક પેનલ link.
 * Actions        Open મારી પ્રગતિ. Open સેટિંગ. Log out. Open the panel. Nothing else.
 * Persisted      Nothing. This page does not write, and that is a decision rather than an
 *                omission — see "Excluded" below.
 * Completion     None. મારું is not a level and nothing here is finished.
 * Next           /history and /settings. મારું is otherwise a leaf: the bar is how a
 *                યુવક leaves it.
 * Previous       Whatever he was on. There is no back link, because the bar that brought
 *                him here is still on screen and carries every destination he has.
 * Excluded       Editing. Streaks, ક્રમાંક and badges — the leaderboard is still a separate
 *                task and NAV_REGISTRY marks it not built for exactly this reason, and §10
 *                forbids streaks outright. Points and days are no longer excluded from the
 *                app, but they are still excluded from *this page*: it carries a link to
 *                મારી પ્રગતિ and not one figure of its own, because a number here would be a
 *                second answer to a question that page already answers. Also excluded: the SMK
 *                and મોબાઈલ as anything but text, because a trigger in 0001_init.sql (as
 *                amended by 0027) refuses to move either — મોબાઈલ never, and SMK once it
 *                is set — and a field a યુવક can type into but not save is worse than no
 *                field.
 * Loading        Nothing blocks. <Guarded> has already waited for both the session and the
 *                profile before this component exists, so there is no in-between state to
 *                render.
 * Error / empty  A profile read that failed leaves `profile` null. The page still renders,
 *                says plainly that the details could not be fetched, and keeps લોગ આઉટ
 *                working — because a યુવક who cannot read his own row must still be able to
 *                sign out of the account he is stuck in (§1: never a dead end).
 * Source of truth  `public.profiles`, this યુવક's own row, read once by AuthProvider.
 *                  shared/domain/constants.js for what a zone id is called in Gujarati and
 *                  for which mobile numbers are સંચાલક.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this page exists at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * DEFAULT_MOBILE_NAV puts `profile` in the bar every project gets on its first load, and
 * NAV_REGISTRY marks it `ready: true` — which is a claim about src/App.jsx that had to be
 * made true. A button in the bar is not permission and never has been (§37), but it *is* a
 * promise that the path resolves, and the resolver's `ready` flag is the one thing in that
 * file no configuration may overrule. So this is the smallest honest page that keeps the
 * promise: real details, one real action, and nothing invented to fill the screen.
 */
export default function Profile() {
  const { profile, isAdmin, logout } = useAuth();

  /*
    The rows, built as data rather than as five hand-written blocks.

    Not because five blocks would be long, but because the alternative drifts: each one
    would carry its own label markup and its own em-dash-for-missing fallback, and the day
    a sixth field is added it is written slightly differently from the five above it. The
    field names are the schema's, checked against supabase/migrations/0001_init.sql —
    `smk`, `mobile`, `zone_id`, `sub_zone_id` — and not guessed from the registration form's
    camelCase props (`zoneId`, `subZoneId`), which are a different spelling of the same
    facts on the way in.

    `email` is deliberately not among them. It is on the row, but it is not something a
    યુવક is asked for on any screen after registration and printing it here would put a
    Latin string in the middle of a Gujarati card for no purpose he has.
  */
  const rows = profile
    ? [
        { label: 'નામ', value: profile.name },
        /*
          Only for whoever has one. નોંધણી stopped asking for the SMK (0027_smk_optional
          made the column nullable), so for everyone who registered after that the row
          would be a label with a dash beside it — a hole where a fact should be, on the
          one card that is meant to read as complete. The યુવક who does have an SMK still
          sees it, in the same place as before.
        */
        ...(profile.smk ? [{ label: 'SMK', value: profile.smk, mono: true }] : []),
        { label: 'મોબાઈલ નંબર', value: profile.mobile, mono: true },
        { label: 'ઝોન', value: zoneName(profile.zone_id) },
        {
          label: 'સબઝોન',
          // The same helper, over the same SUBZONES list, that the નોંધણી form's select is
          // built from - so the word he chose there is the word he reads here. One list,
          // one spelling, in shared/domain/constants.js.
          value: subZoneName(profile.sub_zone_id),
        },
      ]
    : [];

  return (
    <div className="profile-wrap">
      <header className="site-header">
        <h1>મારું</h1>
        {/*
          The name under the heading, exactly as the મુખપૃષ્ઠ does it — same element, same
          class, same styling from index.css. Two screens greeting the same યુવક in two
          different ways is the drift §2 and §20 are about.
        */}
        <p>{profile?.name}</p>
        <div className="rule" />
      </header>

      <div className="profile-inner">
        {profile ? (
          <dl className="profile-card">
            {rows.map((r) => (
              /*
                A <dl>, because that is what this is: five terms and their descriptions.
                The alternative - a stack of <div>s with two spans - looks identical and
                tells a screen reader nothing about which word belongs to which value.
              */
              <div className="profile-row" key={r.label}>
                <dt className="profile-label">{r.label}</dt>
                <dd className={r.mono ? 'profile-value is-id' : 'profile-value'}>
                  {/* Every row that reaches here is NOT NULL in the schema, and the one
                      column that is not - smk - is dropped from the list above rather
                      than dashed. So this is not really a fallback: it is what keeps a
                      row that somehow is empty from collapsing to a label with nothing
                      beside it. */}
                  {r.value || '-'}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          /*
            The read failed. Said plainly and without blame (§1 rule 4), with what to do
            next - and લોગ આઉટ below still works, which is the part that matters: this is
            the one screen a યુવક reaches when something is wrong with his account, and it
            must not be the screen that traps him.
          */
          <div className="notice warn">
            તમારી વિગત હમણાં મળી નથી. નેટ તપાસીને ફરી ખોલજો.
          </div>
        )}

        {/*
          સેટિંગ, and a <Link> rather than an <a> — which is the whole difference between
          this and the panel link below it. /settings is one of THIS app's routes, so
          react-router owns it: a plain <a> would throw the tab away, re-download the bundle,
          re-run AuthProvider's session read and land him on the same page a second and a half
          later. The panel is not one of this app's routes, which is why the link under this
          one is deliberately the other kind.

          Shown to every યુવક, not gated like the panel link: the speed it holds is his own,
          and there is nothing on the page behind it that anybody may not have.
        */}
        {/*
          મારી પ્રગતિ, and the reason it is reached from here.

          NAV_REGISTRY marks `history` ready, so a સંચાલક may put it in the bottom bar — but
          the bar holds five at most and the default four are already spent, so a યુવક whose
          સંચાલક has not added it would otherwise have no way to the page at all. મારું is
          where he already looks for his own record, and it is where સેટિંગ is reached from
          for the same reason. Above સેટિંગ because his own days are the larger thing.

          A <Link>, not an <a>, for the reason spelled out under સેટિંગ below.
        */}
        <Link to="/history" className="profile-link">
          <span className="profile-link-name">મારી પ્રગતિ</span>
          <span className="profile-link-note">રોજેરોજની નોંધ અને ગુણ</span>
        </Link>

        {/*
          આજની પ્રગતિ, immediately under મારી પ્રગતિ, and reached from here for exactly the
          reason that one is: NAV_REGISTRY holds five keys at most and the default four are
          already spent, so a page with no bar button needs a door — and મારું is where a યુવક
          already looks for his own record.

          Under and not above it, because the two are the same subject read in two directions:
          મારી પ્રગતિ is what has already happened and is the larger thing; this is today, which
          he has come to write down. A <Link> and not an <a>, for the reason spelled out under
          સેટિંગ below.
        */}
        {/* <Link to="/daily" className="profile-link">
          <span className="profile-link-name">આજની પ્રગતિ</span>
          <span className="profile-link-note">આજનો ડેટા ભરો કે સુધારો</span>
        </Link> */}

        {/*
          ક્રમાંક, under મારી પ્રગતિ and above સેટિંગ, which is the order of how much of a
          યુવક's own સાધના each one is about.

          Shown to everyone rather than hidden when the board is switched off, and that is a
          decision rather than an oversight: the page itself says plainly that it is not in use
          when the સંચાલક has not enabled it, and a link that appears and disappears depending
          on a settings row is a menu a યુવક cannot learn. The same reasoning the entry gate
          uses for a missing વિડિયો link — explain, never vanish.
        */}
      {/* <Link to="/leaderboard" className="profile-link">
        <span className="profile-link-name">ક્રમાંક</span>
        <span className="profile-link-note">સંઘમાં તમારું સ્થાન</span>
      </Link> */}

        <Link to="/settings" className="profile-link">
          <span className="profile-link-name">સેટિંગ</span>
          <span className="profile-link-note">દર્શનની આપોઆપ ગતિ</span>
        </Link>

        {/*
          The સંચાલક પેનલ is a separate application served from /admin, so this is a plain
          <a> and not a <Link>: react-router owns this app's routes and the panel is not one
          of them, so a client-side navigation would find no route and bounce home. Home.jsx
          carries the same link with the same reasoning.

          Not rendering it for a યુવક is courtesy, not security. Anyone may type the URL;
          what stops him is the panel's own guard and, behind it, the RLS policies that
          answer permission-denied to every query a non-સંચાલક makes.
        */}
        {isAdmin && (
          <a href="/admin" className="profile-link">
            <span className="profile-link-name">સંચાલક પેનલ</span>
            <span className="profile-link-note">ડેશબોર્ડ ખોલો</span>
          </a>
        )}

        {/*
          લોગ આઉટ as a real control rather than as the small underlined link the મુખપૃષ્ઠ
          uses. On the home page it is a footnote under a screen full of levels; here it is
          one of the two things the page is FOR, and a 48px button is what the app's own
          control floor says that looks like (tokens.css: --control-h). `.btn-quiet` because
          it must read as deliberate rather than as the primary thing to do on the screen.
        */}
        <button type="button" className="btn btn-quiet" onClick={logout}>
          લોગ આઉટ
        </button>
      </div>
    </div>
  );
}
