import { Link, useSearchParams } from 'react-router-dom';
import { useAsync } from '../../../lib/useAsync';
import { useAdminAuth } from '../../../lib/adminAuth';
import { getAppSettings, getLevelsConfig } from '../services/settingsService';
import Tabs, { TabPanel } from '../../../components/Tabs';
import { AsyncBlock, FormSkeleton } from '../../../components/StateBlocks';
import { PageHeader } from '../../../components/StatCard';
import GeneralCard from '../components/GeneralCard';
import DhunAutoplayCard from '../components/DhunAutoplayCard';
import DhunCard from '../components/DhunCard';
import DriveFolderCard from '../components/DriveFolderCard';
import GalleryCard from '../components/GalleryCard';
/* The two halves of 0042 - the icon on the home screen, and the session age that is what
   actually gets it there. See the note beside where they are mounted. */
import AppIconCard from '../components/AppIconCard';
import SessionCard from '../components/SessionCard';
/* Lives in settings['levels'] rather than settings['app'], which is why it arrives on a read
   of its own inside the Points tab. It is here because this is where a સંચાલક looks for it. */
import LeaderboardCard from '../components/LeaderboardCard';
import DailyPromptCard from '../components/DailyPromptCard';
import { APP_ICON_KEY } from '../../../../../shared/domain/appicon.js';
import { SESSION_KEY } from '../../../../../shared/domain/session.js';
import { DHUN_AUTOPLAY_KEY, SLIDESHOW_KEY } from '../../../../../shared/domain/settings.js';

/**
 * §34, §35 — application settings, in one controlled document.
 *
 * settings/app is read by every yuvak on every visit, so a careless write here is felt
 * immediately by 2,000 people. Hence: merge writes only, confirmation before saving where the
 * change is not a single reversible boolean, and an audit entry after (§41) — written by the
 * database, not from here.
 *
 * On roles (§35): saving anything on this page needs `settings.update`, which SUPER_ADMIN and
 * ADMIN hold and CONTENT_MANAGER, COORDINATOR and VIEWER do not
 * (shared/domain/permissions.js). The check that matters is the RLS policy on the settings
 * table; this page is only where it becomes visible.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this page is a tab shell and no longer a scroll
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Eight cards stood in one column here, and finding one meant knowing how far down it was.
 * That is survivable at three cards and it is not at eight, and the cards are not a list —
 * they are four distinct subjects that happen to share a database row (the app's own text, the
 * music, the Darshan surface, the installed shell) plus one that does not (points, in
 * settings['levels']). A tab is the honest shape for "these belong together and those do not".
 *
 * The strip is deliberately NOT five sidebar entries. Every one of these needs
 * `settings.read` and writes with `settings.update`, so splitting them into routes would put
 * five items in the menu carrying one permission between them, and a સંચાલક looking for "the
 * music" would have to already know which of the five it lived behind.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The tab is in the URL, and each panel owns its own read
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `?tab=dhun` means a refresh comes back where you were, the back button undoes a tab switch,
 * and a link pasted into a message opens on the card it is about — the same rule /users
 * follows.
 *
 * `settings['app']` is read once for the page because four of the six tabs render from it and
 * the header is drawn before any tab is chosen. `settings['levels']` is read *inside* the
 * Points tab instead, which is the change worth noting: it used to be fetched on every visit
 * to this page, including the overwhelming majority that came to read the maintenance message.
 * Only the tab that needs it now asks for it, and it carries its own AsyncBlock so a failure
 * to read the level configuration reports itself on the card it belongs to rather than
 * blanking the dhun beside it.
 */

/**
 * The tabs, in the order they are read: what the app says, what it plays, what it shows, what
 * it installs as, what it scores — and then the things configured elsewhere.
 *
 * `sub` is the page's own one-line description and changes with the tab, because a header that
 * described all eight cards at once described none of them.
 */
