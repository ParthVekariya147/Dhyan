# FULL PROJECT REALITY AUDIT — વર્ણી ધ્યાન (DHYAN)

**Audit date:** 2026-08-13
**Branch:** `main` · **HEAD:** `4bc844e`
**Method:** read-only inspection of the real repository by seven parallel auditors with non-overlapping file ownership. No file was modified, no migration was run, no database was written.

---

## AUDIT CONDITIONS — read this before trusting any number

Three conditions bound every claim in this report.

### 1. No database access

`SUPABASE_DB_PASSWORD` and `SUPABASE_SECRET_KEY` are not set in this environment. `scripts/db.mjs` requires the first; there is no other path to the live Postgres.

**Consequence:** no migration can be confirmed as applied. Every migration-dependent claim is marked **CODE PRESENT / DB STATE UNVERIFIED**. Nothing in this report says a feature is complete because a `.sql` file exists.

### 2. The working tree is not the repository

`git status` shows **121 uncommitted paths**, including 26 untracked ones. The uncommitted work is not incidental — it is the navigation shell, the entire history/points subsystem, and three migrations.

**The single most important finding in this audit:**

`src/App.jsx` is a **tracked** file. It imports `./components/AppShell` (line 8), `./components/BottomNav`, and `./components/NavIcon`. Git does not have those files.

```
?? src/components/AppShell.jsx
?? src/components/BottomNav.jsx
?? src/components/NavIcon.jsx
```

**A clean checkout of HEAD does not build.** A deploy from HEAD fails; a deploy from the working tree ships uncommitted code. There is presently no committed, buildable state of this application.

Untracked, and therefore not deployed:

| Path | What it is |
|---|---|
| `supabase/migrations/0019_mobile_navigation.sql` | bottom-nav schema + validation trigger |
| `supabase/migrations/0020_nav_settings_ready.sql` | nav registry |
| `supabase/migrations/0021_progress_history_points.sql` | **74 KB** — history, attempts, points |
| `src/components/AppShell.jsx`, `BottomNav.jsx`, `NavIcon.jsx`, `bottom-nav.css` | the app shell |
| `src/lib/{history,activity,useNavigation,useViewingSpeed}.js` | their data layer |
| `src/pages/{History,Profile,Settings}.jsx` + css | three pages |
| `shared/domain/{history,points,navigation,viewing-speed}.js` | their domain modules |
| `admin/src/features/navigation/` | the whole navigation admin section |
| `admin/src/features/settings/components/PointsCard.jsx` | points admin UI |
| `admin/src/features/users/pages/UserActivityPage.jsx` + `services/activityService.js` | admin history UI |
| `scripts/{test-navigation,test-points,test-viewing-speed,verify-nav}.mjs` | their tests |

`supabase/migrations/0018_gallery_slideshow.sql` is staged (`A`) but not committed.

### 3. The repository was being edited during the audit

Uncommitted paths grew from 115 to 121 while the auditors ran; 48 files carry mtimes inside the audit window. At one point `src/lib/history.js` contained `**/` inside a JSDoc block, which terminates the comment and broke the build for roughly three minutes before being corrected externally. **This report is a snapshot, not a stable state.**

---

# SECTION 1 — EXECUTIVE SUMMARY

## Overall completion: **71%** of the working tree. **0% deployable from HEAD.**

### How that number was calculated

Not estimated. 86 discrete, individually-audited capabilities were scored:

- **1.0** — implemented and connected end to end (UI ↔ backend ↔ database)
- **0.5** — partial: works but with a material gap
- **0.0** — missing, broken, or built-but-not-connected

A feature built but not reachable by a user scores **0**, not 1 — an unrouted page delivers nothing.

| Area | Score | Of |
|---|---|---|
| Authentication & accounts | 5.5 | 8 |
| RBAC & authorization | 3.0 | 5 |
| Level 1 | 4.0 | 5 |
| Level 2 / દર્શન | 5.0 | 8 |
| Gallery viewer | 5.0 | 6 |
| Level 3 | 4.5 | 5 |
| Level 4 | 7.0 | 9 |
| History & attempts | 3.0 | 6 |
| Points & leaderboard | 1.0 | 4 |
| Content management | 6.5 | 7 |
| Admin panel | 10.0 | 11 |
| App shell & navigation | 4.5 | 6 |
| Quality & infrastructure | 2.0 | 6 |
| **Total** | **61.0** | **86** |

**61 / 86 = 70.9% ≈ 71%.**

No second percentage is given for HEAD, because HEAD does not compile. Stating a completion figure for a tree that cannot build would be misleading.

### The shape of the problem

This is not a half-finished application. It is a **substantially complete application with a delivery problem**.

The engineering quality of what exists is high and unusually well-reasoned — 44 of 44 `SECURITY DEFINER` functions pin `search_path`, RLS is enabled on all 16 tables, Level 4 scoring is server-authoritative with no client write path, image retry is jittered and exponential, CLS measures 0.0000. The domain test suite runs 1,532 assertions and every one passes.

What is wrong is at the seams:

1. **Nothing is committed.** The shell, the history system, the points system, three migrations.
2. **Finished features are not wired up.** `History.jsx`, `UserActivityPage.jsx`, and `PointsCard.jsx` are complete, documented components that nothing imports or routes.
3. **The tests that exist cannot see the risk.** 1,532 assertions, none of which executes a single line of SQL or exercises a single RLS policy — and the entire authorization model is RLS. CI does not run the test suite at all.
4. **One HIGH security finding** that is one public registration form away from full admin compromise, if a precondition holds that cannot be checked without database access.

---

# SECTION 2 — REAL USER FLOW

The flow in the audit brief differs from the code in four places. The corrected chain:

```
first visit
    ↓ ✅  entry-route.js:179 → /register (or /login if returning)
નોંધણી (register)
    ↓ ✅  Register.jsx:135 → "/" directly. Login is NOT a step.
મુખપૃષ્ઠ (home)
    ↓ ✅  Home.jsx:182 → /welcome
લેવલ ૧ = વિડિયો + બંને પ્રશ્નો  (ONE page, EntryGate.jsx — not VideoStage.jsx)
    ↓ ✅  EntryGate.jsx:93 → /darshan   (writes profiles.gate_passed_at)
લેવલ ૨ = દર્શન  (DarshanPage.jsx)
    ↓ ⚠️  DarshanPage.jsx:127 → /level/3   (navigation fine; no error/empty state behind it)
લેવલ ૩ = પુનરાવર્તન  (LevelPage.jsx)
    ↓ ✅  LevelPage.jsx:459 → /level/4   (gated client + server)
લેવલ ૪  (Level4Page.jsx)
    ↓ ✅  Level4Page.jsx:456 → /level/4/:activityId
કસોટી  (ActivityTestPage.jsx)
    ↓ ✅  RPC level4_submit → /level/4/:nextId
```

| Transition | Status | Note |
|---|---|---|
| first visit → નોંધણી | ✅ Working | |
| deep link, no session → લોગિન | ✅ Working | Netlify SPA fallback correct |
| નોંધણી → મુખપૃષ્ઠ | ✅ Working | writes `auth.users` + `profiles` |
| નોંધણી → લોગિન (auto-login failed) | ✅ Working | account already created |
| લોગિન → મુખપૃષ્ઠ | ⚠️ Partial | `App.jsx:192` writes `state.from`; `Login.jsx:101` never reads it |
| મુખપૃષ્ઠ → લેવલ ૧ | ✅ Working | |
| લેવલ ૧ video | ✅ Working | missing link → explanatory notice, questions still render |
| video → questions | ⏳ Missing as a transition | one page; no transition exists |
| લેવલ ૧ → લેવલ ૨ (first pass) | ✅ Working | nav is inside the `try` after the `await` — a failed write never navigates |
| લેવલ ૧ replay → લેવલ ૨ | ⚠️ Partial | page renders outside `AppShell`; no way home |
| લેવલ ૨ → લેવલ ૩ | ⚠️ Partial | no error state, no empty state |
| "revision" between L3 and L4 | ⏳ Missing | પુનરાવર્તન is Level 3's own label; the revision *page* lives inside Level 4 |
| લેવલ ૩ → લેવલ ૪ | ✅ Working | gate is an invitation, not a redirect |
| લેવલ ૪ → કસોટી 4.1 | ✅ Working | LOCKED cards untappable; RPC re-checks |
| કસોટી → next કસોટી | ✅ Working | server is the authority on the pass mark |
| કસોટી → પુનરાવર્તન | ✅ Working | images correctly withheld when LOCKED |
| પુનરાવર્તન → કસોટી again | ✅ Working | write is fire-and-forget, never blocks |
| `/history` | ❌ Broken | page exists; no route, no link, no nav key |
| `/learn` | ❌ Broken | routed; zero inbound links |

**Direct URL access.** `guardRoute()` (`shared/domain/entry-route.js:172-199`) enforces exactly one rule: no session, no protected page. The "hold an ungated યુવક at લેવલ ૧" rule was **deliberately deleted** (`entry-route.js:183-197`). So for any signed-in user, `/darshan`, `/level/3`, `/level/4`, `/level/4/:id` and `/level/4/:id/revision` all open by typing the URL.

