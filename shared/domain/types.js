/**
 * Domain types for both apps.
 *
 * The repository is plain JavaScript — there is no tsconfig, no TypeScript dependency
 * and no build step that would typecheck one. §70 of the Admin brief says to use the
 * project's existing configuration rather than introduce a new one, so these are JSDoc
 * typedefs: editors and `tsc --noEmit --allowJs --checkJs` understand them, and nothing
 * in the build has to change.
 *
 * Import them with:  \@typedef {import('../../shared/domain/types.js').DarshanItem} DarshanItem
 */

/**
 * One scene, as the admin sees it.
 *
 * `id` is identity and never changes. `index` is the number printed inside the artwork
 * — it is part of the image, not something the app renders. `order` is presentation
 * position, which may one day differ from `index` (§32).
 *
 * `title` and `caption` are two fields and not two names for one. `title` is the short name
 * a list row or a heading shows; `caption` is the વર્ણન — the sentence Level 3 reads and
 * Level 4 tests. Only `caption` is part of the content gate, so a scene with no title is
 * shown to yuvaks exactly as before (DARSHAN_DATA_CONTRACT.md §2.1). There is no third
 * spelling: nothing in the domain or the services calls either of them `description`.
 *
 * @typedef {object} DarshanItem
 * @property {string}  id         stable identity, e.g. "darshan-009"
 * @property {number}  index      the number visible in the artwork
 * @property {number}  order      presentation position
 * @property {boolean} active     false hides it from the feed instead of deleting it
 * @property {string}  imageUrl   the image, on Google's CDN — what a card renders
 * @property {string}  fullUrl    the same image at the enlarged view's width
 * @property {string}  driveId    the Drive file behind those URLs, '' if typed by hand
 * @property {string}  file       the file's name in Drive, for display only
 * @property {string}  title      short name for lists and headings, '' when not yet written
 * @property {string}  caption    વર્ણન text, used by Level 3, never drawn over the image
 * @property {string}  reason     why it is not active, '' when it is
 * @property {string|null} source where the record came from: 'manifest' | 'supabase+manifest'
 */

/**
 * public.profiles — written at registration, then only by the yuvak himself.
 *
 * @typedef {object} UserRecord
 * @property {string}  id
 * @property {string|null} smk  null for anyone who registered after 0027_smk_optional:
 *                              નોંધણી does not ask for it. Write-once when it is set.
 * @property {string}  name
 * @property {string}  email
 * @property {string}  mobile
 * @property {string}  zoneId
 * @property {string}  subZoneId
 * @property {boolean} likeAnswer
 * @property {boolean} commentAnswer
 * @property {*}       gatePassedAt   ISO 8601 timestamptz string | null
 * @property {boolean} level4Unlocked
 * @property {*}       createdAt      ISO 8601 timestamptz string
 */

/**
 * public.progress — one row per yuvak per day, keyed (user_id, date) (§12).
 *
 * The day is the unit of scoring: a whole day's ticks collapse into one row rather than
 * one row per tick. Under Firestore that was forced — 2,000 yuvaks × 108 ticks is 216,000
 * writes/day against a 20,000 free limit — and it is kept because it is also the shape the
 * સંચાલક's daily report wants. public.learning_sessions is a different record: one row per
 * submitted recall round (§20), not per day.
 *
 * @typedef {object} ProgressRecord
 * @property {string} id           the date, YYYY-MM-DD in IST
 * @property {string} uid          filled in by the admin reader; not stored on the doc
 * @property {number} level3Score  0…108
 * @property {number} level4Score  0…108
 */

/**
 * settings['app'] — the one row every yuvak reads on every visit (§12).
 *
 * @typedef {object} AppSettings
 * @property {string}  [youtubeUrl]
 * @property {string}  [appName]
 * @property {boolean} [maintenance]
 * @property {string}  [maintenanceMessage]
 */

/**
 * settings['levels'] — level availability, so it is not scattered through components (§36).
 *
 * @typedef {object} LevelConfig
 * @property {number}  levelId
 * @property {number}  order
 * @property {string}  name
 * @property {boolean} enabled
 * @property {string}  [note]
 */

/**
 * public.audit_logs — never updated, never deleted (§41). No update or delete policy
 * exists for anyone, સંચાલક included.
 *
 * @typedef {object} AuditLog
 * @property {string} id
 * @property {string} actorId
 * @property {string} actorName
 * @property {string} action     one of shared/domain/audit.js ACTIONS
 * @property {string} targetId
 * @property {object} meta       never credentials, tokens or secrets
 * @property {*}      at         ISO 8601 timestamptz string, defaulted by now()
 */

export {};