const TABS = [
  {
    id: 'general',
    label: 'General',
    sub: 'The app’s name, the maintenance shutter, and the word a ticked row carries.',
  },
  {
    id: 'dhun',
    label: 'Dhun',
    sub: 'The two dhun, and whether one of them starts by itself when a yuvak signs in.',
  },
  {
    id: 'darshan',
    label: 'Darshan',
    sub: 'Where the images come from, and how long the full-screen slideshow holds each one.',
  },
  {
    id: 'app',
    label: 'App shell',
    sub: 'The icon on a yuvak’s home screen, and the session age that gets it there.',
  },
  {
    id: 'points',
    label: 'Points',
    sub: 'What an act is worth, and who is shown ahead of whom.',
  },
  {
    id: 'more',
    label: 'Elsewhere',
    sub: 'Settings in this same collection that have a page of their own.',
  },
];

export default function SettingsPage() {
  const state = useAsync(() => getAppSettings(), []);
  const { can } = useAdminAuth();
  const [params, setParams] = useSearchParams();

  const requested = params.get('tab');
  const active = TABS.find((t) => t.id === requested) || TABS[0];

  const mayEdit = can('settings.update');

  /**
   * The address follows the tab.
   *
   * `replace: false` - a tab switch is a place you can go back from, which is the whole reason
   * this lives in the URL. The default tab drops the parameter entirely rather than writing
   * `?tab=general`: /settings and /settings?tab=general are the same screen, and only one of
   * them should ever be copied out of the address bar.
   */
  const choose = (id) => {
    const next = new URLSearchParams(params);
    if (id === TABS[0].id) next.delete('tab');
    else next.set('tab', id);
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Settings" sub={active.sub} />

      {/*
        One read-only banner for the page rather than one per card, and above the strip rather
        than inside a panel: it is true of every tab, and repeating it six times would be six
        copies of one sentence on a screen he cannot act on at all.
      */}
      {!mayEdit && (
        <div className="notice notice-warn" role="status">
          You can read every setting here, but saving needs the <strong>settings.update</strong>{' '}
          permission. The controls are shown so you can see what is in force.
        </div>
      )}

      <Tabs
        idBase="settings"
        label="Setting groups"
        tabs={TABS}
        value={active.id}
        onChange={choose}
      />

      {/*
        Only the selected panel is mounted (see TabPanel). That is what keeps the Points tab's
        query from running for a visit that never opens it, and it is also why each card
        re-seeds its form from props on mount rather than holding a draft across tab switches -
        a half-typed maintenance message that survived a trip to the Dhun tab and back would be
        the page remembering something the સંચાલક had walked away from.
      */}
      <TabPanel idBase="settings" id={active.id}>
        {active.id === 'points' ? (
          <PointsTab />
        ) : active.id === 'more' ? (
          <ElsewhereTab />
        ) : (
          <AsyncBlock state={state} onRetry={state.retry} skeleton={<FormSkeleton fields={5} />}>
            <AppRowTab id={active.id} data={state.data} onSaved={state.retry} />
          </AsyncBlock>
        )}
      </TabPanel>
    </>
  );
}

/**
 * The four tabs that render from `settings['app']`.
 *
 * One component rather than four, because they share the one thing that is awkward to share:
 * the row, its loading state and its retry. What differs between them is only which cards are
 * mounted, which is a switch and not a hierarchy.
 */