This is a defensible design — routing grants nothing, and every level re-checks server-side — but it has a consequence worth naming: **`profiles.gate_passed_at` no longer gates anything.** It only switches `EntryGate` into replay mode.

---

# SECTION 3 — FEATURE MATRIX

| Feature | Expected | Actual | Status | Evidence | Backend | DB | UI | Security |
|---|---|---|---|---|---|---|---|---|
| Auth stack | — | Supabase (Postgres + GoTrue + PostgREST). **Not Firebase** | ✅ | `shared/supabase/client.js:1`, project `tjovudfsodviwijyyvdw` | ✅ | ✅ | ✅ | RLS |
| Register | works | works; client-side validation only | ✅ | `auth.jsx:274-353` | ✅ | ✅ | ✅ | RLS |
| Email login | works | works | ✅ | `auth.jsx:371-377` | ✅ | ✅ | ✅ | GoTrue |
| Mobile login | works | Netlify fn resolves mobile→email with secret key, signs in with **publishable** key | ✅ | `netlify/functions/login-mobile.js:87-93` | ✅ | ✅ | ✅ | good design, **no rate limit** |
| Mobile ownership proof | OTP | **none anywhere** | ⏳ | grep: no SMS/OTP | — | — | — | root of F1 |
| Password reset | works | email only; mobile-registered users have no path | ⚠️ | `Login.jsx:113-125`, `Profile.jsx:87-89` | ✅ | ✅ | ⚠️ | — |
| Role storage | table | `admin_profiles.role`, enum `admin_role`, 5 roles | ✅ | `0004_rbac.sql:35-63` | ✅ | ✅ | — | ✅ |
| Permission matrix | table or fn | function `permissions_for()`, 17 permissions; SQL and JS copies **match exactly** | ✅ | `0009:70-96` vs `permissions.js:47-116` | ✅ | ✅ | ✅ | ✅ |
| Admin route guards | server | `RequireAdmin` is client-render but DB-driven (`rpc effective_role`); `RequirePermission` is client-only, backed by RLS on every read/write | ✅ | `RequireAdmin.jsx:21-84`, `RequirePermission.jsx:28-49` | ✅ | ✅ | ✅ | ✅ |
| Roles admin UI | exists | **does not exist** — roles assigned by SQL only | ⏳ | no route in `admin/src/App.jsx` | — | ✅ | ❌ | — |
| L1 video | plays | YouTube-nocookie, `playsinline`, fullscreen allowed, no autoplay | ✅ | `EntryGate.jsx:189-196` | ✅ | ✅ | ✅ | — |
| L1 video URL source | admin | `settings['app'].youtubeUrl`, editable at `/video` | ✅ | `0001:263`, `VideoPage.jsx:77` | ✅ | ✅ | ✅ | ✅ |
| L1 two questions | required | both must be ticked; button disabled otherwise | ✅ | `EntryGate.jsx:56,282` | ✅ | ✅ | ✅ | RLS |
| L1 "video watched" | recorded | **nothing records watching** — only self-declared like/comment answers | ⏳ | `auth.jsx:439-450` | — | — | — | — |
| PDF દર્શન | removed | **zero runtime PDF anywhere**; all hits are prose or exclusion filters | ✅ | repo-wide grep | — | — | — | — |
| Image દર્શન | direct images | `lh3.googleusercontent.com/d/{id}=w1600-rj-v1` | ✅ | `shared/domain/drive.js:141` | ✅ | ✅ | ✅ | — |
| દર્શન card content | image+title+desc+number | image ✅ desc ✅ number ✅ **title ✗** | ⚠️ | `DarshanCard.jsx:117-157` | ✅ | ✅ | ⚠️ | — |
| `scenes.title` | rendered | column, migration, Excel round-trip and health metric all exist; **rendered on no user screen** | ❌ | `0013:48` plumbed to `darshan.js:163`, never read | ✅ | ✅ | ❌ | — |
| Ordering / index | stable | 4 concepts cleanly separated: `id` / `index` / `order` / derived `displayIndex` | ✅ | `darshan.js:236-329` | ✅ | ✅ | ✅ | ✅ |
| Lazy loading | 109 not on first paint | 6-card batches + `IntersectionObserver(900px)` + `loading="lazy"` | ✅ | `DarshanFeed.jsx:22,72-85` | — | — | ✅ | — |
| Image failure retry | exists | 3 jittered exponential retries, dead state, tap/keyboard retry, auto-retry on scroll re-entry | ✅ | `useImageRetry.js:50-68` | — | — | ✅ | — |
| દર્શન error state | exists | **none** | ⏳ | `DarshanPage.jsx` | — | — | ❌ | — |
| દર્શન empty state | exists | **none** | ⏳ | `DarshanPage.jsx:89-97` | — | — | ❌ | — |
| Gallery fullscreen | click→viewer | works | ✅ | `DarshanFeed.jsx:92-98` | — | — | ✅ | — |
| Gallery L/R nav | buttons+keys+swipe | all three, disabled at ends, no wraparound | ✅ | `GalleryViewer.jsx:204-211,359-370,434-451` | — | — | ✅ | — |
| Gallery index always visible | required | unconditional; idle-fade was removed | ✅ | `GalleryViewer.jsx:486-492` | — | — | ✅ | — |
| Gallery description NOT hideable | required | **`descOpen` defaults `false`; a ⓘ વર્ણન button toggles it** | ❌ | `GalleryViewer.jsx:82,464-468,494-523` | — | — | ❌ | — |
| Gallery dark background | required | `#050403`, fixed, `inset:0` | ✅ | `gallery.css:43` | — | — | ✅ | — |
| Slideshow on/off + 1-60 s | admin-configurable | `settings['app'].slideshow.seconds`, bounds enforced by a DB trigger; admin UI present; plus a per-user 2-30 s local override | ✅ | `0018:105-159`, `GalleryCard.jsx:146-161` | ✅ | ✅ | ✅ | ✅ |
| L3 no image | required | `TickRow` has no image prop and no `<img>`; `s.url` never referenced | ✅ | `TickRow.jsx:53-77` | — | — | ✅ | — |
| L3 threshold | admin-configurable | `settings['levels'].level4Gate.threshold`, default 80, edited at `/levels` | ✅ | `0014:76-101`, `LevelsPage.jsx:317-390` | ✅ | ✅ | ✅ | ✅ |
| L3 threshold enforcement | server | `level4_gate_open()` evaluated in SQL — **but its input `progress.level3_score` is client-writable** | ⚠️ | `0014:122-137` vs `0004:605-611` | ✅ | ✅ | ✅ | ⚠️ |
| L4 dynamic sub-activities | admin-created | `level4_configs` → `level4_activities` → `level4_activity_items` | ✅ | `0010:69-167` | ✅ | ✅ | ✅ | ✅ |
| L4 arbitrary ranges / hand-pick | required | Range tool **and** individual checkbox list, both live simultaneously | ✅ | `SceneSelector.jsx:124-313` | ✅ | ✅ | ✅ | ✅ |
| L4 fixed 27-item chunks | must NOT exist | **no constant, no chunk size anywhere**; only a user-typed partition count | ✅ | grep across `src/`,`shared/`,`admin/`,`supabase/` | — | — | ✅ | — |
| L4 exam UI | number + checkbox only | `NumberRow` — no image, no title, no description; `{id,n}` projection | ✅ | `ActivityTestPage.jsx:212-218,627-645` | ✅ | ✅ | ✅ | ✅ |
| L4 pass/fail | server-computed | computed **only** in SQL after intersecting with `level4_effective_items` | ✅ | `0017:131-145` | ✅ | ✅ | ✅ | ✅ |
| L4 sequential unlock | server-enforced | `level4_locked` raised for any un-passed earlier activity | ✅ | `0017:112-129` | ✅ | ✅ | ✅ | ✅ |
| L4 repeat of unlocked | required | unlimited; COMPLETED never demoted | ✅ | `0017:167-174` | ✅ | ✅ | ✅ | ✅ |
| L4 submit idempotency | required | **no token, no unique constraint** — double-click creates a duplicate attempt row | ❌ | `level4.js:684-701`, `0017:150-153` | ❌ | ❌ | ⚠️ | — |
| L4 `requiredCount` on create | saved | **silently dropped** — create branch omits it and the service has no such parameter | ❌ | `Level4EditorPage.jsx:251-256` vs `level4Service.js:266` | ❌ | ✅ | ⚠️ | — |
| Daily history schema | per-day rows | day is inside the PK; **no delete path, no cron, anywhere** | ✅ | `0021:216`, `0001:53` | ✅ | ✅ | ❌ | ✅ |
| Day boundary | IST | fixed +05:30 with `toISOString()`; `getDate()` never used; server recomputes it | ✅ | `daily.js:34-57`, `0021:780` | ✅ | ✅ | ✅ | ✅ |
| L3 attempt history | append-only | new row per attempt, server-assigned number, idempotency token, bounded retry | ✅ | `0021:851-890` | ✅ | ✅ | ❌ | ✅ |
| L4 attempt history | append-only | plain insert, no upsert; `required_count` snapshotted per row | ✅ | `0017:150-153` | ✅ | ✅ | ❌ | ✅ |
| User history UI | exists | **`History.jsx` complete — no route, no nav key, no inbound link** | ❌ | `App.jsx` has no `/history` | ✅ | ✅ | ❌ | — |
| Admin history/attempts UI | exists | **`UserActivityPage.jsx` complete — no route in `admin/src/App.jsx`** | ❌ | grep: zero matches | ✅ | ✅ | ❌ | — |
| L4 attempts readable | somewhere | collected since 0010; **read by zero lines of client code** | ⏳ | grep `level4_attempts` in `src/`,`admin/src/` → comments only | ✅ | ✅ | ❌ | — |
| Points schema | server-authoritative | `award_points()` revoked from all roles; no client write path; at-most-once per day by unique constraint | ✅ | `0021:660-702,1398-1411` | ✅ | ✅ | ❌ | ✅ |
| Points admin UI | exists | **`PointsCard.jsx` complete — `SettingsPage.jsx` does not import it** | ❌ | grep `PointsCard` → only its own export | ✅ | ✅ | ❌ | — |
| Leaderboard | future | **nothing** — no table, view, RPC, route or component. A `ready=false` nav placeholder the server refuses to enable | ⏳ | `0020:66`, `nav_config_error()` `0020:22-29` | — | — | — | ✅ |
| Content: image link | admin | paste Drive link or bulk-import a filename column | ✅ | `darshanService.js:314-325` | ✅ | ✅ | ✅ | RLS |
| Content: reorder | drag/drop | drag **and** arrow keys, whole-list save via RPC `darshan_reorder` | ✅ | `DarshanListPage.jsx:399-539`, `0012_darshan_reorder.sql:96` | ✅ | ✅ | ✅ | ✅ |
| Excel import | real parser | 315-line ZIP+inflate+shared-string xlsx reader, zero deps; 12 columns, 3 modes, conflict resolution | ✅ | `shared/domain/xlsx-read.js:253` | ✅ | ✅ | ✅ | ✅ |
| Universal image naming | sheet column authoritative | admin path matches **strictly** on `rec.file`; no index→filename derivation in the browser | ✅ | `sheet-import.js:1014,1026` | ✅ | ✅ | ✅ | — |
| Excel export | exists | CSV with BOM + formula-injection guard (contract says xlsx export: no) | ✅ | `admin/src/lib/export.js:38,127` | — | — | ✅ | ✅ |
| Google Drive role | source/import | **Drive is also the production image CDN at runtime** — `lh3` URLs are stored in `scenes.image_url` and rendered directly | ⚠️ | `drive.js:141`, `DarshanCard.jsx:195` | ✅ | ✅ | ✅ | see P1-4 |
| Bottom nav DB-driven | admin picks buttons | user app reads `settings['nav'].mobileBottom` at runtime and honours `visible`/`enabled` | ✅ | `useNavigation.js:159-180`, `navigation.js:320` | ✅ | ✅ | ✅ | ✅ route never from the row |
| PWA / service worker | works | registered by injection; `skipWaiting`+`clientsClaim`; `_headers` revalidates `/sw.js`; images excluded from precache | ✅ | `vite.config.js:55-96`, `dist/registerSW.js` | — | — | ✅ | ✅ |

