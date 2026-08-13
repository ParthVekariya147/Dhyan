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
      'ધ્યાન શરૂ કરવા માટે પહેલાં લોગિન કરી લો. તમારો મોબાઈલ નંબર અને પાસવર્ડ લખો. હજી ખાતું ન બનાવ્યું હોય તો નીચેની કડીથી નોંધણી કરી લેજો.',
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
    /*
      "નોંધણી પછી ક્યાં જવાશે" is written from what the code actually does, not from what it
      used to do. src/pages/Register.jsx navigates to ENTRY_ROUTE.HOME — it was
      ENTRY_ROUTE.LEVEL1 once, and this sentence and the `next` below were still describing
      that older app. A description that promises a screen the button does not open is worse
      than no description.
    */
    instruction:
      'તમારું નામ, મોબાઈલ નંબર, સબઝોન અને પાસવર્ડ લખો. નોંધણી પૂરી થાય એટલે સીધા મુખપૃષ્ઠ પર જવાશે. ત્યાંથી લેવલ ૧ - વિડિયો દર્શન શરૂ કરજો.',
    contains: ['નામ', 'મોબાઈલ નંબર', 'સબઝોન', 'પાસવર્ડ'],
    excludes: ['દર્શન', 'કોઈ પણ લેવલ', 'કસોટી'],
    completion: 'નોંધણી થઈ જાય એટલે.',
    reads: 'સબઝોન યાદી',
    records: 'profiles - નામ, મોબાઈલ, સબઝોન',
    next: { to: '/', label: 'મુખપૃષ્ઠ' },
    prev: { to: '/login', label: 'લોગિન' },
    revision: null,
  },

  [JOURNEY_PAGE.HOME]: {
    key: JOURNEY_PAGE.HOME,
    levelId: null,
    name: 'મુખપૃષ્ઠ',
    short: 'તમારી આખી સાધના એક નજરમાં.',
    /*
      મુખપૃષ્ઠ is the one page with no instruction, and that is a decision.

      It used to carry four sentences at the top - "અહીંથી તમારી સાધના શરૂ થાય છે…" - which
      PageIntro printed as four bullets above the ring. Every one of them was already said
      by the screen itself: each tile carries its own `short`, a locked tile says what opens
      it, and the ring says what today came to. So the first thing a યુવક saw was a
      paragraph explaining the page he was looking at, pushing the ring and the way in
      below the fold on a phone.

      Empty, not deleted: the page is still in the specification, still listed in the panel,
      and still says what it contains and excludes. PageIntro renders nothing for an empty
      instruction, so this is the description going quiet rather than the page going missing.
      A સંચાલક who ever wants a line here can write one through settings['journey'] (§36) and
      it appears - resolveJourney() treats an empty default like any other.
    */
    instruction: '',
    contains: ['ચારેય લેવલ', 'દરેક લેવલનું ટૂંકું વર્ણન', 'આજની પ્રગતિ', 'લેવલ ૪ ક્યારે ખૂલશે તે'],
    excludes: ['દર્શનનાં ચિત્રો', 'કસોટી', 'વર્ણન યાદી'],
    completion: 'મુખપૃષ્ઠ પોતે કોઈ લેવલ નથી - અહીં કંઈ પૂરું કરવાનું નથી.',
    reads: 'settings.levels, આજની પ્રગતિ, લેવલ ૪ નો દરવાજો',
    records: 'કંઈ નહીં',
    next: { to: '/welcome', label: 'લેવલ ૧ - વિડિયો દર્શન' },
    prev: null,
    revision: null,
  },

  [JOURNEY_PAGE.LEVEL1]: {
    key: JOURNEY_PAGE.LEVEL1,
    levelId: 1,
    name: 'વિડિયો દર્શન',
    short: 'શરૂઆતનો વિડિયો શાંતિથી જુઓ.',
    instruction:
      'અહીં શરૂઆતનો વિડિયો છે. શાંતિથી આખો વિડિયો જુઓ. પછી નીચે આપેલા બે પ્રશ્નોમાં ટિક કરો. બંને ટિક થાય એટલે લેવલ ૨ - દર્શન પર જવાનું બટન ચાલુ થશે. વિડિયો ફરી જોવો હોય તો જેટલી વાર મન થાય એટલી વાર જોઈ શકશો.',
    contains: ['વિડિયો', 'મોટા પડદે જોવાની સગવડ', 'બે પ્રશ્નો', 'આગળ જવાનું બટન'],
    excludes: ['દર્શનનાં ચિત્રો', 'PDF', 'કસોટી', 'સાચું-ખોટું'],
    completion: 'બંને પ્રશ્નોમાં "હા" ટિક થાય એટલે.',
    reads: 'settings.app - વિડિયોની કડી',
    records: 'profiles - બંને જવાબ, અને પ્રવેશ થયાની તારીખ',
    next: { to: '/darshan', label: 'લેવલ ૨ - દર્શન' },
    prev: { to: '/', label: 'મુખપૃષ્ઠ' },
    revision: 'વિડિયો ગમે ત્યારે ફરી જોઈ શકાય. પ્રશ્નો ફરી પુછાતા નથી, પણ જવાબ સુધારી શકાય છે.',
    /*
      લેવલ ૧ used to carry an English copy of these two sentences, because the page itself
      was written in English. It is not any more (see src/pages/EntryGate.jsx): a યુવક comes
      here straight from નોંધણી and could not read the one screen that asks him something.
      There is now exactly one wording per page, in one language, everywhere.
    */
  },

  [JOURNEY_PAGE.LEVEL2]: {
    key: JOURNEY_PAGE.LEVEL2,
    levelId: 2,
    name: 'દર્શન',
    short: 'શાંતિથી દર્શન કરો - Image, વર્ણન અને ક્રમ નંબર, ત્રણેય યાદ રાખો.',
    /*
      Three things to remember, and the number is the one that gets forgotten.

      This page used to say only "શાંતિથી દર્શન કરો" — true, and not enough. લેવલ ૩ asks him
      to recall the ચિત્ર from the વર્ણન, and લેવલ ૪ asks him to recall both from the **number
      alone**. A યુવક who spent his time here on the pictures and never looked at the numbers
      has done the work and still arrives at લેવલ ૪ unable to start. So the number is named
      here, in the same breath as the other two, where the remembering actually happens.

      The "at least five times" is guidance and is deliberately not counted. Nothing on this
      page records a view: the app cannot tell a દ્રશ્ય studied from a દ્રશ્ય scrolled past,
      and a counter that claimed otherwise would be the app asserting something it does not
      know. The reassurance that nothing is counted stays for the same reason it was written —
      this is the one level with nothing at stake, and that is what makes it restful.
    */
    /*
      One sentence, one line. PageIntro renders an instruction as a bulleted list, a point
      per sentence, so the full stops here are the line breaks a યુવક reads: this paragraph
      was five instructions run together in one block of Gujarati, and on a phone the
      middle three were skipped. Nothing is abbreviated for the format — each point is a
      whole sentence, and it still reads as a paragraph anywhere that shows it as one.
    */
    instruction:
      'અહીં દરેક દર્શનનું Image , શીર્ષક અને વર્ણન ક્રમ પ્રમાણે આવશે. દરેક Image શાંતિથી દર્શન કરો અને એની સાથેનું વર્ણન તથા ક્રમ નંબર - ત્રણેય મનમાં રાખો. એક એક દર્શન ઓછામાં ઓછું પાંચ વાર નિરાંતે કરજો, જેથી લીલા મનમાં બરાબર યાદ રહી જાય. આગળના લેવલમાં ફક્ત ક્રમ અને ડિસ્ક્રિશન હશે Image નઈ હોઈ . Image દર્શન પૂરું થાય એટલે નીચે "આગળ" દબાવીને લેવલ ૩ પર જાઓ.',
    contains: ['દરેક દ્રશ્યનું ચિત્ર', 'શીર્ષક અને વર્ણન', 'ક્રમ નંબર', 'ગણતરી વગર, જેટલી વાર જોવું હોય એટલી વાર'],
    // "No PDF" is written into the specification itself, not only into the level's name.
    // This level was called 'PDF દર્શન' once; the word came back twice after it was removed.
    excludes: ['કસોટી', 'ટિક કરવાનું', 'સાચું-ખોટું', 'PDF - દર્શન સીધાં ચિત્રો જ છે'],
    completion: 'અહીં કંઈ નોંધાતું નથી. જેટલી વાર દર્શન કરવાં હોય એટલી વાર કરી શકાય.',
    reads: 'દર્શન સંગ્રહ - સંચાલકે પ્રકાશિત કરેલાં દ્રશ્યો',
    records: 'કંઈ નહીં',
    next: { to: '/level/3', label: 'લેવલ ૩ - વર્ણન યાદી' },
    prev: { to: '/welcome', label: 'લેવલ ૧ - વિડિયો દર્શન' },
    revision: 'આ જ વિભાગ ગમે ત્યારે ફરી ખોલી શકાય. કોઈ પણ લેવલમાંથી "દર્શન કરો" અહીં લાવે છે.',
  },

  [JOURNEY_PAGE.LEVEL3]: {
    key: JOURNEY_PAGE.LEVEL3,
    levelId: 3,
    name: 'વર્ણન યાદી',
    short: 'વર્ણન વાંચીને Image મનમાં લાવો, પછી ટિક કરો.',
    /*
      Two sentences added, and both are about what the tick *means*.

      "જો ખરેખર યાદ હોય તો જ" — because a યુવક who ticks generously passes into લેવલ ૪ and
      then meets a કસોટી with no વર્ણન on it at all. The tick is his own honest answer to
      himself and nothing checks it, which is exactly why it has to be asked for plainly.

      And the number again: લેવલ ૪ shows nothing else, so a દ્રશ્ય remembered without its
      number is a દ્રશ્ય he cannot reach there. This is the last page that shows the number
      beside the વર્ણન — after this the number is on its own.
    */
    instruction:
      'આ વિભાગમાં કોઈ Image બતાવવામાં નહીં આવે. દરેક ક્રમનું વર્ણન વાંચજો અને એનું દ્રશ્ય મનમાં લાવવું . જો એ Image ખરેખર મનમાં યાદ આવે તો જ સામેનું ટિકબોક્સ ટીક કરવું. Image સાથેનો ક્રમ નંબર પણ યાદ રાખજો, કારણ કે આગળના લેવલમાં તમને ફક્ત નંબર જ દેખાશે. તમે જે ટિક કરશો એ સેવ થઈ જશે - એપ્લિકેશન બંધ કરી દો તો પણ તમારો ડેટા નહીં જાય. આગળ ના રાઉન્ડ માં જવા માટે 60 ટીક જરૂરી છે તો જે તમે પછીના રાઉન્ડ માં જઈ શકશો. રાત્રે ૧૨ વાગે આજની ટિક Reset થઈ જશે, પણ આજનો ડેટા સેવ રહેશે. કોઈ Image યાદ ન આવે તો ટિક ન કરશો - ઉપર "દર્શન કરો" બટન દબાવીને ફરી દર્શન કરી લેવું.',
    contains: ['ક્રમ નંબર', 'વર્ણન', 'ટિક', 'આજની પ્રગતિ'],
    excludes: ['ચિત્ર', 'સાચું-ખોટું', '"પૂરું કરો" બટન - દરેક ટિક તરત સચવાય છે'],
    completion:
      'આ લેવલ રોજ કરવાનું છે, એટલે એ કદી "પૂરું" થતું નથી. એક જ દિવસમાં સંચાલકે નક્કી કરેલી ટિક પૂરી થાય એટલે લેવલ ૪ કાયમ માટે ખૂલી જાય છે.',
    reads: 'દર્શન સંગ્રહ (વર્ણન), આજની પ્રગતિ',
    records: 'progress - આજની ટિક અને આજનું પરિણામ',
    next: { to: '/level/4', label: 'લેવલ ૪ - ફક્ત નંબર' },
    prev: { to: '/darshan', label: 'લેવલ ૨ - દર્શન' },
    revision: 'ઉપર "દર્શન કરો" દબાવીને ગમે ત્યારે ફરી દર્શન કરી શકાય. એ ક્યાંય નોંધાતું નથી.',
  },

  [JOURNEY_PAGE.LEVEL4]: {
    key: JOURNEY_PAGE.LEVEL4,
    levelId: 4,
    name: 'ફક્ત નંબર',
    short: 'કસોટીઓ એક પછી એક - ફક્ત નંબર જોઈને લીલા યાદ કરો.',
    instruction:
      'લેવલ ૪ માં સંચાલકે બનાવેલી કસોટીઓ આપવામાં આવી છે. એક કસોટી પૂરી કરશો એટલે પછીની કસોટી આપમેળે ખૂલશે. જે કસોટી એક વાર પૂરી થઈ જાય એ કાયમ માટે પૂરી જ રહેશે. જે કસોટી "તૈયાર છે" એવું દેખાય, એના પર અડકો અને કસોટી શરૂ કરો. એક વાર ખૂલેલી કસોટી, પૂરી થઈ ગઈ હોય તો પણ, ફરીથી જેટલી વાર આપવી હોય એટલી વાર આપી શકશો.',
    contains: ['કસોટીઓની યાદી', 'દરેક કસોટીમાં કેટલાં દ્રશ્યો છે તે', 'દરેક કસોટીની સ્થિતિ', 'પૂરી થયેલી કસોટીઓની ગણતરી'],
    excludes: ['ચિત્ર', 'વર્ણન', 'ટિક - એ કસોટીની અંદર છે', 'સંચાલકનાં સેટિંગ'],
    completion: 'બધી કસોટીઓ પૂરી થાય એટલે લેવલ ૪ પૂરું ગણાશે.',
    reads: 'લેવલ ૪ ની પ્રકાશિત ગોઠવણ, તમારી પ્રગતિ',
    records: 'કંઈ નહીં - આ યાદી છે, કસોટી નહીં',
    next: { to: '/level/4/:activityId', label: 'જે કસોટી તૈયાર હોય તે' },
    prev: { to: '/level/3', label: 'લેવલ ૩ - વર્ણન યાદી' },
    revision: 'જે કસોટીમાં ફરી દર્શન કરવાનાં હોય એની નીચે "ફરી દર્શન કરો" દેખાશે.',
  },

  [JOURNEY_PAGE.LEVEL4_TEST]: {
    key: JOURNEY_PAGE.LEVEL4_TEST,
    levelId: 4,
    name: 'કસોટી',
    short: 'ફક્ત નંબર જોઈને લીલા યાદ કરો, પછી ટિક કરો.',
    instruction:
      'આ કસોટીમાં ફક્ત નંબર દેખાશે - Image કે વર્ણન બતાવવામાં નહીં આવે. દરેક નંબરની સામેની લીલા અને એનું વર્ણન યાદ આવે તો જ ટિક કરજો. જો કોઈ નંબરની સામેની લીલા યાદ ન આવે તો ટિક કરવી નહીં. એના બદલે નીચે "ફરી દર્શન કરો" દબાવીને ફરી દર્શન કરો અને લીલા ધ્યાનથી વિચારો. ફરી દર્શન કરી શકાયે છે , જેટલી વાર જરૂર પડે એટલી વાર દર્શન કરી શકશો. બધી ટીક કરવી જરૂરી છે માટે બધી ટીક થઇ ગયા પછી "પૂરું કરો" બટન આવશે. કસોટી ફરી આપવા પર કોઈ મર્યાદા નથી - પૂરી થઈ ગયા પછી પણ જેટલી વાર આપવી હોય એટલી વાર આપી શકશો, અને પૂરી થયેલી કસોટી નો ડેટા સેવ થઇ ગયો છે .',
    contains: ['ક્રમ નંબર', 'ટિક'],
    excludes: [
      'ચિત્ર',
      'શીર્ષક અને વર્ણન',
      'જવાબ',
      'સાચું-ખોટું - શું યાદ છે એ તમે જ જાણો છો',
      'કેટલાં બાકી છે એની ટકોર',
    ],
    completion:
      'આ કસોટી માટે જેટલી ટિક જરૂરી હોય એટલી થાય અને "પૂરું કરો" દબાવો એટલે. કસોટી ફરી આપવા પર કોઈ મર્યાદા નથી - પૂરી થઈ ગયા પછી પણ જેટલી વાર આપવી હોય એટલી વાર આપી શકાય, અને પૂરી થયેલી કસોટી નો ડેટા સેવ થઇ ગયો છે .',
    reads: 'આ કસોટીના દ્રશ્યોના નંબર - ચિત્ર કે વર્ણન નહીં',
    records: 'લેવલ ૪ નો દરેક પ્રયાસ - પૂરો થયો હોય કે અધૂરો - અને કસોટી પૂરી થઈ તે',
    next: { to: '/level/4', label: 'પૂરું થાય તો પછીની કસોટી, નહીં તો ફરી દર્શન કરો' },
    prev: { to: '/level/4', label: 'લેવલ ૪ ની યાદી' },
    revision:
      'જરૂરી ટિક પૂરી ન થાય ત્યાં સુધી નીચે "ફરી દર્શન કરો" દેખાશે - જેટલી વાર જોઈએ એટલી વાર. અત્યારે જેટલું યાદ છે એટલું "આટલું નોંધાવો" થી નોંધાવી પણ શકાય, કસોટી એટલી જ ખુલ્લી રહેશે.',
  },

  [JOURNEY_PAGE.LEVEL4_REVISION]: {
    key: JOURNEY_PAGE.LEVEL4_REVISION,
    levelId: 4,
    name: 'પુનરાવર્તન',
    short: 'આ કસોટીનાં દર્શન ફરી કરો, પછી ફરી કસોટી આપો.',
    instruction:
      'અહીં આ કસોટીનાં દર્શન ફરી બતાવવામાં આવે છે - ચિત્ર, શીર્ષક અને વર્ણન સાથે. અહીં કંઈ ટિક કરવાનું નથી અને કંઈ ગણાતું નથી. ચિત્ર પર અડકો એટલે મોટું દેખાશે. શાંતિથી દર્શન કરો, લીલા મનમાં રાખો અને થોડું મનન-ચિંતન કરો. પછી નીચે "ફરી કસોટી આપો" દબાવો. જેટલી વાર દર્શન કરવાં હોય એટલી વાર કરી શકશો, અને કસોટી પૂરી થઈ ગઈ હોય તો પણ ફરી આપી શકાય.',
    contains: ['આ કસોટીનાં ચિત્રો', 'શીર્ષક અને વર્ણન', 'ક્રમ નંબર'],
    excludes: ['ટિક', 'કસોટી', 'સાચું-ખોટું', 'કેટલાં યાદ ન રહ્યાં એની ગણતરી'],
    completion: 'અહીં કંઈ પૂરું કરવાનું નથી. જેટલી વાર દર્શન કરવાં હોય એટલી વાર કરી શકાય.',
    reads: 'આ કસોટીનાં દ્રશ્યો - ચિત્ર અને વર્ણન સાથે',
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

/**
 * Where a level lives — for the levels the યુવક app has actually built.
 *
 * A settings row may name a fifth level and enable it: `resolveLevels()` hands it back and
 * મુખપૃષ્ઠ drops it, because a level with no screen is a tile that leads nowhere (§37 — what
 * a level *does* belongs to the code, not to a settings document). Anything offering a way
 * onward has to make the same check, or it hands out a URL that App.jsx's catch-all quietly
 * redirects home, which is a promise taken back one tap later.
 *
 * Not derived from the page specifications above: those say what is *on* a page, and their
 * `next` is the step a યુવક takes from it — `LEVEL4.next` is the કસોટી to open, not લેવલ ૪'s
 * own address.
 */
export const LEVEL_ROUTE = {
  1: '/welcome',
  2: '/darshan',
  3: '/level/3',
  4: '/level/4',
};

/**
 * The level a યુવક goes to after this one, or null when the સાધના ends here.
 *
 * "After" is the સંચાલક's `order` and never `levelId + 1`: he may reorder the levels (§36),
 * and a list where લેવલ ૩ sits after લેવલ ૪ is a configuration, not a fault. The candidate
 * must also be enabled and must have a screen.
 *
 * **Null is the ordinary answer at લેવલ ૪**, which is the last level built today — so a
 * caller has to render an ending rather than assume there is always another door. That is
 * why this returns null instead of falling back to મુખપૃષ્ઠ: "go home" is not the next step
 * of a સાધના, and a button that says otherwise is worse than no button.
 *
 * @param {Array} levels  resolveLevels()'s list
 * @param {number} levelId the level being left
 * @returns {{ levelId: number, name: string, to: string }|null}
 */
export function nextLevelAfter(levels, levelId) {
  const list = Array.isArray(levels) ? levels : [];
  const here = list.find((l) => l && l.levelId === levelId);
  if (!here) return null;

  // Ordered before the search, so this does not depend on the caller having sorted — and
  // ties fall back to levelId exactly as resolveLevels() breaks them, or "the next one" is
  // whichever of two equal orders the array happened to hold first.
  const next = [...list]
    .filter((l) => l && l.enabled !== false && LEVEL_ROUTE[l.levelId])
    .sort((a, b) => a.order - b.order || a.levelId - b.levelId)
    .find((l) => l.order > here.order || (l.order === here.order && l.levelId > here.levelId));

  return next ? { levelId: next.levelId, name: next.name, to: LEVEL_ROUTE[next.levelId] } : null;
}

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
        return { ok: false, gu: `${field} is not editable - only the description text is.` };
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