function AppRowTab({ id, data, onSaved }) {
  if (id === 'dhun') {
    return (
      <>
        {/*
          Autoplay above the uploads, and the order is the argument: this decides whether the
          files below are ever fetched at all, so a સંચાલક reading downward meets "does it
          play by itself?" before "which two tracks are they?". Reversed, the switch reads as
          a footnote to the second upload slot.

          It saves through updateAppSettings and DhunCard saves through dhunService, which is
          not an inconsistency: one writes a boolean, the other uploads an MP3 to Storage and
          then points the row at it, and merging those two paths would make both harder to
          read (§8, §11).
        */}
        <DhunAutoplayCard autoplay={data?.[DHUN_AUTOPLAY_KEY]} onSaved={onSaved} />
        <DhunCard dhun={data?.dhun} onSaved={onSaved} />
      </>
    );
  }

  if (id === 'darshan') {
    return (
      <>
        {/* Where every દ્રશ્ય's image comes from, then what the viewer does with them - the
            order a સંચાલક setting this up for the first time works in. */}
        <DriveFolderCard folderId={data?.driveFolderId} onSaved={onSaved} />
        <GalleryCard slideshow={data?.[SLIDESHOW_KEY]} onSaved={onSaved} />
      </>
    );
  }

  if (id === 'app') {
    /*
      ────────────────────────────────────────────────────────────────────
      The app shell - the mark on the home screen, and what makes it arrive
      ────────────────────────────────────────────────────────────────────

      Mounted together and in this order because they are one idea seen from two ends. An
      installed app is opened and closed for weeks without ever being *loaded*, so a phone can
      sit on June's build all summer - and AppIconCard on its own would be a control that
      reports "Saved" while two thousand home screens keep the old mark for months. SessionCard
      is what makes a load happen. The icon is the change; the session is the delivery. Reading
      them in the other order makes the second card look like a security setting nobody asked
      for.
    */
    return (
      <>
        <AppIconCard appIcon={data?.[APP_ICON_KEY]} onSaved={onSaved} />
        <SessionCard session={data?.[SESSION_KEY]} onSaved={onSaved} />
      </>
    );
  }

  return <GeneralCard settings={data} onSaved={onSaved} />;
}

/**
 * Points and the leaderboard — the same page, a different row.
 *
 * Everything in the four tabs above is `settings['app']`. These two are `settings['levels']` —
 * the row that also holds the level names and the લેવલ ૪ gate — so they arrive on their own
 * read, made here rather than at page level so it happens only when this tab is opened.
 *
 * They were on the Levels page first, on the reasoning that a setting belongs with the row it
 * lives in. That reasoning was about the database and this is a question about the panel: a
 * સંચાલક looking for "how many points is લેવલ ૩ worth" opens Settings, and a card he cannot
 * find is a card that does not exist. The row it is written into is an implementation detail
 * he has no reason to know.
 *
 * `getLevelsConfig()` hands back the level list and the લેવલ ૪ gate as well, which neither card
 * here uses — deliberate rather than wasteful. Reading the whole row through the function that
 * already exists keeps one reader of `settings['levels']` in this panel instead of two, so the
 * day a fourth key is added to that row there is one place that learns about it.
 */
function PointsTab() {
  const levelsRow = useAsync(() => getLevelsConfig(), []);

  return (
    <AsyncBlock state={levelsRow} onRetry={levelsRow.retry} skeleton={<FormSkeleton fields={4} />}>
      <>
        {/*
          ──────────────────────────────────────────────────────────────
          Points moved out, and this card is not a courtesy
          ──────────────────────────────────────────────────────────────

          A four-number card stood here and edited the same
          `settings['levels'].value.points` object that Point Management now edits. Two editors
          of one object would have been untidy; these two would have been destructive. The old
          card's save wrote `{...currentRow, points: <what the card held>}` - correctly merging
          at the *row* level, so the level list and the લેવલ ૪ gate survived, but replacing the
          `points` object wholesale. It knew four keys. The engine now stores `version`,
          `effectiveFrom`, `disabled`, `repeat` and `tick` beside them, so one save from this
          page would have silently deleted the entire rule configuration - the repeat prices,
          the તિક mode, every switched-off activity - and the only symptom would have been
          awards quietly reverting to the flat per-day rule with nothing on any screen able to
          say why.

          So the card was removed rather than taught the new keys: a second editor that has to
          be kept in step with the first is the same bug with a longer fuse. This is the
          pointer that replaces it, kept because a સંચાલક who has always found points on this
          page must not conclude the feature is gone.
        */}
        <div className="card">
          <h2 style={{ marginBottom: 0 }}>Points</h2>
          <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
            Point values, repeat rules, the Level 3 tick mode and per-test prices are now set in
            their own section, together with the ledger they pay into.
          </p>
          <Link to="/points" style={destinationLink}>Open Point Management</Link>
        </div>
        {/*
          Below the values it ranks people by, because that is the order of the decisions: what
          an act is worth comes before who is ahead of whom.
        */}
        <LeaderboardCard leaderboard={levelsRow.data?.leaderboard} onSaved={levelsRow.retry} />
        {/*
          Under the board, because it is a decision ABOUT the board: whether ક્રમાંક also asks a
          યુવક to write today down before it tells him where he stands. It reads the fourth key
          of the same row, which is the case the note above `getLevelsConfig()` anticipated —
          one reader of `settings['levels']` in this panel, so a new key is learned in one place.
        */}
        <DailyPromptCard dailyPrompt={levelsRow.data?.dailyPrompt} onSaved={levelsRow.retry} />
      </>
    </AsyncBlock>
  );
}