---

# SECTION 4 — LEVEL MATRIX

| Level | UI | Navigation | Persistence | Unlock | Repeat | History | Server enforcement | Status |
|---|---|---|---|---|---|---|---|---|
| **1** — વિડિયો + પ્રશ્નો (`EntryGate.jsx`) | video + 2 checkboxes, one page | `/welcome`, **outside `AppShell`** — no bottom bar, and in replay mode exactly one button and no way home | `profiles.like_answer`, `comment_answer`, `gate_passed_at` | n/a | replay any time | none | RLS on `profiles` | ⚠️ Partial — nothing records that the video was watched; the page is a navigation trap if an admin adds it to the bar |
| **2** — દર્શન (`DarshanPage.jsx`) | image + વર્ણન + number; **no શીર્ષક** despite the on-page promise at `journey.js:190` | `← વિડિયો દર્શન` / `આગળ →` | **none** — the page writes nothing | n/a | unlimited | none | none needed | ⚠️ Partial — no error state, no empty state, title never rendered |
| **2b** — Gallery viewer | fullscreen, L/R, always-visible number, dark, slideshow 1-60 s | swipe + keys + buttons | none | n/a | unlimited | none | slideshow bounds enforced by DB trigger | ⚠️ Partial — વર્ણન is collapsed by default and hideable, against requirement |
| **3** — પુનરાવર્તન (`LevelPage.jsx`) | number + વર્ણન + checkbox, **no image** ✅ | `/level/3`, ungated by router | ticks → localStorage → `progress` upsert ≤60 s; attempts → `activity_attempts` (server) | n/a (daily) | unlimited, IST midnight reset | append-only, exemplary: token index + attempt-number unique constraint + bounded retry | `activity_submit` SECURITY DEFINER, server IST date, server attempt number | ⚠️ Partial — history layer is uncommitted; gate input is client-writable |
| **4** — list (`Level4Page.jsx`) | cards with code, title, `દ્રશ્ય N-M`, status | lock renders a notice, never a redirect | read-only | derived server-side: gate + sequential, **COMPLETED asked first** | completed cards offer `ફરી કસોટી આપો` | ring counts completed/published | `level4_state()` → `level4_activity_states()`; helper fns all revoked from `public` | ✅ Working |
| **4.x** — કસોટી (`ActivityTestPage.jsx`) | **number + checkbox only** ✅ | LOCKED cards untappable; direct URL → notice | result server-side only | sequential, server-enforced | **unlimited** (0017 restored it) | every attempt appended, incl. partials | pass computed only in SQL; no client write path to either table | ⚠️ Partial — no idempotency token; the "answers are not fetched" comment is false |
| **4.x** — પુનરાવર્તન (`RevisionPage.jsx`) | full image + વર્ણન + number (the answer key, by design) | refuses to render for LOCKED | `revision_count` only | `canOpen = status !== LOCKED` | unlimited | `revision_count` | `level4_mark_revision` re-checks | ⚠️ Partial — never received the "already passed" exemption 0017 gave `level4_submit`, so it can refuse an activity the submit accepts |

---

# SECTION 5 — ADMIN MATRIX

19 routes in `admin/src/App.jsx`. Every routed page has a real backing table or RPC — **there is no dead routed page.**

| Page | Route | Status | Backend | RBAC | Mobile | Loading | Error |
|---|---|---|---|---|---|---|---|
| Login | `/login` | ✅ | GoTrue | public | ✅ | ✅ | ✅ |
| Landing | `/` | ✅ | — | `NAV.find(can)` | — | — | — |
| Dashboard | `/dashboard` | ✅ | `profiles_level4`, RPC `stage_breakdown`, `learning_sessions` | client + RLS | ✅ | per-band skeleton | per-band retry |
| Users | `/users` | ✅ | view `profiles_level4` | client + RLS | ✅ table→cards | ✅ | ✅ |
| User detail | `/users/:userId` | ✅ read-only | `profiles_level4`, `learning_state`, `learning_sessions` | client + RLS | ✅ | 3 skeletons | 3 error states |
| Darshan list | `/darshan` | ✅ | `scenes`, RPC `darshan_reorder` | client + RLS + RPC re-check | ✅ | ✅ | ✅ |
| Darshan health | `/darshan/health` | ✅ | `scenes` + manifest | client | ✅ | ✅ | ✅ |
| Darshan import | `/darshan/import` | ✅ | xlsx parse → N× upsert; Netlify `list-drive-folder` | `darshan.update` + RLS | ✅ | progress live region | per-row failures |
| Darshan detail | `/darshan/:itemId` | ⚠️ | `scenes` upsert | **no client `can()` check — RLS only** | ✅ | ✅ | ✅ |
| Progress | `/progress` | ⚠️ | `learning_state`, `learning_sessions` | client + RLS | ✅ | ✅ | ✅ |
| Sessions | `/sessions` | ✅ | `learning_sessions` | client + RLS | ✅ | ✅ | ✅ |
| Levels + L4 gate | `/levels` | ✅ | `settings['levels']` | disabled-not-hidden | inline flex | ✅ | ✅ |
| Level 4 list | `/levels/4` | ⚠️ | `level4_configs`, RPCs `level4_publish`/`clone` | RPC re-checks | ✅ | ✅ | ✅ |
| Level 4 editor | `/levels/4/config/:configId` | ⚠️ | `level4_activities`, `level4_activity_items` | RLS + `level4_guard_editable()` | ✅ | ✅ | ✅ |
| Video | `/video` | ✅ | `settings['app'].youtubeUrl` | disabled-not-hidden | ✅ | ✅ | ✅ |
| Navigation | `/navigation` | ✅ | `settings['nav'].mobileBottom` | disabled + **DB trigger** | ✅ | ✅ | ✅ |
| Settings | `/settings` | ✅ | `settings['app']` + Storage `dhun` | read-only banner | ✅ | ✅ | ✅ |
| Audit log | `/audit-logs` | ✅ | `audit_logs` + actor embed | `audit.read` + RLS | ✅ | ✅ | ✅ |
| catch-all | `*` | ✅ | — | — | — | — | — |

**Does not exist:** Roles UI · Points UI (component written, unmounted) · History UI (page written, unrouted) · Attempts UI (same file) · Leaderboard (nothing anywhere) · day-by-day score reporting · image upload (link-only by design) · `.xlsx` export (CSV by design).

