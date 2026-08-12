/**
 * The સાધના, described — one entry per page a યુવક can actually be standing on.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every page of this app already knows what it is; the knowledge was just spread across
 * seven files as prose in comments and sentences typed inline in JSX. That worked while
 * three people held the whole flow in their heads. It stops working the moment somebody
 * opens ActivityTestPage.jsx alone and asks "why is there no picture here?" — the answer
 * was in a different file, and an edit that seemed harmless removed the one thing the
 * screen existed to do.
 *
 * So each page's description is written down once, here, in the words a યુવક reads:
 *
 *   instruction  what he is meant to do on this page ("આ પેજમાં મારે શું કરવાનું છે?")
 *   contains     what is on it
 *   excludes     what is deliberately NOT on it, and stays not on it
 *   completion   what makes it finished
 *   next / prev  exactly one destination each, named by what it is
 *
 * `excludes` is the half that earns its keep. "લેવલ ૩ has no image" is a decision (§1
 * rule 1), not an omission, and a line that says so on screen is a line a future edit has
 * to consciously delete rather than quietly contradict.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What is data and what is not
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `short` and `instruction` are wording, and wording is the સંચાલક's (§36): he may
 * rephrase them for his યુવકો without a redeploy, through settings['journey'] and
 * resolveJourney() below.
 *
 * Everything else — `contains`, `excludes`, `completion`, `next`, `prev`, and the set of
 * pages itself — is behaviour, and behaviour is never configuration (§37). No settings row
 * may add a page, move a Next button, or claim લેવલ ૩ shows pictures. What a level *does*
 * is decided in code and stated here; what it is *called* and how it is *explained* is his.
 *
 * Shared between the two apps rather than living in src/, because the સંચાલક panel edits
 * this text and must show him exactly the page it belongs to — the same list, the same
 * order, the same names as the યુવક sees.
 */

/** The pages, by key. A key is a permanent identity: it is what a saved override names. */
export const JOURNEY_PAGE = {
  LOGIN: 'login',
  REGISTER: 'register',
  HOME: 'home',
  LEVEL1: 'level-1',
  LEVEL2: 'level-2',
  LEVEL3: 'level-3',
  LEVEL4: 'level-4',
  LEVEL4_TEST: 'level-4-test',
  LEVEL4_REVISION: 'level-4-revision',
};

/** settings['journey'] — the row holding the સંચાલક's wording. */
export const JOURNEY_SETTINGS_DOC = 'journey';

/**
 * The five states a level or કસોટી can be in, named once.
 *
 * લેવલ ૪'s પ્રવૃત્તિઓ carry their own richer set (shared/domain/level4.js, which adds
 * IN_PROGRESS and REVISION_REQUIRED); this is the vocabulary for a *level* on the home
 * page, where the only questions are "may I open it" and "have I finished it".
 */
export const LEVEL_STATE = {
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
};

/**
 * The specification itself.
 *
 * Read it as the answer to the ten questions every page must answer. The ones a screen
 * cannot express in a sentence to a યુવક — what it fetches, what it writes — are here as
 * `reads` and `records`, because "what does this page save?" is exactly the question that
 * gets answered wrongly six months later.
 *
 * `next` and `prev` are one destination each, and never a generic one. A button that says
 * 'આગળ' with no idea where it goes is how a યુવક ends up back on the home page in the
 * middle of a sequence he was following (§1: never a dead end, never a sideways exit).
 */