/**
 * Four settings of the same collection that live on four other pages.
 *
 * A tab rather than a card at the bottom of the page, now that the page has tabs: a list of
 * destinations appended under the last form was something a સંચાલક found by scrolling past
 * everything else, which is the opposite of what a signpost is for.
 */
function ElsewhereTab() {
  return (
    <div className="card">
      <h2>Configured on another page</h2>
      <p className="card-note" style={{ marginTop: 0, marginBottom: 'var(--sp-3)' }}>
        All of these are saved into the same settings collection. Each has its own validation,
        so each has its own page.
      </p>
      <ul style={linkList}>
        <li style={linkRow}>
          <Link to="/video" style={destinationLink}>Video</Link>
          <span className="hint">The YouTube link on the Entry Gate.</span>
        </li>
        <li style={linkRow}>
          <Link to="/levels" style={destinationLink}>Levels</Link>
          <span className="hint">
            Which levels are offered, what they are called, and what opens Level 4.
          </span>
        </li>
        <li style={linkRow}>
          <Link to="/navigation" style={destinationLink}>Navigation</Link>
          <span className="hint">
            The buttons at the bottom of a phone - which ones, in what order, and under what
            word.
          </span>
        </li>
        <li style={linkRow}>
          <Link to="/levels/4" style={destinationLink}>Level 4</Link>
          <span className="hint">
            The sub-levels (4.1, 4.2 …) and which Darshan each one asks for.
          </span>
        </li>
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Layout constants.
 *
 * These are the few shapes admin.css has no class for, and they are objects at module
 * scope rather than inline literals so React is not handed a fresh style object on every
 * render. Every value is a token: nothing here may invent a colour, a radius or a gap
 * (admin.css, "HOW TO USE THIS FILE").
 * ------------------------------------------------------------------------- */

const linkList = { listStyle: 'none', display: 'grid', gap: 'var(--sp-3)' };

/** Name over description, so a long Gujarati caption wraps under the link rather than
 *  pushing it out of the card. */
const linkRow = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };

/**
 * A link that is a destination on its own, given the tap floor §36 asks for.
 *
 * Measured at 22px on a touch screen — half the 44px minimum — on all five of them: the four
 * in the list above and "Open Point Management". The panel's rule is that an inline link
 * inside a sentence is exempt (WCAG 2.5.8 excludes a target "in a sentence or block of
 * text", and spacing out running prose to satisfy a floor makes the prose worse), but none
 * of these is in a sentence. The comment above the list says so itself: it was rewritten
 * away from a paragraph precisely so the destinations would be a findable list rather than
 * links buried in prose — and a list of destinations is navigation, which owes the floor.
 *
 * `inline-flex` is safe here for the reason it is not safe inside a table cell: these are
 * short names with no `text-overflow` on them, so there is no ellipsis for a flex box to
 * silently break. `align-self: start` keeps the box only as wide as the name, so the target
 * is the link and not the empty width of the card beside it.
 */
const destinationLink = {
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'start',
  minHeight: 'var(--tap)',
};