---

# SECTION 6 — DATABASE MATRIX

**23 migrations** (0001-0021, with duplicate `0012_*` and `0017_*` prefixes). 16 tables, all with RLS enabled. `scripts/db.mjs` applies files in **filename sort order**, keyed by full filename in `public.schema_migrations`.

| Table | PK | Unique | FK / ON DELETE | Indexes | RLS | Written by | UI |
|---|---|---|---|---|---|---|---|
| `profiles` | `id` | `smk`, `mobile` | `→auth.users` CASCADE | 2 uniques | ✅ own-or-permission | client (own row) | ✅ |
| `progress` | `(user_id,date)` | PK | `→profiles` CASCADE | `date desc` | ✅ own-write | **client upsert** + RPC | ⚠️ no admin report |
| `learning_state` | `user_id` | — | `→profiles` CASCADE | PK | ✅ | client | ✅ admin |
| `learning_sessions` | `id` text | — | `→profiles` CASCADE | `(user_id, created_at desc)` | ✅ | client | ✅ admin |
| `scenes` | `id` | 2 partial (`index`, `order`) | none (deliberate) | 2 partial | ✅ | admin + `darshan_reorder` | ✅ |
| `settings` | `key` | — | — | PK | ✅ read-all-signed-in | admin, 3 validating triggers | ✅ |
| `audit_logs` | `id` | — | `→profiles` **NO ACTION** | 2 | ✅ no UPDATE/DELETE for anyone | triggers + client insert | ✅ |
| `admin_profiles` | `id` | — | `→profiles` CASCADE | partial role idx | ✅ + BEFORE trigger | **SQL only** | ❌ |
| `level4_configs` | `id` | `version`, partial `status='PUBLISHED'` | 3×`→profiles` | 1 partial | ✅ no DELETE policy | admin + RPC | ✅ |
| `level4_activities` | `id` | `(config_id,code)`, `(config_id,position)` deferrable | `→configs` CASCADE | `(config_id,position)` | ✅ + editable guard | admin | ✅ |
| `level4_activity_items` | `(activity_id,scene_id)` | `(activity_id,position)` deferrable | `→activities` CASCADE; `scene_id` no FK (deliberate) | PK | ✅ | admin | ✅ |
| `level4_activity_progress` | `(user_id,activity_id)` | — | 3× CASCADE | 2 | ✅ **read-only for clients** | RPC only | ⚠️ count only |
| `level4_attempts` | `id` bigserial | **none** | 3× CASCADE | 2 | ✅ read-only | RPC only | ❌ **no UI at all** |
| `activity_attempts` ⁰⁰²¹ | `id` bigserial | `(user,level,key,date,attempt_no)`; partial `(user,client_token)` | `→profiles` CASCADE | 2 | ✅ read-only | RPC only | ❌ unrouted |
| `daily_activity_progress` ⁰⁰²¹ | `(user,date,level,key)` | PK | `→profiles` CASCADE | 1 | ✅ read-only | RPC only | ❌ unrouted |
| `point_transactions` ⁰⁰²¹ | `id` bigserial | `(user,date,level,key)` | `→profiles` CASCADE; `source_id` no FK (polymorphic) | 2 | ✅ read-only | RPC/trigger only | ❌ unrouted |

**Views** (all `security_invoker = on`): `profiles_level4`, `attempt_history`, `activity_history`, `point_ledger`.

### Migration ordering hazard — real, and silent

`scripts/db.mjs` has **no out-of-order guard**. It applies any unrecorded file, regardless of whether higher-sorting files are already applied.

The duplicate `0012` prefix is the visible instance. If a database recorded `0012_darshan_reorder.sql` but not `0012_level4_repeat_access.sql`, and is already at 0017:

1. `0012_level4_repeat_access.sql` applies.
2. It runs `create or replace function public.level4_submit(...)` with **0012's body**, overwriting 0017's.
3. `did_pass` reverts to `selected_n = cardinality(effective_items)` — i.e. **100% always**. The admin's per-activity pass mark stops being read.
4. `level4_published_config()` (0016's version, untouched) still reports `requiredCount: 20`, so **the button appears at 20 ticks and the server refuses the pass.**
5. No error, no rollback, no log line distinguishing this from a normal apply.

The function-only migrations are individually replay-safe (`create or replace`, `grant`, `alter … if not exists`), which is exactly what makes this silent rather than loud. The table-creating migrations (0010, 0021) are **not** idempotent and would fail loudly on replay.

**Whether the live database is in this state is UNVERIFIED.**

---

# SECTION 7 — SECURITY FINDINGS

## CRITICAL
None.

## HIGH

### F1 — `profiles.mobile` is unverified and unguarded at INSERT, and it is the SUPER_ADMIN bootstrap key

`effective_role()` grants `SUPER_ADMIN` to any profile whose `mobile` matches one of three literals:

```sql
-- supabase/migrations/0004_rbac.sql:133-138
select 'SUPER_ADMIN'::public.admin_role
from public.profiles p
where p.id = auth.uid()
  and p.mobile in ('9601269715', '9601269009', '9925842081')
```

`profiles.mobile` is protected **only on UPDATE**:

```sql
-- supabase/migrations/0001_init.sql:183-185
create trigger profiles_guard_immutable
  before update on public.profiles      -- UPDATE only. No INSERT trigger exists.
```

There is no BEFORE INSERT trigger on `profiles` anywhere in the repository. The INSERT policy checks only `id = auth.uid()` (`0001:201-202`); the column constraint checks only the digit shape (`0001:26`); the value is supplied verbatim by the browser (`auth.jsx:280,330-333`). There is **no SMS/OTP proof of number ownership anywhere in the app**.

**Impact:** registering with `mobile = '9601269715'` grants SUPER_ADMIN over every profile, all progress, all settings, and role assignment. Because `mobile` *is* immutable on UPDATE and `profiles` has no DELETE policy, the claim is permanent once made.

**Exploitability: conditional.** Blocked by `unique (mobile)` if the three numbers are already registered — **UNVERIFIED, requires DB access.** If any is unregistered, exploitation is one public registration form submission. `scripts/seed-admin-supabase.mjs:83-85` confirms the "no profile yet" state is expected to occur.

**Doc contradiction:** `shared/domain/constants.js:54-57` asserts the column "cannot be self-declared". Per the code, that is false at INSERT.

## MEDIUM

### F2 — Daily `progress` is client-written, and the Level 4 gate derives from it
`0004:605-611` permits the client upsert at `src/lib/progress.js:338-341`. `level3_score >= threshold` fires `progress_unlock_level4` (`0008:165-175`) and feeds `level4_gate_open()` (`0014:122-137`). A user can `PATCH` `level3_score: 108` and self-open Level 4. **Knowingly accepted** — argued at `0008:36-42`. Contrast Level 4 itself, which is correctly RPC-only. Note also that any *past* date can be rewritten: the policy has no date restriction.

### F3 — `login-mobile` has no rate limiting, and leaks registration status
No throttle exists in the file. Three oracles: **timing** (unregistered = one fetch at `:85`; registered = two, the second running bcrypt at `:89-93`), **429 divergence** (`:97-99` reachable only for registered numbers), **"not confirmed" divergence** (`:100-102`). This defeats the endpoint's own stated purpose (`:5-7`) — ~2,000 mobile numbers in the `[6-9]XXXXXXXXX` space become enumerable, with unlimited password guessing against each.

### F4 — Mobile logins share one Netlify egress IP, collapsing Supabase's per-IP auth throttle
`:89-93`. One attacker exhausting the limit produces 429 for **every** mobile-login user at once. Email login is unaffected. This is also what makes F3's oracle deterministic.

### F5 — Any role holder, including VIEWER, can insert arbitrary `audit_logs` rows
`0001:255-256` — `with check (is_admin() and actor_id = auth.uid())`, never replaced (`0004:657-659` says so deliberately). `is_admin()` means "holds any role". A VIEWER can fabricate entries in a log they are forbidden to *read*. Bounded: `actor_id` is pinned so entries cannot be blamed on someone else, and no UPDATE/DELETE policy exists so real entries cannot be erased.

### F6 — `level4_submit` has no idempotency token
`src/lib/level4.js:684-701` sends no token; `0017:150-153` is an unconditional insert; `level4_attempts` has no day-scoped unique constraint; `ActivityTestPage.jsx:230-251` has `disabled={sending}` but no `if (sending) return;` guard. A double-click, a network retry, or two open tabs each create a real duplicate attempt row and increment `attempt_count` twice. Bounded: the day score is *recounted* not incremented (`0017:182-187`), and points pay once. Level 3's `activity_submit` is by contrast exemplary.

### F7 — Cross-tab data loss on `progress.level4_score`
`src/lib/progress.js:199` always sends `level4_score` from a **mount-time** baseline that is never re-read (`:483-498`), with `merge-duplicates`. The server writes the same column with `greatest()` (`0017:192`); the client does not mirror it. Sequence: tab A mounts (score 0) → tab B passes a કસોટી (server sets 40) → tab A ticks a Level 3 scene and flushes → **the 40 is overwritten with 0.** This is in committed, deployed code.

## LOW

| ID | Finding | Evidence |
|---|---|---|
| F8 | SUSPENDED users can still update their own `profiles` row — the profile policy omits `is_active_user()` that every other write policy has. `status` itself is correctly pinned, so the sanction is incomplete, not escapable | `0004:594-596` vs `:606,610,620,624` |
| F9 | Both apps share one session under `localStorage` key `varni.auth`, contradicting the comment at `src/lib/supabase.js:4-5`. Security impact nil; the comment is wrong | `shared/supabase/client.js:37` |
| F10 | Password reset unreachable for a mobile-registered user who doesn't know their email — the app never displays it | `Login.jsx:113-125`, `Profile.jsx:87-89` |
| F11 | `.env.example:21-26` documents `publish-drive-image-background.js` and a `darshan.publish` permission; neither exists | contradicted by `netlify.toml:13-16`, `0009:56-63` |
| F12 | `learning_sessions` client-supplied text PK is a weak existence oracle (one bit, requires a victim uuid) | `0001:82`, `learning.jsx:59-63` |

## Positive findings — verified correct, do not regress these

1. **RLS enabled on all 16 tables.** No `disable row level security` anywhere. Exactly two `using (true)` policies, both SELECT, both `to authenticated` (`scenes`, `settings`) — neither targets `anon`, and **no policy anywhere targets `anon`**.
2. **All 44 `SECURITY DEFINER` functions pin `search_path = public`.** Zero exceptions.
3. **`SECURITY DEFINER` functions taking an arbitrary uuid are not granted to `authenticated`** — `has_earned_level4`, `level4_gate_open`, `level4_effective_items`, `level4_covered_scene_ids`, `level4_completed_activity_ids`, `level4_activity_states`, `award_points` are all revoked with no matching grant.
4. **Both `profiles_level4` view definitions carry `security_invoker = on`** (`0011:69-70`, `0014:298-299`). Omitting it would have dumped every profile to every signed-in user.
5. **Role escalation via `admin_profiles` is blocked in depth** — an RLS policy *and* a BEFORE trigger that binds `service_role` too, covering self-appointment, self-promotion, self-status-change and cross-tier demotion.
6. **Level 4 attempts and progress are RPC-only** — no write policy at all, plus explicit `revoke insert, update, delete` and a sequence revoke. The scoring RPC derives every input server-side and recounts rather than increments.
7. **Points are server-authoritative** — no points parameter on `activity_submit`, no date parameter, `award_points` revoked from everyone, at-most-once enforced by a unique constraint with `on conflict do nothing` rather than a lose-the-race existence check.
8. **The secret key never reaches browser code.** `vite.config.js:21-26` hard-fails a production build carrying the `VITE_PUBLIC_DARSHAN` bypass flag. No secrets found in `dist/`.
9. **`list-drive-folder.js` authenticates with the caller's own token, not the secret key**, and closes its SSRF surface with a shape check before interpolation.
10. **`login-mobile.js` signs in with the publishable key**, so the session is an ordinary RLS-bound one; the email never leaves the server.
11. **SQL and JS permission matrices do not drift** — verified line by line.
12. **`audit_logs` has no UPDATE or DELETE policy for anyone**, administrators included.
13. **Bottom-nav routes always come from `NAV_REGISTRY`** — a stored settings row may choose among destinations but may never name one. Enforced in the page, the service, and a DB trigger.

---

# SECTION 8 — PERFORMANCE FINDINGS

Measured against a real production build and a real Chrome.

| Item | Verdict | Evidence |
|---|---|---|
| Route-level code splitting | **GOOD** | `React.lazy` on all 9 user + 16 admin routes |
| Vendor chunk separation | **GOOD** | react 228 KB / supabase 208 KB split out |
| Admin/user bundle separation | **GOOD** | separate Vite builds; source-import ban asserted |
| Image delivery | **GOOD** | Google CDN; `loading="lazy"`, `decoding="async"`, `fetchPriority`; thumb `w1600` vs full `w2560`; **CLS 0.0000**; median image 102 KB |
| HTTP caching + service worker | **GOOD** | `/assets/*` immutable 1 y; `/sw.js` must-revalidate; 38 precache entries / 691 KiB; images runtime-cached only. Re-viewing images cost **0 requests** |
| DB indexes on hot paths | **GOOD** | every per-user progress/attempt/point/state path is covered |
| N+1 queries | **GOOD** | none found; admin services batch with `Promise.all` and chunked `.in()` |
| Polling / realtime | **GOOD** | one 60 s local flush; no realtime subscriptions |
| `scenes` has no ordering/status index | **WARNING** | moot — the query has no filter and no sort, and the table is ~109 rows |
| `useSettings` duplicate concurrent fetch | **WARNING** | `settings?key=eq.app` fetched twice on `/darshan` and `/welcome` |
| `admin/vite.config.js` `__dirname` | **WARNING** | build warning on every admin build; breaks on a future Vite major |
| **Entry chunk carries `content/darshan.json`** | **RISK** | `App.jsx:4` → `lib/learning.jsx:5` → `lib/scenes.js:12` → 59,974 bytes. The built entry contains 219 `lh3` strings; `DarshanPage-*.js` contains zero. **Every visitor downloads the full 109-scene manifest to reach the login screen.** This is the cause of the failing bundle budget, and it directly contradicts `App.jsx`'s own comment |
| **`useScenes` refetches the whole table on every mount** | **RISK** | 8 call sites, `useEffect(…,[])` per instance, no cache. Home → /darshan → /level/3 → /level/4 = 4 full-table reads of the same 109 rows. `useNavigation.js:111` already solves exactly this with a shared module promise |
| **400-500 concurrent users** | **RISK — NOT VERIFIED** | **No load test exists anywhere in this repository.** No DB credentials, so nothing can be measured against a live backend |
| **CI does not run any test suite** | **RISK** | `.github/workflows/ci.yml` runs build → verify:separation → negative-build → verify. `npm test` is absent |

**Critical path:** ~591 KB raw / **~166 KB gzip** before first paint, of which ~15 KB gzip is a manifest the login screen does not need.

**Ranked bottleneck estimate, from code evidence only:**
1. PostgREST request volume from `useScenes` — 500 users × ~5 page visits ≈ 2,500 full-table reads that one module-level promise would reduce to ~500. Highest-confidence hotspot.
2. First-load bandwidth, not server CPU.
3. **Not the images** — served by Google's CDN, so they do not scale against this project's infrastructure at all.
4. **Not the indexes** — hot per-user paths are all covered.

---

# SECTION 9 — DATA / CONTENT FINDINGS

**The "109 / 110 content, missing 106 and 110" hypothesis is not supported by the data.**

Read directly from `content/darshan.json`:

```
records: 109      keys: [id, n, order, t, driveId, url, fullUrl, file]
n: min 1, max 109, count 109
n gaps: []                    ← none
duplicate n: []   duplicate ids: []
order defined on 109/109      index defined on 0/109
missing caption (t): 0        missing url: 0        active:false: 0
```

All 109 pass `isLearnable`, so `displayIndex` runs 1…109 with no holes today.

**Identity vs display order is correctly separated into four concepts:**

| Concept | JS field | DB column | Mutable |
|---|---|---|---|
| Identity | `id` (`darshan-001`) | `scenes.id` | never |
| Printed source number | `n` / `sourceIndex` | `scenes.index` | admin |
| Presentation position | `order` | `scenes."order"` | admin, drag-and-drop |
| Displayed number | `displayIndex` | **none — derived on read** | derived |

**Deleting an item cannot corrupt numbering.** `displayIndex` is a counter re-derived over surviving entries; withheld entries stay in the array with `displayIndex: null`. `darshan_reorder(p_ids)` writes `"order"` and nothing else, as a park-then-write permutation inside one transaction, so the partial unique index never sees a mid-permutation collision. Progress rows, `level4_activity_items` and attempts all reference scenes by stable `id`.

**Ordering is consistent across Darshan, Level 3, Level 4, admin, import and export** — all read `displayIndex` from a single `withDisplayIndex()` applied once in `useScenes`. Three deviations, all currently harmless:

- `src/lib/scenes.js:16` sorts without an `id` tiebreak (not a total order, unlike the canonical comparator).
- `src/lib/scenes.js:29-40` `inOrder()`/`ORDER_OF` is built from the manifest only and ignores the admin overlay entirely.
- `scripts/verify-gallery.mjs:37` reimplements the ordering rule a third time — it will silently disagree the day an overlay row reorders anything.

**Content is served from BOTH the bundled JSON and the DB.** `content/darshan.json` is the base record, statically imported into the client; `public.scenes` is a **sparse admin overlay** (no migration seeds it; the panel writes only rows it edits). If the overlay query fails or the user is signed out, the app silently falls back to the pure manifest. The JSON is not dead — the app cannot render without it — but it is a build artefact regenerated by `npm run darshan`, and **there is no runtime freshness check against Drive or the sheet.**

**Google Drive is the production image CDN, not merely an import source.** `netlify/functions/list-drive-folder.js` only *lists* the folder — it downloads no bytes. The URL written to `scenes.image_url` is `https://lh3.googleusercontent.com/d/{id}=w1600-rj-v1` (`drive.js:141`), and that is exactly what the user's browser fetches. `drive.google.com` URLs are explicitly refused. There are no local darshan images — `public/` holds only two icons. **Availability of the product's artwork is a function of that Drive folder's "Anyone with the link" setting.** Every such `<img>` correctly carries `referrerPolicy="no-referrer"`, which is required because lh3 throttles per referrer.

**Universal naming holds.** The admin import matches strictly on the sheet's `ફોટો ફાઇલ` cell against the live Drive listing; tolerances are only extension-strip, lowercase, and separator-strip, and the loose match is used only when it resolves to exactly one file. **There is no index→filename derivation anywhere in the browser path.** The only filename-pattern table is `scripts/lib/naming.mjs:33-39`, in the offline build script, and it is a documented *second* pass that runs only when the declared cell names nothing on disk.

**Content bug:** `shared/domain/sheet-import.js:476` — once a loose key is marked ambiguous the map holds `null`; a **third** file sharing that key evaluates `null.id` and throws a `TypeError`, killing `indexDriveFiles` and therefore the whole "Read the Drive folder" step. Reachable with e.g. `Varni(1).png`, `Varni (1).png`, `varni_1.png` in one folder.

**Documented but not built:** `EXCEL_CONTRACT.md:135` describes a warning for "Drive file ID names a file not present in the folder". `attachDriveReferences` validates shape only and never consults the Drive index — a well-formed but wrong id imports silently and yields a broken image.

---

# SECTION 10 — TEST RESULTS

All commands were run for real. Output is reported as received.

| Command | Exit | Result |
|---|---|---|
| `npm test` | **0** | **1,038 passed, 0 failed, 0 skipped** |
| ├ `test-domain.mjs` | 0 | 305 passed |
| ├ `test-level4.mjs` | 0 | 153 passed |
| ├ `test-darshan-excel.mjs` | 0 | 192 passed |
| ├ `test-navigation.mjs` | 0 | 206 passed |
| └ `test-viewing-speed.mjs` | 0 | 182 passed |
| `node scripts/test-points.mjs` | 0 | **494 passed** — **not in `npm test`** |
| `npm run build` | **1**, then **0** | Failed at 12:10 on `src/lib/history.js:34` (`**/` terminates a JSDoc block, 3 occurrences). Fixed externally by 12:13; clean thereafter, no chunk-size warnings, no source maps |
| `npm run verify:separation` | **1** | **1 real failure** (below) |
| `npm run verify:mobile` | 0 | 186 passed |
| `npm run verify:admin` | 0 | 47 passed |
| `npm run verify:gallery` | 0 | `GALLERY ACCEPTED`, 0 page errors |
| `npm run verify:nav` | 0 | 139 passed |
| `npm run verify` | 0 | `ALL CHECKS PASSED`, CLS 0.0000, median image 102 KB |
| `node scripts/verify-flow.mjs` | 0 | 25 passed |

The one genuine failure, against a clean production build:

```
[4] યુવક bundle budget
      યુવક js+css: 689 KB   ·   સંચાલક js+css: 808 KB
  PASS  યુવક bundle within 720 KB — 689 KB
  FAIL  યુવક entry chunk is app code only — 122 KB     (threshold: < 60 KB)
```

An earlier `VITE_PUBLIC_DARSHAN` failure was an artifact of a stale test-mode `dist/` and does **not** reproduce on a fresh production build.

### Coverage map

| Area | Covered by | Depth |
|---|---|---|
| Auth (login/register/session) | — | **NONE** |
| RBAC / permissions | module imported, no role assertions run | **near-zero** |
| Route guards / entry state | `test-domain.mjs` | unit-domain |
| Level 1 | `verify-flow.mjs` | unit-domain |
| Level 2 / દર્શન | `test-domain.mjs`, `verify-loading.mjs`, `verify-gallery.mjs` | domain + **e2e** |
| Gallery | `verify-gallery.mjs` | **e2e** |
| Level 3 | `test-domain.mjs` | unit-domain |
| Level 4 | `test-level4.mjs` (153) | unit-domain |
| Unlock / repeat | client-side resolver only; `level4_gate_open()` untested | unit-domain |
| History / Attempts / Points | `test-points.mjs` — **not in the runner** | unit-domain |
| **Security / RLS** | — | **ZERO** |
| Content / Excel | `test-darshan-excel.mjs` (192) | unit-domain, very deep |
| Admin panel | separation + mobile verifiers | build artifact + layout only |
| Navigation | `test-navigation.mjs`, `verify-nav.mjs` | domain + **e2e** |
| Performance | `verify-loading.mjs` | e2e, single user |

**Zero coverage:** authentication, RLS/authorization, every Postgres function (`activity_submit`, `level4_submit`, `level4_state`, `my_point_summary`, `darshan_reorder`), admin services, error/offline paths, concurrency.

**Verdict: broad and disciplined where it exists, structurally blind where it matters most.** 1,532 assertions pass and the domain modules are genuinely well covered. But every assertion is pure JS against in-memory data — **not one line of SQL, not one RLS policy, and not one authentication path is exercised by anything in this repository**, and the entire authorization model of the product is RLS. On top of that, CI skips the test suites entirely: a commit that breaks every domain test goes green.

Two verifiers are also weaker than they appear:
- **`verify-admin-mobile.mjs` effectively tests one page.** The run is unauthenticated and its 11-width loop navigates to `/admin/` only — so what is measured at eleven widths is the **login screen**. 17 of 18 admin pages are never rendered at any width. Its deep-link assertion checks for `#admin-root`, a static element in `admin/index.html:19`, so it passes even if React never mounts.
- **`verify-admin-separation.mjs`: 4 of 9 leak markers cannot fail.** Two occur zero times in `admin/src`; two are identifier names the minifier renames — violating the file's own stated rule that markers must be string literals.

---

# SECTION 11 — IMPLEMENTED (confirmed from code)

**Auth & RBAC** — register, email login, mobile-number login via a Netlify function that never leaks the email, session persistence and refresh, logout; 5 roles and 17 permissions with SQL and JS matrices verified identical; server-side enforcement through RLS on every table and permission re-checks inside every mutating RPC.

**Level 1** — YouTube-nocookie embed with correct `playsinline`/fullscreen/permission policy, admin-configurable URL, two required questions with a disabled-until-both button, answers persisted, replay mode.

**Level 2** — direct optimized images from Google's CDN (no PDF anywhere), image + વર્ણન + number per card, 6-card progressive batching with `IntersectionObserver`, `loading="lazy"` + `decoding="async"`, three-attempt jittered exponential image retry with a dead state and auto-retry on scroll re-entry, CLS held at zero by a CSS aspect-ratio box.

**Gallery** — fullscreen viewer, left/right by button, arrow key and swipe, always-visible index number, `N / total` counter, dark background, focus trap, body-scroll lock, history-back close, neighbour preloading with `fetchPriority` and `saveData` respect, opt-in slideshow with a DB-backed admin interval (1-60 s, bounds enforced by a trigger) plus a per-user 2-30 s local override.

**Level 3** — number + વર્ણન + checkbox with no image and no image byte requested; admin-configurable threshold in a single source of truth; ticks persisted to localStorage immediately and flushed to Postgres within 60 s with a keepalive on page-hide; IST midnight rollover with a floor so a cleared browser cannot lower the day's score.

**Level 4** — dynamic admin-created sub-activities with explicit membership lists (arbitrary ranges *and* hand-picked indexes, no fixed chunk size anywhere); exam UI rendering number + checkbox only; pass/fail computed exclusively in SQL after intersecting the submission with the activity's effective items; server-clamped pass mark; sequential unlock enforced server-side against direct RPC calls; unlimited repeat of already-unlocked activities with COMPLETED never demoted; append-only attempts storing the mark in force at the time.

**History & points schema** (uncommitted) — per-day rows with the day inside the primary key and no delete path anywhere; server-computed IST business date; server-assigned attempt numbers made race-safe by a unique constraint plus a bounded retry; an idempotency token with a partial unique index; a derived daily rollup that is recounted rather than incremented; points that are server-authoritative, revoked from every client role, and paid at most once per day by a unique constraint.

**Content management** — a 315-line dependency-free xlsx parser handling ZIP inflate, shared strings, multi-run cells and numeric entities; 12 bilingual columns; three import modes with per-row conflict resolution; strict filename matching against the sheet's declared column; whole-collection reorder by drag-and-drop and arrow keys through a transactional RPC; CSV export with BOM and formula-injection guard.

**Admin panel** — 19 routes, every one backed by a real table or RPC; consistent four-state loading/error/empty handling through a shared `StateBlocks` + `useAsync` layer; audit log with field-level diffs; mobile responsiveness with table→card conversion and coarse-pointer tap floors.

**Shell** — DB-driven bottom navigation that the user app genuinely reads and honours at runtime, with routes that can never come from the stored row; safe-area-aware sizing; PWA with correct `skipWaiting`/`clientsClaim` and cache headers, images deliberately excluded from precache.

---

# SECTION 12 — PARTIALLY IMPLEMENTED

| Item | What exists | What is missing |
|---|---|---|
| Level 3 threshold enforcement | evaluated server-side in `level4_gate_open()` | its input `progress.level3_score` is client-writable, so the gate is soft |
| Level 1 completion | like/comment answers persisted | nothing records that the video was actually watched |
| દર્શન page | navigation, images, retry | no error state, no empty state |
| દર્શન card | image, વર્ણન, number | `શીર્ષક` — the page promises one at `journey.js:190` and never shows it |
| Gallery description | ⓘ control is permanent | the **text** is collapsed by default and hideable, against requirement |
| Level 4 editor | full sub-activity CRUD, ranges, hand-picking | `requiredCount` dropped on create; Archive/Restore enabled on PUBLISHED versions the DB always refuses |
| Level 4 revision RPC | re-checks auth/active/published/gate/sequence | never received 0017's "already passed" exemption, so it can refuse an activity `level4_submit` accepts |
| Admin Progress page | learning_state + two reports | no day-by-day score report, and the page tells the admin daily scores are not being saved — which is now false |
| Darshan detail page | five separately-confirmed saves | no client-side `can()` check; RLS-only, unlike every other write surface |
| Login redirect | `state.from` written on every guard redirect | `Login.jsx:101` never reads it — the stated goal at `App.jsx:172` is not kept |
| `verify-admin-mobile.mjs` | real Chrome, 11 widths | measures only the login screen; not in `test`, `check`, or CI |
| `verify-admin-separation.mjs` | strong budget + secret scanning | 4 of 9 leak markers cannot fail |
| Drive import | full listing + matching workflow | `TypeError` on a third loosely-colliding filename kills the folder read |

---

# SECTION 13 — MISSING

- **Leaderboard** — no table, view, RPC, route, component or admin setting. Only a `ready = false` nav placeholder that the server-side validator refuses to let an admin enable. (Deliberate: `0019:63`, `0020:39-41`.)
- **Roles / admin-management UI** — the panel has no page for `admin_profiles`. Roles are assigned by direct SQL.
- **Day-by-day score reporting** in the admin panel.
- **SMS/OTP proof of mobile-number ownership** — the root of finding F1.
- **Rate limiting** on `login-mobile`.
- **Image upload** — link management only (deliberate; the encoder was removed in 0009).
- **`.xlsx` export** — CSV only (matches the documented contract).
- **Drive-id-not-in-folder validation** — documented in `EXCEL_CONTRACT.md:135`, not built.
- **Any test touching SQL, RLS, or authentication.**
- **Any load test.**
- **`npm test` in CI.**

---

# SECTION 14 — BROKEN

| # | Item | Evidence |
|---|---|---|
| 1 | **HEAD does not build.** `src/App.jsx` (tracked) imports `AppShell`, `BottomNav`, `NavIcon` (all untracked) | `App.jsx:8,81,100` vs `git ls-files src` |
| 2 | `sheet-import.js:476` — `null.id` `TypeError` on a third loosely-colliding filename, killing the entire Drive folder read | `if (loose.has(l) && loose.get(l).id !== f.id)` |
| 3 | Level 4 `requiredCount` silently dropped when creating a new sub-activity — reverts to "all of them" after reload | `Level4EditorPage.jsx:251-256` vs `level4Service.js:266` |
| 4 | Archive/Restore buttons enabled on a PUBLISHED Level 4 version, which `level4_guard_editable()` always refuses | `Level4ListPage.jsx:498-516` vs `0010:1214-1216` |
| 5 | `ProgressPage.jsx:507-519` tells the admin on screen that no daily score is being saved. `progress.js:339` upserts it and `HomeRing`/`LevelPage` read it back | — |
| 6 | Gallery વર્ણન hideable and collapsed by default, against the stated requirement | `GalleryViewer.jsx:82` |
| 7 | `/learn` routed with zero inbound links, and inside it `SceneRunner.jsx:99` renders `gu(scene.index)` where manifest records have no `index` key — printing the literal `undefined`; `LearningPage.jsx:32-35` feeds 109 `undefined`s into `MemoryRecall` | verified: 0/109 records have `index` |
| 8 | `verify:separation` fails the entry-chunk budget: 122 KB against a 60 KB threshold | real build output |
| 9 | Cross-tab `level4_score` overwrite (F7) | `progress.js:199` vs `0017:192` |

---

# SECTION 15 — DOCUMENTED BUT NOT IMPLEMENTED

Per the code-over-documentation rule, these documents assert things the code does not do:

| Claim | Where | Reality |
|---|---|---|
| `profiles.mobile` "cannot be self-declared" because a trigger makes it immutable | `shared/domain/constants.js:54-57` | The trigger is UPDATE-only. It **can** be self-declared at registration. This is finding F1 |
| "The answers are not fetched, not merely unread" on the exam page | `ActivityTestPage.jsx:83-86` | `useScenes()` on line 156 statically bundles all 109 descriptions and image URLs. Rendering discipline is sound; the invariant is not enforced |
| "Nothing in this codebase writes `public.progress`" | `reportService.js:32-35`, `0008:47` | `progress.js:338-341` upserts it; `0017:189-193` writes it server-side |
| The panel "writes `status` to suspend or disable" a yuvak | `ADMIN.md:414` | No admin service writes `profiles.status`; `UserDetailPage.jsx:205` says the page is read-only |
| The panel owns `public.admin_profiles` | `ADMIN.md:421` | No admin code touches it; `ADMIN.md:463-465` contradicts it and is the accurate line |
| The panel reads `public.progress` | `ADMIN.md:415` | No admin service queries it |
| "There is deliberately no Level 4 attempts section and no activity timeline" | `UserDetailPage.jsx:36` | Contradicted by `UserActivityPage.jsx` sitting unrouted beside it |
| A points panel that "pre-fills ૧૦૦/૨૦૦/૩૦૦ the moment the સંચાલક switches the system on" | `shared/domain/points.js:137-144` | `PointsCard.jsx` exists but is not mounted |
| A warning for a Drive id naming a file not in the folder | `EXCEL_CONTRACT.md:135` | Not implemented |
| `publish-drive-image-background.js` and a `darshan.publish` permission | `.env.example:21-26` | Neither exists — contradicted by `netlify.toml:13-16` and `0009:56-63` |
| The two apps "never share a session object" | `src/lib/supabase.js:4-5` | They share `localStorage` key `varni.auth` |
| Anything about routing, navigation, PWA, History, Profile or Settings | `PLAN.md` | PLAN.md predates all of it — one hit for "route" in the whole file, in an unrelated sense. **Not usable for these areas** |

---

# SECTION 16 — IMPLEMENTED BUT NOT CONNECTED

This is the largest category by value, and the cheapest to resolve.

### UI exists, no route
| Component | Size | Missing link |
|---|---|---|
| `src/pages/History.jsx` (+ `history.css`, `lib/history.js`) | 12.6 KB | No `/history` route in `src/App.jsx`; no `history` key in `nav_registry()`; the only `ઈતિહાસ` in the UI is a **commented-out** tile at `Home.jsx:252` |
| `admin/.../UserActivityPage.jsx` (+ `activityService.js`) | 21.8 KB | No route in `admin/src/App.jsx` — grep returns zero matches |
| `admin/.../PointsCard.jsx` | 29 KB | `SettingsPage.jsx` never imports it |
| `src/modules/learning/*` — `LearningPage`, `SceneRunner`, `MemoryRecall`, `VideoStage`, `SubmitResult` | 6 files | `/learn` is routed but has **zero inbound links**; `Home.jsx:171` documents that the button was moved off it deliberately |

### Backend exists, no UI reads it
| Object | Since | Status |
|---|---|---|
| `level4_attempts` | 0010 — **deployed** | Written on every Level 4 submit; read by zero lines of client code |
| `activity_attempts`, `daily_activity_progress`, `point_transactions` | 0021 — uncommitted | Read only through the two unrouted pages |
| views `attempt_history`, `activity_history`, `point_ledger`; `my_point_summary()` | 0021 | Same |
| `progress.level4_score` | 0001 | Written by both client and server; displayed nowhere |
| `scenes.title` | 0013 | Column, Excel round-trip and health metric all live; rendered on no user screen |

### Migration exists, application unverified
**Every migration.** No DB credentials. In particular `0018` (slideshow trigger), `0019`/`0020` (navigation), `0021` (history/points) — the last three are untracked, so they are almost certainly **not** applied to any live database.

If `0021` is not applied, the failure is **silent**: `guHistoryError` degrades to "નોંધ હમણાં ખૂલી નથી", `usePointSummary` reports zero, and Level 1/2 history submission is fire-and-forget with `.catch(() => {})` — so it is lost with no signal at all.

### Dead schema
`level4_configs.require_gate` and `.gate_threshold` were superseded by `settings['levels'].level4Gate` in 0014 and stamped `NO LONGER READ` — but `createConfig()` still writes an authoritative-looking `80` into them (`level4Service.js:199,214-215`).

### Dead exports
`settingsService.getLevels`/`updateLevels`, `level4.js:activityCode`, `level4-selection.js:findDuplicates`/`findMissing` (test-only), `useNavigation.js:clearNavCache` (no caller — the admin panel is a separate Rollup graph and cannot import it), `index.css:109` styles a `<footer>` no component renders.

---

# SECTION 17 — PRODUCTION BLOCKERS

## P0 — must fix before launch

| # | Blocker | Why |
|---|---|---|
| **P0-1** | **Commit the working tree.** `App.jsx` imports three untracked files; HEAD does not build | There is no deployable state. Everything else is moot until this is true |
| **P0-2** | **Verify F1 out of band.** Confirm all three mobile numbers in `0004_rbac.sql:137` already have `profiles` rows | If any is unregistered, one public registration form submission grants SUPER_ADMIN over every user's data |
| **P0-3** | **Verify the live migration state, then decide the 0012 hazard.** Either add an out-of-order guard to `db.mjs` or rename `0012_level4_repeat_access.sql` to sort after 0017 | A replay silently reverts `level4_submit`, breaking the admin pass mark with no error and a UI/server disagreement |
| **P0-4** | **Apply 0019/0020/0021, or remove the code that calls them** | If 0021 is missing, Level 1/2 history is lost silently — `.catch(() => {})` on a fire-and-forget call |
| **P0-5** | **Add `npm test` to CI** | 1,532 assertions never run on push. A commit breaking all of them goes green |
| **P0-6** | **Fix `sheet-import.js:476`** | A `TypeError` takes down the whole Drive import for a realistic filename collision |

## P1 — should fix before launch

| # | Item | Why |
|---|---|---|
| **P1-1** | Rate-limit `login-mobile` on the number **and** `x-nf-client-connection-ip` | Fixes F3 and F4 together: enumeration of ~2,000 numbers, unlimited guessing, and a shared-bucket DoS on the primary login route |
| **P1-2** | Move `content/darshan.json` off the eager path (make `LearningProvider` lazy) | Fixes the failing budget and removes ~15 KB gzip from every login-screen visit. One-line class of change |
| **P1-3** | Give `useScenes` the shared module-promise cache `useNavigation.js:111` already uses | Highest-confidence scaling hotspot at 400-500 users |
| **P1-4** | Add an idempotency token to `level4_submit` | Double-click, retry, or second tab each create a duplicate attempt row |
| **P1-5** | Fix the cross-tab `level4_score` overwrite (F7) | Silent data loss in committed code |
| **P1-6** | Route `/history` and mount `PointsCard`, or delete them | Three finished features currently deliver nothing |
| **P1-7** | Add error and empty states to `DarshanPage` | Level 2 is on the mandatory path with neither |
| **P1-8** | Make the gallery વર્ણન always visible | Stated requirement; currently collapsed by default |
| **P1-9** | Fix Level 4 `requiredCount` on create, and disable Archive/Restore on PUBLISHED | Both are silent or guaranteed-to-fail admin actions |
| **P1-10** | Correct `ProgressPage.jsx:507` | It states a falsehood to the admin |

## P2 — after launch

Render `scenes.title` (or drop the promise from `journey.js:190`) · wire `state.from` in `Login.jsx` or delete it · resolve the `/welcome`-outside-`AppShell` navigation trap · delete or link `/learn` (and fix `scene.index` printing `undefined`) · surface `level4_attempts` somewhere · align `level4_mark_revision` with `level4_submit` · add `is_active_user()` to the profile write policy (F8) · restrict `audit_logs` INSERT to `audit.read` holders (F5) · Roles admin UI · day-by-day score report · fix the 4 no-op separation markers and make `verify-admin-mobile` authenticate · `scripts/test-points.mjs` into `npm test` · correct the documentation listed in Section 15.

---

# SECTION 18 — NEXT DEVELOPMENT PLAN

Ordered. Do not start a later task before an earlier one is green.

### 1 — Commit and establish a buildable baseline
**Why:** nothing can be verified, deployed or rolled back until one commit builds.
**Files:** the 121 uncommitted paths, in coherent groups (shell / history+points / navigation admin / migrations).
**DB:** none. **Risk:** low. **Depends on:** nothing. **Complexity:** S — but do it first.
**Done when:** `git stash -u && npm ci && npm run build` succeeds from a clean checkout.

### 2 — Establish live database ground truth
**Why:** this audit could not verify a single applied migration, and three of the most important are untracked. Every downstream decision depends on knowing what is actually there.
**Command:** `SUPABASE_DB_PASSWORD=… node scripts/db.mjs query "select name, applied_at from public.schema_migrations order by name"`, plus `select count(*) from public.profiles where mobile in ('9601269715','9601269009','9925842081')`.
**Risk:** read-only. **Complexity:** S.
**Done when:** you have the applied list and the F1 answer written down.

### 3 — Close F1
**Why:** HIGH severity, and the only finding that is one form submission from full compromise.
**Files:** `supabase/migrations/00NN_profiles_mobile_insert_guard.sql` (new), possibly `0004_rbac.sql`'s bootstrap.
**DB:** a BEFORE INSERT trigger on `profiles`, or replace the mobile-literal bootstrap with an `admin_profiles` seed row.
**Risk:** medium — touches registration. Test that a normal signup still works.
**Depends on:** 2. **Complexity:** M.

### 4 — Fix the migration ordering hazard
**Why:** a silent `level4_submit` downgrade that makes the UI and the server disagree about the pass mark.
**Files:** `scripts/db.mjs` (add a high-water-mark refusal), or rename `0012_level4_repeat_access.sql`.
**Risk:** renaming changes the `schema_migrations` key — only safe if step 2 confirms it is already applied.
**Depends on:** 2. **Complexity:** S.

### 5 — Apply 0019/0020/0021 and remove the silent-failure paths
**Why:** the history/points system is called by code that swallows its own failure.
**Files:** the three migrations; `src/pages/EntryGate.jsx:106`, `src/modules/darshan/DarshanPage.jsx:75` (the `.catch(() => {})` calls).
**Risk:** medium — 0021 creates three tables and is not idempotent; it must apply cleanly the first time.
**Depends on:** 1, 2, 4. **Complexity:** M.

### 6 — Wire the three finished-but-unconnected features
**Why:** highest value per hour in the whole plan — the work is already written and tested.
**Files:** `src/App.jsx` (add `/history` + lazy import), `shared/domain/navigation.js` + `0019`/`0020` nav registry (add a `history` key), `admin/src/App.jsx` (add the user-activity route), `admin/.../SettingsPage.jsx` (import `PointsCard`), `Home.jsx:252` (uncomment the tile).
**DB:** one nav-registry row.
**Risk:** low. **Depends on:** 5. **Complexity:** S.

### 7 — Security hardening
**Why:** F3+F4 are one fix; F5 and F8 are one-line policy changes.
**Files:** `netlify/functions/login-mobile.js` (throttle on number + `x-nf-client-connection-ip`); a migration for the `audit_logs` INSERT policy and `is_active_user()` on the profile write policy.
**Risk:** low-medium. **Depends on:** 1. **Complexity:** M.

### 8 — Performance: entry chunk and `useScenes`
**Why:** the only two items standing between this and comfortable 400-500 user headroom.
**Files:** `src/App.jsx:4` / `src/lib/learning.jsx:5` (make the provider lazy); `src/lib/useScenes.js` and `src/lib/useSettings.js` (adopt the module-promise cache from `useNavigation.js:111`).
**Risk:** low — `verify:separation` will confirm the budget passes.
**Depends on:** 1. **Complexity:** S each.

### 9 — Correctness fixes
`sheet-import.js:476` (optional chaining + early continue) · `level4_submit` idempotency token, mirroring `activity_submit`'s design · client `greatest()` on `level4_score` or drop the field from the payload · Level 4 `requiredCount` on create · Archive/Restore disabled on PUBLISHED · `DarshanPage` error and empty states · gallery વર્ણન always visible.
**Risk:** low individually. **Depends on:** 1. **Complexity:** S-M each.

### 10 — Close the testing blind spot
**Why:** the product's entire authorization model is RLS, and not one test touches it.
**Files:** `.github/workflows/ci.yml` (add `npm test`); `package.json:16` (add `test-points.mjs`); a new integration suite that signs in as two real users and asserts user A cannot read user B's rows.
**Risk:** low. **Depends on:** 1, 2. **Complexity:** M-L.

### 11 — Load test
**Why:** the 400-500 user question is currently unanswerable. Nothing in this repository measures it.
**Depends on:** 8. **Complexity:** M.

### 12 — Documentation reconciliation
Correct every item in Section 15. **Complexity:** S.

---

# PRODUCTION READINESS VERDICT

## **NOT READY**

Not because the application is weak — the engineering is above average and in places genuinely excellent — but because of three facts that are individually disqualifying:

1. **There is no deployable commit.** HEAD does not build. Every claim of "done" in this report describes a working tree that exists on one machine.
2. **One HIGH security finding is unresolved and unverifiable from here.** If any of the three bootstrap mobile numbers is unregistered, a public form grants full administrative access to ~500 users' data. That question takes one SQL query to answer and must be answered before launch.
3. **Nothing verifies the authorization model.** 1,532 tests pass; none executes a policy. CI does not run them at all. The suite proves the domain logic is right; it cannot tell you whether the database will let the wrong person read the right rows.

Add that behaviour at 400-500 concurrent users is **NOT VERIFIED UNDER 400-500 CONCURRENT USERS** — no load test exists in this repository — and the honest verdict is NOT READY.

**The distance to READY WITH WARNINGS is short.** Steps 1-6 of the plan above are mostly commits, one migration run, and about a dozen import lines. None of them requires designing anything new. Three complete features are sitting one route each away from working.

---

*This report describes the repository at 2026-08-13. The working tree was being edited during the audit; re-verify before acting on any specific line number. No file was modified in producing it.*