export const DEFAULT_JOURNEY = {
  [JOURNEY_PAGE.LOGIN]: {
    key: JOURNEY_PAGE.LOGIN,
    levelId: null,
    name: 'લોગિન',
    short: 'તમારા મોબાઈલ નંબરથી અંદર આવો.',
    instruction:
      'ધ્યાન શરૂ કરવા માટે પહેલાં લોગિન કરો. મોબાઈલ નંબર અને પાસવર્ડ નાખો. ખાતું ન હોય તો નીચેથી નોંધણી કરો.',
    contains: ['મોબાઈલ નંબર', 'પાસવર્ડ', 'લોગિન બટન', 'નોંધણીની કડી'],
    excludes: ['દર્શન', 'કોઈ પણ લેવલ', 'કસોટી'],
    completion: 'સાચા મોબાઈલ નંબર અને પાસવર્ડથી લોગિન થાય એટલે.',
    reads: 'auth.users, profiles',
    records: 'લોગિન સેશન',
    next: { to: '/', label: 'મુખપૃષ્ઠ' },
    prev: null,
    revision: null,
  },

  [JOURNEY_PAGE.REGISTER]: {
    key: JOURNEY_PAGE.REGISTER,
    levelId: null,
    name: 'નોંધણી',
    short: 'નવું ખાતું બનાવો.',
    instruction:
      'તમારું નામ, મોબાઈલ નંબર, સબઝોન અને પાસવર્ડ ભરો. નોંધણી થયા પછી સીધા લેવલ ૧ — વિડિયો દર્શન પર જવાશે.',
    contains: ['નામ', 'મોબાઈલ નંબર', 'સબઝોન', 'પાસવર્ડ'],
    excludes: ['દર્શન', 'કોઈ પણ લેવલ', 'કસોટી'],
    completion: 'નોંધણી સફળ થાય એટલે.',
    reads: 'સબઝોન યાદી',
    records: 'profiles — નામ, મોબાઈલ, સબઝોન',
    next: { to: '/welcome', label: 'લેવલ ૧ — વિડિયો દર્શન' },
    prev: { to: '/login', label: 'લોગિન' },
    revision: null,
  },

  [JOURNEY_PAGE.HOME]: {
    key: JOURNEY_PAGE.HOME,
    levelId: null,
    name: 'મુખપૃષ્ઠ',
    short: 'તમારી આખી સાધના એક નજરમાં.',
    instruction:
      'અહીંથી તમારી સાધના શરૂ થાય છે. દરેક લેવલ નીચે લખેલું છે કે એમાં શું કરવાનું છે અને એ ખૂલ્યું છે કે નહીં. જે લેવલ તૈયાર હોય એના પર અડકો.',
    contains: ['ચારેય લેવલ', 'દરેક લેવલનું ટૂંકું વર્ણન', 'આજની પ્રગતિ', 'લેવલ ૪ ક્યારે ખૂલશે તે'],
    excludes: ['દર્શનનાં ચિત્રો', 'કસોટી', 'વર્ણન યાદી'],
    completion: 'મુખપૃષ્ઠ પોતે કોઈ લેવલ નથી — અહીં કંઈ પૂરું કરવાનું નથી.',
    reads: 'settings.levels, આજની પ્રગતિ, લેવલ ૪ નો દરવાજો',
    records: 'કંઈ નહીં',
    next: { to: '/welcome', label: 'લેવલ ૧ — વિડિયો દર્શન' },
    prev: null,
    revision: null,
  },

  [JOURNEY_PAGE.LEVEL1]: {
    key: JOURNEY_PAGE.LEVEL1,
    levelId: 1,
    name: 'વિડિયો દર્શન',
    short: 'શરૂઆતનો વિડિયો ધ્યાનથી જુઓ.',
    instruction:
      'આ વિભાગમાં શરૂઆતનો વિડિયો બતાવવામાં આવે છે. વિડિયો શાંતિથી પૂરો જુઓ, પછી નીચેના બે પ્રશ્નોના જવાબ આપો. બંને જવાબ થાય એટલે લેવલ ૨ — દર્શન પર જવાનું બટન આવશે.',
    contains: ['વિડિયો', 'મોટા પડદે જોવાની સગવડ', 'બે પ્રશ્નો', 'આગળ જવાનું બટન'],
    excludes: ['દર્શનનાં ચિત્રો', 'PDF', 'કસોટી', 'સાચું-ખોટું'],
    completion: 'બંને પ્રશ્નોના જવાબ "હા" થાય એટલે.',
    reads: 'settings.app — વિડિયોની કડી',
    records: 'profiles — બંને જવાબ, અને પ્રવેશ થયાની તારીખ',
    next: { to: '/darshan', label: 'લેવલ ૨ — દર્શન' },
    prev: { to: '/', label: 'મુખપૃષ્ઠ' },
    revision: 'વિડિયો ગમે ત્યારે ફરી જોઈ શકાય — પ્રશ્નો ફરી પુછાતા નથી, જવાબ સુધારી શકાય છે.',
    /*
      લેવલ ૧ is the one page written in English (see src/pages/EntryGate.jsx — the video and
      its two questions are English, and half a page in each language reads worse than
      either). It therefore carries an English copy of the two sentences a યુવક reads, so
      the page can stay in one voice. Nothing else is translated: `contains`/`excludes` are
      shown in the same list as every other page's and stay Gujarati.
    */
    en: {
      short: 'Watch the opening video carefully.',
      instruction:
        'Watch the video all the way through, then answer both questions below. Once both answers are Yes, you can go on to Level 2 — Darshan.',
    },
  },

  [JOURNEY_PAGE.LEVEL2]: {
    key: JOURNEY_PAGE.LEVEL2,
    levelId: 2,
    name: 'દર્શન',
    short: 'બધાં દર્શન ચિત્ર, શીર્ષક અને વર્ણન સાથે જુઓ.',
    instruction:
      'આ વિભાગમાં તમને દરેક દર્શનનું ચિત્ર, શીર્ષક અને વર્ણન ક્રમ પ્રમાણે બતાવવામાં આવશે. અહીં કંઈ ટિક કરવાનું નથી અને કંઈ ગણાતું નથી — ફક્ત શાંતિથી દર્શન કરો. પૂરું થાય એટલે નીચે "આગળ" દબાવીને લેવલ ૩ પર જાઓ.',
    contains: ['દરેક દ્રશ્યનું ચિત્ર', 'શીર્ષક અને વર્ણન', 'ક્રમ નંબર'],
    // "No PDF" is written into the specification itself, not only into the level's name.
    // This level was called 'PDF દર્શન' once; the word came back twice after it was removed.
    excludes: ['કસોટી', 'ટિક કરવાનું', 'સાચું-ખોટું', 'PDF — દર્શન સીધાં ચિત્રો જ છે'],
    completion: 'અહીં કંઈ નોંધાતું નથી. જેટલી વાર જોવું હોય તેટલી વાર જોઈ શકાય.',
    reads: 'દર્શન સંગ્રહ — સંચાલકે પ્રકાશિત કરેલાં દ્રશ્યો',
    records: 'કંઈ નહીં',
    next: { to: '/level/3', label: 'લેવલ ૩ — વર્ણન યાદી' },
    prev: { to: '/welcome', label: 'લેવલ ૧ — વિડિયો દર્શન' },
    revision: 'આ જ વિભાગ ગમે ત્યારે ફરી ખોલી શકાય. કોઈ પણ લેવલમાંથી "દર્શન જુઓ" અહીં લાવે છે.',
  },

  [JOURNEY_PAGE.LEVEL3]: {
    key: JOURNEY_PAGE.LEVEL3,
    levelId: 3,
    name: 'વર્ણન યાદી',
    short: 'વર્ણન વાંચીને દ્રશ્ય મનમાં લાવો, પછી ટિક કરો.',
    instruction:
      'આ વિભાગમાં ચિત્ર બતાવવામાં આવતું નથી. દરેક ક્રમનું વર્ણન વાંચો, દ્રશ્ય મનમાં લાવો અને પછી ટિક કરો. જે ટિક કરો તે તરત સચવાય છે — એપ્લિકેશન બંધ કરો તો પણ કંઈ જતું નથી. રાત્રે ૧૨ વાગ્યે આજની ટિક ખાલી થશે અને આજનું પરિણામ કાયમ સચવાયેલું રહેશે.',
    contains: ['ક્રમ નંબર', 'વર્ણન', 'ટિક', 'આજની પ્રગતિ'],
    excludes: ['ચિત્ર', 'સાચું-ખોટું', '"પૂરું કરો" બટન — દરેક ટિક તરત સચવાય છે'],
    completion:
      'આ લેવલ રોજનું છે — એ કદી "પૂરું" થતું નથી. એક જ દિવસમાં સંચાલકે નક્કી કરેલી સંખ્યા પૂરી થાય એટલે લેવલ ૪ કાયમ ખૂલી જાય છે.',
    reads: 'દર્શન સંગ્રહ (વર્ણન), આજની પ્રગતિ',
    records: 'progress — આજની ટિક અને આજનું પરિણામ',
    next: { to: '/level/4', label: 'લેવલ ૪ — ફક્ત નંબર' },
    prev: { to: '/darshan', label: 'લેવલ ૨ — દર્શન' },
    revision: 'ઉપર "દર્શન જુઓ" દબાવીને ગમે ત્યારે ચિત્રો જોઈ શકાય. એ ક્યાંય નોંધાતું નથી.',
  },

  [JOURNEY_PAGE.LEVEL4]: {
    key: JOURNEY_PAGE.LEVEL4,
    levelId: 4,
    name: 'ફક્ત નંબર',
    short: 'કસોટીઓ એક પછી એક — ફક્ત નંબર જોઈને દ્રશ્ય યાદ કરો.',
    instruction:
      'લેવલ ૪ માં સંચાલકે બનાવેલી કસોટીઓ છે. એક કસોટી પૂરી થાય એટલે પછીની ખૂલે છે, અને પૂરી થયેલી કસોટી કાયમ પૂરી રહે છે. જે કસોટી "તૈયાર છે" તેના પર અડકો.',
    contains: ['કસોટીઓની યાદી', 'દરેક કસોટીમાં કેટલાં દ્રશ્યો છે તે', 'દરેક કસોટીની સ્થિતિ', 'પૂરી થયેલી કસોટીઓની ગણતરી'],
    excludes: ['ચિત્ર', 'વર્ણન', 'ટિક — એ કસોટીની અંદર છે', 'સંચાલકનાં સેટિંગ'],
    completion: 'બધી કસોટીઓ પૂરી થાય એટલે લેવલ ૪ પૂરું ગણાશે.',
    reads: 'લેવલ ૪ ની પ્રકાશિત ગોઠવણ, તમારી પ્રગતિ',
    records: 'કંઈ નહીં — આ યાદી છે, કસોટી નહીં',
    next: { to: '/level/4/:activityId', label: 'જે કસોટી તૈયાર હોય તે' },
    prev: { to: '/level/3', label: 'લેવલ ૩ — વર્ણન યાદી' },
    revision: 'જે કસોટીમાં ફરી દર્શન કરવાનાં હોય તેની નીચે "દર્શન ફરી જુઓ" દેખાશે.',
  },

  [JOURNEY_PAGE.LEVEL4_TEST]: {
    key: JOURNEY_PAGE.LEVEL4_TEST,
    levelId: 4,
    name: 'કસોટી',
    short: 'ફક્ત નંબર અને ટિક — યાદશક્તિની કસોટી.',
    instruction:
      'આ વિભાગમાં ફક્ત નંબર દેખાશે — ચિત્ર કે વર્ણન બતાવવામાં આવશે નહીં. દરેક નંબરનું દ્રશ્ય મનમાં આવે તો ટિક કરો. બધા નંબર ટિક થાય પછી જ "પૂરું કરો" બટન આવશે. કંઈ યાદ ન આવે તો "દર્શન ફરી જુઓ" — એમાં કશું ખોટું નથી. કસોટી જેટલી વાર આપવી હોય એટલી વાર આપી શકાય; પૂરી થયેલી કસોટી કાયમ તમારી રહેશે.',
    contains: ['ક્રમ નંબર', 'ટિક'],
    excludes: [
      'ચિત્ર',
      'શીર્ષક અને વર્ણન',
      'જવાબ',
      'સાચું-ખોટું — જે યાદ છે તે તમે જ જાણો છો',
      'કેટલાં બાકી છે તેની ટકોર',
    ],
    completion: 'આ કસોટીના બધા નંબર ટિક થાય અને "પૂરું કરો" મોકલાય એટલે. પછી આ કસોટી કાયમ પૂરી રહેશે.',
    reads: 'આ કસોટીના દ્રશ્યોના નંબર — ચિત્ર કે વર્ણન નહીં',
    records: 'લેવલ ૪ નો દરેક પ્રયાસ — પૂરો થયો હોય કે અધૂરો — અને કસોટી પૂરી થઈ તે',
    next: { to: '/level/4', label: 'પૂરું થાય તો — પછીની કસોટી, નહીં તો દર્શન ફરી જુઓ' },
    prev: { to: '/level/4', label: 'લેવલ ૪ ની યાદી' },
    revision:
      'બધા નંબર ટિક ન થાય ત્યાં સુધી નીચે "દર્શન ફરી જુઓ" દેખાશે. જેટલી વાર જોઈએ તેટલી વાર. જેટલું યાદ છે એટલું "આટલું નોંધાવો" થી નોંધાવી પણ શકાય — કસોટી એટલી જ ખુલ્લી રહેશે.',
  },

  [JOURNEY_PAGE.LEVEL4_REVISION]: {
    key: JOURNEY_PAGE.LEVEL4_REVISION,
    levelId: 4,
    name: 'પુનરાવર્તન',
    short: 'આ કસોટીનાં દર્શન ફરી જુઓ, પછી ફરી કસોટી આપો.',
    instruction:
      'આ વિભાગમાં તમને આ કસોટીનાં દર્શન ફરી બતાવવામાં આવે છે — ચિત્ર, શીર્ષક અને વર્ણન સાથે. અહીં કંઈ ટિક કરવાનું નથી અને કંઈ ગણાતું નથી. ચિત્ર પર અડકો તો મોટું દેખાશે. શાંતિથી જોયા પછી નીચે "ફરી કસોટી આપો" દબાવો.',
    contains: ['આ કસોટીનાં ચિત્રો', 'શીર્ષક અને વર્ણન', 'ક્રમ નંબર'],
    excludes: ['ટિક', 'કસોટી', 'સાચું-ખોટું', 'કેટલાં યાદ ન રહ્યાં તેની ગણતરી'],
    completion: 'અહીં કંઈ પૂરું કરવાનું નથી. જેટલી વાર જોવું હોય તેટલી વાર જોઈ શકાય.',
    reads: 'આ કસોટીનાં દ્રશ્યો — ચિત્ર અને વર્ણન સાથે',
    records: 'ફરી દર્શન કર્યાની ગણતરી (સંચાલક માટે). એના પર કંઈ અટકતું નથી.',
    next: { to: '/level/4/:activityId', label: 'ફરી કસોટી આપો' },
    prev: { to: '/level/4', label: 'લેવલ ૪ ની યાદી' },
    revision: null,
  },
};

