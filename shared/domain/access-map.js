/**
 * The panel, page by page, and what each permission lets a person *do* on it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `public.permissions` is the catalogue and it is organised the way a database wants:
 * `resource.verb`, grouped by resource. That is the right shape for a policy — every RLS
 * expression in the schema names one of those strings — and it is the wrong shape for the
 * person deciding who may do what.
 *
 * Nobody thinks "should he hold points.ledger.read". They think "should he be able to open
 * the Point Ledger, and should he only be able to look at it". A screen that asks the first
 * question makes the person translate it into the second in his head, every time, for
 * forty-six permissions — and a translation done in somebody's head is one that will be got
 * wrong, silently, in the direction of granting too much.
 *
 * So this maps the catalogue onto the panel: one entry per page a person can open, the
 * permission that opens it, and every action that page offers with the permission behind it.
 * The role editor and the effective-access screen are built from this rather than from the
 * bare catalogue.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * It is a presentation of the model, never a second model
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every `key` below is a permission that exists in `public.permissions` and is enforced by a
 * policy or a SECURITY DEFINER function. This file invents nothing, grants nothing and is
 * checked by nobody at runtime — it decides how checkboxes are grouped and labelled, and that
 * is all. The security boundary is `has_permission()`, exactly as it was.
 *
 * Two properties are asserted by `scripts/test-permission-catalogue.mjs`, and both matter:
 *
 *   · **Every permission in the catalogue appears here exactly once.** If one were missing,
 *     the page-wise editor would be unable to grant it and it would become invisible — a
 *     permission that exists, is enforced, and cannot be given to anybody. If one appeared
 *     twice, two checkboxes would fight over the same row.
 *   · **Nothing here names a permission the catalogue does not have.** Otherwise the editor
 *     offers a tick box that writes a row the foreign key refuses.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * View and everything else
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `view` is the single permission that decides whether the page opens at all — the same string
 * AdminShell's NAV uses for that entry, so the sidebar and this table cannot disagree about
 * what a section needs.
 *
 * `actions` is everything the page can *do*, each with its own permission. They are not
 * collapsed into one "Edit" tick, because most of these pages offer several genuinely
 * different writes: on દર્શન, editing a વર્ણન and replacing an image that two thousand phones
 * will see are not the same act, and a single Edit column would have to either grant both or
 * hide the difference. Where a page really does have one write, the row renders as
 * "View / Edit" on its own.
 *
 * An action without `view` is meaningless — you cannot press a button on a page you cannot
 * open — so the editor ticks `view` automatically with the first action, and unticking `view`
 * clears the row. That is a UI convenience and not a rule: the database would happily hold
 * `users.update` without `users.read`, and it would be an access nobody could use.
 */