/** levelId → page key, for the home page and the panel's level list. */
export const LEVEL_PAGE_KEY = {
  1: JOURNEY_PAGE.LEVEL1,
  2: JOURNEY_PAGE.LEVEL2,
  3: JOURNEY_PAGE.LEVEL3,
  4: JOURNEY_PAGE.LEVEL4,
};

/** The specification for a level, by its number. `null` for a level the code has no page for. */
export const specForLevel = (levelId, journey = DEFAULT_JOURNEY) =>
  journey[LEVEL_PAGE_KEY[levelId]] ?? null;

/** The pages, in the order a યુવક meets them — what the panel lists and PAGES.md documents. */
export const JOURNEY_ORDER = [
  JOURNEY_PAGE.LOGIN,
  JOURNEY_PAGE.REGISTER,
  JOURNEY_PAGE.HOME,
  JOURNEY_PAGE.LEVEL1,
  JOURNEY_PAGE.LEVEL2,
  JOURNEY_PAGE.LEVEL3,
  JOURNEY_PAGE.LEVEL4,
  JOURNEY_PAGE.LEVEL4_TEST,
  JOURNEY_PAGE.LEVEL4_REVISION,
];

/** The only two fields a સંચાલક may rewrite. Everything else about a page is code (§37). */
export const JOURNEY_EDITABLE = ['short', 'instruction'];