/** `kind` decides emphasis in the editor. 'danger' is destructive or irreversible. */
export const PAGES = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    to: '/dashboard',
    what: 'Counts and totals for the whole સંઘ.',
    view: 'users.read',
    actions: [],
  },
  {
    id: 'users',
    label: 'Users',
    to: '/users',
    what: 'The યુવક list - name, SMK, mobile, email, zone.',
    view: 'users.read',
    actions: [
      /*
        First, and `kind: 'view'`, because it takes nothing away and adds no power — it decides
        whether a column is printed. It sits on Users rather than on each of the seven pages
        that show the column, because it is one answer about one field and seven ticks that
        must all agree is a way of getting them out of step.
      */
      {
        key: 'users.smk.read',
        label: 'See SMK numbers in lists',
        kind: 'view',
        note: 'Applies to every list and export that has an SMK column. One person opened on his own page still shows his - that is a deliberate lookup, not bulk exposure.',
      },
      { key: 'users.update', label: 'Edit a યુવક', kind: 'edit' },
      { key: 'users.disable', label: 'Suspend or disable an account', kind: 'edit' },
      { key: 'users.export', label: 'Download the list as Excel', kind: 'edit' },
      {
        key: 'users.test',
        label: 'Mark an account as a test account',
        kind: 'danger',
        note: 'A test account still earns points and appears in no total, ranking or export.',
      },
      {
        key: 'users.purge',
        label: 'Delete a test account',
        kind: 'danger',
        note: 'The only deletion of a person this application allows anywhere.',
      },
    ],
  },
  {
    id: 'progress',
    label: 'Progress',
    to: '/progress',
    what: 'How far each યુવક has reached across the four levels.',
    view: 'progress.read',
    actions: [
      { key: 'progress.detail.read', label: 'Open one યુવક in full', kind: 'view' },
      { key: 'progress.export', label: 'Download the report as Excel', kind: 'edit' },
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions',
    to: '/sessions',
    what: 'The learning-session records.',
    view: 'sessions.read',
    actions: [],
  },
  {
    id: 'darshan',
    label: 'Darshan',
    to: '/darshan',
    what: 'The ૧૦૮ દ્રશ્યો - their order, numbering, વર્ણન and images.',
    view: 'darshan.read',
    actions: [
      { key: 'darshan.update', label: 'Edit a દ્રશ્ય (title, વર્ણન, number)', kind: 'edit' },
      { key: 'darshan.create', label: 'Add a new દ્રશ્ય', kind: 'edit' },
      { key: 'darshan.disable', label: 'Publish or withdraw a દ્રશ્ય', kind: 'edit' },
      {
        key: 'darshan.image.replace',
        label: 'Replace a દ્રશ્ય image',
        kind: 'danger',
        note: 'Irreversible from the panel, and every installed phone will see it.',
      },
      {
        key: 'darshan.reorder',
        label: 'Change the order of the collection',
        kind: 'danger',
        note: 'Changes what every યુવક is shown next.',
      },
      { key: 'darshan.import', label: 'Bulk import from the spreadsheet', kind: 'danger' },
    ],
  },
  {
    id: 'points',
    label: 'Point Management',
    to: '/points',
    what: 'What each activity is worth, the pace, and the bonus rules.',
    view: 'points.read',
    actions: [
      {
        key: 'points.config.update',
        label: 'Change what points are worth',
        kind: 'danger',
        note: 'Reprices the system for every યુવક at once.',
      },
      { key: 'points.bonus.update', label: 'Create and edit bonus rules', kind: 'edit' },
      {
        key: 'points.adjust',
        label: 'Award or remove points by hand',
        kind: 'danger',
        note: 'Applies to one named યુવક and is recorded in the ledger under your name.',
      },
    ],
  },
  {
    id: 'ledger',
    label: 'Point Ledger',
    to: '/points/ledger',
    what: 'Every point transaction, per યુવક, with the rule that produced it.',
    view: 'points.ledger.read',
    actions: [],
  },
  {
    id: 'daily',
    label: 'Daily Activity',
    to: '/points/daily',
    what: 'What the app observed each યુવક doing, day by day.',
    view: 'points.daily.read',
    actions: [],
  },
  {
    id: 'records',
    label: 'Daily Records',
    to: '/points/records',
    what: 'What each યુવક wrote down himself, day by day.',
    view: 'points.records.read',
    actions: [],
  },
  {
    id: 'level3',
    label: 'Level 3 Report',
    to: '/points/level3',
    what: 'Who has done how much પુનરાવર્તન, and who has done none.',
    view: 'points.level3.read',
    actions: [],
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    to: '/points/leaderboard',
    what: 'The ranking as the યુવકો see it.',
    view: 'points.leaderboard.read',
    actions: [],
  },
  {
    id: 'levels',
    label: 'Level',
    to: '/levels',
    what: 'How the four levels are configured, and the લેવલ ૪ gate.',
    view: 'levels.read',
    actions: [{ key: 'levels.update', label: 'Change the level configuration', kind: 'edit' }],
  },
  {
    id: 'level4',
    label: 'Level 4',
    to: '/levels/4',
    what: 'Which દર્શન and activities each લેવલ ૪ sub-level is made of.',
    view: 'level4.read',
    actions: [{ key: 'level4.update', label: 'Build and publish લેવલ ૪', kind: 'edit' }],
  },
  {
    id: 'video',
    label: 'Video',
    to: '/video',
    what: 'The YouTube video shown in the યુવક app.',
    view: 'settings.read',
    actions: [{ key: 'video.update', label: 'Change the video', kind: 'edit' }],
  },
  {
    id: 'navigation',
    label: 'Navigation',
    to: '/navigation',
    what: 'The buttons along the bottom of the યુવક app.',
    view: 'settings.read',
    actions: [{ key: 'navigation.update', label: 'Change the bottom bar', kind: 'edit' }],
  },
  {
    id: 'settings',
    label: 'Settings',
    to: '/settings',
    what: 'The app icon, the ધૂન, the gallery and the session length.',
    view: 'settings.read',
    actions: [
      {
        key: 'settings.update',
        label: 'Save any app setting',
        kind: 'danger',
        note: 'Holding this is equivalent to holding every setting permission, including the three below and the point engine.',
      },
      { key: 'appicon.update', label: 'Change the app icon', kind: 'edit' },
      { key: 'dhun.update', label: 'Replace the ધૂન audio', kind: 'edit' },
    ],
  },
  {
    id: 'access',
    label: 'Access',
    to: '/access',
    what: 'Who can open this panel, and what each of them may do.',
    view: 'admins.read',
    actions: [
      { key: 'admins.create', label: 'Appoint a સંચાલક', kind: 'edit' },
      { key: 'admins.update', label: 'Edit a સંચાલક', kind: 'edit' },
      { key: 'admins.disable', label: 'Suspend a સંચાલક', kind: 'edit' },
      { key: 'roles.assign', label: "Change somebody's role", kind: 'danger' },
      {
        key: 'roles.manage',
        label: 'Create roles and choose what each role may do',
        kind: 'danger',
        note: 'The most powerful permission here. He can still never grant what he does not hold himself.',
      },
      {
        key: 'grants.manage',
        label: 'Give or take away one permission for one person',
        kind: 'danger',
      },
      { key: 'scope.assign', label: 'Limit a સંચાલક to one or more સબઝોન', kind: 'edit' },
    ],
  },
  {
    id: 'audit',
    label: 'Audit Log',
    to: '/audit-logs',
    what: 'Who changed what, and when.',
    view: 'audit.read',
    actions: [{ key: 'audit.export', label: 'Download the trail as Excel', kind: 'edit' }],
  },
];

/** Every permission this map accounts for, in page order. */
export const mappedPermissions = () => {
  const out = [];
  for (const p of PAGES) {
    out.push(p.view);
    for (const a of p.actions) out.push(a.key);
  }
  return out;
};

/**
 * A view permission that opens more than one page.
 *
 * `settings.read` opens Settings, Video and Navigation, because all three read the same
 * `settings` row and there is nothing narrower to check. The editor has to say so: a person
 * ticking View on Video and finding that Settings appeared too would reasonably conclude the
 * screen is broken, and the honest answer is that these three are one door.
 *
 * Returns the other pages sharing a page's view permission, or an empty array.
 */
export const sharesViewWith = (page) =>
  PAGES.filter((p) => p.id !== page.id && p.view === page.view).map((p) => p.label);

/**
 * What a permission set means for one page.
 *
 * `canView` is the only thing that decides whether the page opens. `actions` reports each
 * write separately, because "he can open Darshan" and "he can replace the images" are
 * different answers and a screen that merged them would be the thing this file exists to stop.
 */
export function pageAccess(permissions, page) {
  const has = (k) => Array.isArray(permissions) && permissions.includes(k);
  const actions = page.actions.map((a) => ({ ...a, granted: has(a.key) }));
  return {
    canView: has(page.view),
    actions,
    /** How many of this page's actions he holds. */
    granted: actions.filter((a) => a.granted).length,
    total: page.actions.length,
  };
}

/**
 * One short sentence per page, for a summary column.
 *
 * "No access" / "View only" / "View + 2 of 5" — deliberately not a percentage and not a bare
 * count: the denominator is what tells somebody whether "2" is most of the page or a corner
 * of it.
 */
export function accessSummary(permissions, page) {
  const { canView, granted, total } = pageAccess(permissions, page);
  if (!canView) return 'No access';
  if (total === 0) return 'Can view';
  if (granted === 0) return 'View only';
  if (granted === total) return 'View and everything';
  return `View + ${granted} of ${total}`;
}