/** Long enough for a real paragraph, short enough that a page cannot be buried under one. */
export const JOURNEY_LIMITS = { short: 140, instruction: 700 };

/**
 * settings['journey'].value.pages → the wording actually shown.
 *
 * Built the same way resolveLevels() is, and for the same reason: this is jsonb that
 * anybody with settings.update once wrote, not a typed value, so every way it can be wrong
 * has to end at a renderable page rather than at an exception.
 *
 *   absent / not an object     → the defaults, unchanged.
 *   an unknown page key        → ignored. A settings row cannot invent a tenth page.
 *   a field that is not text   → ignored, and the default for that one field stands.
 *   an empty string            → ignored. Blanking the box restores the default wording;
 *                                it is not a way to leave a page with no description, which
 *                                is exactly what this file exists to prevent.
 *   a field that is too long   → ignored on read as well as refused on write, so a row
 *                                saved by an older panel cannot push a page off screen.
 *
 * Overrides are per field, not per page: a સંચાલક who rewrites `short` keeps the code's
 * `instruction` until he rewrites that too.
 */
export function resolveJourney(stored) {
  const pages = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const out = {};

  for (const key of Object.keys(DEFAULT_JOURNEY)) {
    const base = DEFAULT_JOURNEY[key];
    const override = pages[key];
    if (!override || typeof override !== 'object') {
      out[key] = base;
      continue;
    }

    const patch = {};
    for (const field of JOURNEY_EDITABLE) {
      const value = override[field];
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!text || text.length > JOURNEY_LIMITS[field]) continue;
      patch[field] = text;
    }

    out[key] = Object.keys(patch).length ? { ...base, ...patch } : base;
  }

  return out;
}

/**
 * What the panel checks before it saves — the same rules resolveJourney() applies on read,
 * said out loud so a સંચાલક is told why his text was refused instead of watching it
 * silently revert on the યુવક's phone.
 */
export function validateJourneyOverrides(pages) {
  if (pages == null) return { ok: true };
  if (typeof pages !== 'object' || Array.isArray(pages)) {
    return { ok: false, gu: 'Invalid description data.' };
  }

  for (const [key, override] of Object.entries(pages)) {
    if (!DEFAULT_JOURNEY[key]) return { ok: false, gu: `Unknown page: ${key}` };
    if (!override || typeof override !== 'object') {
      return { ok: false, gu: `Invalid text for ${key}.` };
    }
    for (const [field, value] of Object.entries(override)) {
      if (!JOURNEY_EDITABLE.includes(field)) {
        return { ok: false, gu: `${field} is not editable — only the description text is.` };
      }
      if (typeof value !== 'string') return { ok: false, gu: `Invalid text for ${key}.` };
      if (value.trim().length > JOURNEY_LIMITS[field]) {
        return {
          ok: false,
          gu: `${key}: this text is too long (max ${JOURNEY_LIMITS[field]} characters).`,
        };
      }
    }
  }

  return { ok: true };
}
