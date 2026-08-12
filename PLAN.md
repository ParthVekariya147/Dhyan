# વરણી ધ્યાન — Varni Dhyan Web Application

> ⚠️ **Backend changed after this was written.** The app now runs on **Supabase
> (Postgres + RLS)**, not Firebase. Everything below about Firestore rules, read quotas,
> `smkIndex`, custom claims and the §12 write strategy describes the *previous* design and
> is kept only as the reasoning trail. What is live:
>
> - schema and policies — `supabase/migrations/`
> - admin authorisation — `public.is_admin()`, not a custom claim
> - SMK uniqueness — a `UNIQUE` constraint, not a claim document
> - §12's read-budget gymnastics — **no longer needed**; Postgres has no per-read quota
>
> The four founding rules (§1), the four levels (§7), the midnight reset (§9), the
> no-streaks rule (§10) and the admin dashboard requirements (§11) are unchanged — they
> are product decisions, not storage ones.

**Plan v3** · 2026-08-11 · supersedes v2

Rewritten against the actual requirement document
(`Varni_Dhyan_App_Requirement.pdf`, 9 pages, યુવાસભા — સુરત ઝોન), which I could finally
read. **v1 and v2 were built on guesswork and got several things wrong.** This version
follows the spec.

---

## 1. What this actually is

Not a gallery. It is a **daily meditation practice (સાધના)** for ~2,000 yuvaks in Surat.

> નીલકંઠ વર્ણીનાં **૧૦૮** દિવ્ય દ્રશ્યો ક્રમ પ્રમાણે યુવકોના હૈયામાં વસી જાય — એ આ એપ્લિકેશનનો મુખ્ય હેતુ.

The design principle is **progressive removal of memory support**: first the picture,
then only the words, finally only the number. The yuvak sits daily, brings each scene to
mind in order, and watches his own progress. The end goal is to offer this dhyan to
saints when they visit.

**Four founding rules, from §1 of the spec:**

1. યાદશક્તિનો ટેકો ધીરે ધીરે ઘટાડવો — picture → word → number only
2. ક્રમ કદી તૂટે નહીં — every stage runs 1 → 108 in order
3. રોજ નવેસરથી — the સાધના is never "finished"
4. **ફક્ત આનંદ, નિરાશા નહીં** — no scolding, no red marks, no negative message anywhere

| | |
|---|---|
| Users | ~2,000 yuvaks |
| Scenes | **108** |
| Zone | સુરત |
| Subzones | **વેડરોડ · વરાછા · નવસારી** |
| Language | entirely Gujarati — buttons, errors, everything |
| Device | mobile-first (desktop must also work) |
| Admins | **9601269715**, **9601269009** (phone numbers) |

---

## 2. Decisions taken, and one open gap

### 2.1 Login — ✅ DECIDED: email + password, with mobile as an alternate login

Overrides the spec's Phone OTP (§4). No SMS, no OTP, so no Blaze needed for auth.

**Registration collects:** SMK · નામ · **email** · **password** · મોબાઈલ · ઝોન · સબઝોન
**Login accepts either:** mobile + password **or** email + password.

**Design — Firebase Auth identity is the real email.** That choice matters:

| | |
|---|---|
| Email + password login | direct `signInWithEmailAndPassword` — no lookup |
| Mobile + password login | resolve mobile → email, then sign in |
| **Password reset** | works natively, mail goes to the yuvak's real inbox |

*A synthetic auth email derived from the phone (`919876…@varni.app`) would remove the
lookup entirely — but Firebase would then send password resets to an address that does
not exist. With ~2,000 yuvaks, forgotten passwords are certain, so the real email must
be the identity.*

⚠️ **Resolve mobile → email server-side, via a Netlify Function.** The obvious approach —
a world-readable `phoneIndex` collection — must be readable *before* the user is
authenticated, so anyone could enumerate phone numbers and harvest emails. Since we are
already on Netlify, a serverless function using the Firebase Admin SDK does the lookup
privately (free tier: 125k invocations/month), and nothing is publicly readable.
*Simpler fallback if that proves awkward: public `phoneIndex` + Firebase App Check,
storing only the email in the doc.*

**Email verification:** send Firebase's verification link on signup, but **do not block
login on it**. Many yuvaks barely use email and links land in spam; §1 of the spec
demands no friction and no negative experience. Show a gentle reminder instead — the
verified address matters mainly so password reset works.

**One consequence worth naming:** the spec's flow asked returning yuvaks for *only
mobile + OTP* — nothing to remember. Passwords shift that burden onto ~2,000 young
users, so a working password-reset path is not optional here, it is essential.

### 2.2 Hosting — ✅ DECIDED: Netlify

Per spec (§2) — the current site already lives there. Free tier is **100 GB/month**;
~2,000 daily yuvaks at ~1 MB/session ≈ 60 GB, which fits with some headroom. The
`public/_headers` file already written is Netlify-compatible as-is, and Netlify
Functions now also carry the mobile→email lookup above.

Worth watching: if bandwidth approaches the cap, moving to Cloudflare Pages is a DNS
change, not a rewrite.

### 2.3 Scene count — ⛔ STILL OPEN, and the numbers moved: 109 masters vs a spec that says 108

The spec says **108** throughout, and `TOTAL_SCENES` in `shared/domain/constants.js` is
108. The સંચાલક's Drive folder holds **109** finalised 3840×2160 PNG images, `Varni(1).png`
… `Varni(109).png`, and the sheet has 109 rows to match.

⛔ **109 is one more than the spec asks for, and nothing in this repository explains why.**
It is not a rounding of "100 ready + 8 pending" — that would be 108. It could be an extra
scene the સંચાલક added, a duplicate, or an off-by-one in the numbering of the Drive
folder. **This needs the admin to confirm which**, and the answer decides whether
`TOTAL_SCENES` becomes 109 or one master is withdrawn. It is deliberately not resolved
here: guessing would silently change what every progress ring is counted out of.

The વર્ણન gap that used to sit beside this is **closed**: the sheet now carries all 109, and
`npm run darshan` reports *વર્ણન + image: 109 · image, no વર્ણન: none*. Only the 108-vs-109
question above is still open. See §12.

---

## 3. Status — what is built and verified

**Phase 0 (foundation) and the Level 2 દર્શન module are done**, on Vite + React 19 +
Tailwind v4, with the original page's design ported intact.

### Images — served by Google, not by us

The spec (§7) is explicit: **"ચિત્રની ક્વોલિટી ઊંચી જ રહેવી જોઈએ — ઓછી કરવાની નથી."**

That is still the rule, and it is now met without a local encoder at all. Every દ્રશ્ય is one
URL pointing at `lh3.googleusercontent.com` — Google's image CDN, the same infrastructure that
serves Drive's own previews — and the suffix on that URL is what asks for a width and an
encoding. Measured on દ્રશ્ય ૧, whose master is a 3840×2160 PNG:

| URL | What comes back |
|---|---|
| `=w1600` | 1600×900 **PNG**, 1606 KB — the master's own format |
| `=w1600-rj` | 1600×900 JPEG, 249 KB |
| **`=w1600-rj-v1`** | 1600×900 JPEG, **132 KB** — what the app uses |
| `=w1600-rw-v1` | 1600×900 WebP, 95 KB — smaller, but needs format negotiation |

Twelve times smaller than the PNG, no visible loss, and the whole apparatus is a string.
JPEG rather than WebP because a single `<img src>` has no format negotiation, so the one URL
has to be one every browser can decode. `shared/domain/drive.js` documents each part and what
it costs to drop it.

**What this replaced, and why.** The previous pipeline fetched 549 MB of masters into
`assets/masters/`, then re-encoded all 109 into six widths × three formats, binary-searching
each for the lowest quality still above SSIM 0.985. The engineering was sound and the result
was not usable: the last full run reported **~13 hours remaining** and was killed after 12
images. `content/darshan.json` therefore held 12 entries, and the app showed 12 દ્રશ્યો out of
109 — for weeks, with nothing on screen to say why. A pipeline that cannot finish is not a
slow pipeline; it is a broken one.

Nothing image-shaped is in the repository now. No `assets/masters/`, no `public/darshan/`, no
`sharp`, no encode cache, no publish function, no storage bucket in use. `dist/` is 1.9 MB.

**The whole build is one command:**

```bash
npm run darshan     # sheet (વર્ણન + ક્રમ) + Drive folder (ids) -> content/darshan.json
npm run validate -- --fetch    # proves all 109 links still serve real images
```

Ten seconds, and it reported `વર્ણન + image: 109 · binding via: declared 109`.

### Delivery — measured in real Chrome

`npm run verify` drives Chrome against the built site. Current numbers, not historical ones:

| | Original page | Now |
|---|---|---|
| Initial load (no scroll) | 25.2 MB, all 100 images | **0.54 MB, 6 images** |
| Median image on the wire | — | **102 KB** |
| Whole collection, if fully scrolled | 25.2 MB | **11.0 MB** (109 images) |
| Reopen after closing | 25.2 MB again | **0 requests, 0 KB** |
| Layout shift (CLS) | — | **0.0000** |

22 checks, all passing. Among them: every request carries the re-encode suffix, nothing comes
back as PNG, the feed uses no `<picture>` and no `srcset`, and the lightbox asks the CDN for
`w2560` rather than stretching the `w1600` file the card already has.

CLS stays at zero without width/height attributes because nothing here measures a remote
file: `.frame` and `.scene-frame` reserve their box with `aspect-ratio: 16 / 9` in CSS, and
`object-fit: contain` letterboxes anything that is not 16:9 rather than cropping it.

⚠️ **`vite preview` cannot test caching** — it ignores `public/_headers` and sends
`Cache-Control: no-cache`. Use `scripts/serve-dist.mjs`, which mirrors production.

---

## 4. The four levels (§7) — the heart of the app

| Lv | નામ | Shows | Tick? | Counted? | Always open? |
|---|---|---|---|---|---|
| 1 | વિડિયો દર્શન | the whole YouTube video | no | no | yes |
| 2 | **PDF દર્શન** | image + વર્ણન below + number at right | no | no | yes |
| 3 | વર્ણન યાદી | number → વર્ણન → checkbox (no image) | **yes** | **yes** | yes |
| 4 | ફક્ત નંબર | number only → checkbox | **yes** | **yes** | **locked at first** |

- **Level 2 is what is already built** — image, caption strip beneath, number at the
  right. No text on the image, no checkboxes, 1→108, calm viewing.
- **Level 3** — reads the વર્ણન, brings the scene to mind, ticks. Each tick advances the
  progress ring immediately. The day starts here.
- **Level 4** — number alone. A **'જવાબ જુઓ'** button reveals that scene's વર્ણન, and
  ticking is still allowed afterwards — no restriction.
- **Level 4's lock:** opens when **80/108 or more ticks happen in a single day at
  Level 3**. Once opened it stays open forever. While locked: a lock icon and
  *'લેવલ ૩ માં ૮૦ પૂરાં કરો, પછી આ ખૂલશે'*.

---

## 5. Rules that shape the whole design

### Daily reset (§9)

| When | What happens |
|---|---|
| **રાત્રે ૧૨:૦૦** (Asia/Kolkata) | all Level 3 & 4 ticks clear automatically |
| before that | the day's result is saved permanently to history |
| next day | the yuvak starts again from Level 3 |

Levels 1 and 2 are exempt — they are learning aids, open any time.
There is **no 'પૂરું કરો' button**; whatever is ticked is saved continuously, and closing
the app mid-way loses nothing.

### ⛔ No streaks — explicitly forbidden (§10)

> સળંગ દિવસની ગણતરી (streak) રાખવાની નથી. કોઈ દિવસ ચૂકે તો કંઈ તૂટે નહીં.

**v1/v2 had `streak` and `longestStreak` in the data model. Both are removed.**
'કુલ કેટલા દિવસ કર્યું' only ever increases — it never resets or decreases.

### Only encouragement (§1, §10, §14)

- Calendar: days meditated are **golden**; missed days are simply **empty** — no red, no
  negative mark of any kind.
- Every morning, a short warm message:
  *જય સ્વામિનારાયણ! ગઈકાલે તમે ૮૮/૧૦૮ દ્રશ્યો યાદ રાખ્યાં હતાં. આજનું ધ્યાન શરૂ કરો*

### Progress ring (§10)

Always out of 108, and shows **only the active level**: Level 3's ring until Level 4
unlocks, Level 4's after. Both scores are stored separately so history shows both.

---

## 6. Data model (§12) — and the write strategy that makes it affordable

```
users/{uid}          SMK, નામ, email, મોબાઈલ, ઝોન, સબઝોન,
                     emailVerified,                  ← reminder only, never blocks login
                     likeAnswer, commentAnswer,      ← entry-gate answers
                     level4Unlocked, createdAt

users/{uid}/progress/{YYYY-MM-DD}
                     date, level3Score, level4Score   ← ONE doc per yuvak per day

scenes/…             108 scenes — number, વર્ણન, image name
settings/…           both dhun names + file paths, YouTube video link
```

### ⚠️ The write rule the spec insists on (§12)

> ૨,૦૦૦ યુવક રોજ ૧૦૮ ટિક કરે તો દરરોજ **લાખો વખત** લખવાનું થાય, અને Firebase ની મફત મર્યાદા તરત ઓળંગાઈ જાય.

2,000 × 108 = **216,000 writes/day** against a 20,000 free limit. So:

- every tick is written **to the phone first** (localStorage)
- periodically — or when the yuvak leaves the page — that day's result is written to
  Firebase **once**
- **one yuvak = one document per day.** 2,000 writes/day, comfortably inside free tier
- the 108 વર્ણન are downloaded **once** and cached on the phone
- music choice and scroll speed live **only** on the phone — never in Firebase

---

## 7. Entry gate — YouTube (§5)

Shown once after first login; the app cannot be entered until it is done.

- The Varni Dhyan YouTube video, playing inline, plus an "open on YouTube" button
- Two mandatory questions: *શું તમે આ વિડિયોને લાઈક કર્યો છે?* and
  *શું તમે આ વિડિયો પર સારી કોમેન્ટ કરી છે?*
- Continue only activates when both are **હા**

**Honour system, by design.** The spec is explicit that the app *cannot* verify a like
or comment — that needs YouTube API permission and Google login, judged too heavy. Both
answers are recorded so the admin can see who said હા. Never asked again once done.

---

## 8. Music + auto-scroll (§8)

**Exactly two dhun/kirtan**, uploaded and named by the admin from the dashboard, stored
in **Firebase Storage** so swapping a track needs no redeploy. MP3, kept small.

*(This corrects v2: I had warned about MP3 bandwidth and suggested R2. With only two
files, Firebase Storage is entirely fine.)*

- Chosen dhun starts softly on entering the app; a corner button toggles it
- On the PDF દર્શન page: both dhun names, play/stop, volume slider
- **Loops continuously** so the dhyan is not broken; does not stop on scroll
- Preference (which dhun, on/off) remembered on the phone

**Auto-scroll** lets the yuvak meditate without touching the phone:

| વિકલ્પ | per scene | 108 scenes |
|---|---|---|
| ઝડપી | 3 s | ~5 min |
| મધ્યમ | 5 s | ~9 min |
| ધીમું | 8 s | ~15 min |
| અતિ ધીમું | 12 s | ~22 min |

Custom 2–30 s also allowed. Glides smoothly, never jumps. Finger-scrolling pauses it
briefly then it resumes from there. At 108: **'દર્શન સંપૂર્ણ'** and it stops.

---

## 9. Admin dashboard (§11)

Visible **only** to the two admin numbers — the button does not even render for anyone
else, and the page must not open by direct link. Must be readable on mobile.

**Top glance:** total registered · how many did dhyan today · today's average (Level 3
and 4 separately) · how many have unlocked Level 4.

**Yuvak list:** SMK · નામ · મોબાઈલ | ઝોન · સબઝોન | લાઈક · કોમેન્ટ | આજનો સ્કોર (3 and 4
separately) | સૌથી સારો સ્કોર | કુલ દિવસ | છેલ્લે ક્યારે.

**Tools:** filter by subzone · search by name or mobile · sort by any column ·
**'૫૦+ યાદ રાખનારા' one-click list** (directly useful when saints visit) · subzone
comparison (which મંડળ is more regular) · **Excel export** · date and date-range
reports · manage the two dhun.

---

## 10. Privacy (§13)

- Registration page must state plainly: *'આ માહિતી ફક્ત તમારી ધ્યાનની પ્રગતિ સાચવવા માટે છે,
  બીજે ક્યાંય વપરાશે નહીં.'*
- **2,000 mobile numbers, and some yuvaks will be minors (કિશોર વયના)** — collect only
  what is needed, nothing more.
- Firestore rules: a yuvak can read and write **only his own** data.
- The full list is visible to the two admin numbers and nobody else.

---

## 11. Build phases (spec §16 order)

| # | તબક્કો | Status |
|---|---|---|
| 0 | Foundation — scaffold, theme, image pipeline | ✅ **done** |
| 1 | નોંધણી (email+password), લોગિન (મોબાઈલ *or* email), વિડિયો પ્રવેશદ્વાર | ✅ backend live — Supabase migrated; the entry gate still needs the YouTube link |
| 2 | લેવલ ૧ અને લેવલ ૨ (દર્શન) | 🔶 Level 2 done · Level 1 needs the YouTube link |
| 3 | લેવલ ૩ અને ૪, ટિક, તાળાનો નિયમ, રોજ ખાલી થવાની વ્યવસ્થા | needs 108 વર્ણન |
| 4 | સંગીત, આપોઆપ સ્કોલ, પ્રગતિ ચક્ર, મારો ઈતિહાસ, કેલેન્ડર | needs 2 MP3s |
| 5 | સંચાલક ડેશબોર્ડ, તારીખવાર અહેવાલ, Excel, ધૂન ચઢાવવાની સગવડ | |
| 6 | ચકાસણી, સુધારા, અને પ્રકાશન | |

**Future (§16, noted as "space to be kept from now"):** spoken dhyan — 108 વર્ણન
recorded in a calm voice, separate from the background dhun; a congratulation image
shareable to WhatsApp at 50 or 108; full offline use once loaded.

---

## 12. Still needed from the admin (§15)

| What | Status |
|---|---|
| ૧૦૦ ચિત્રો અને વર્ણન | ✅ ready — optimised and in the build |
| **બાકીનાં ચિત્રો** | ✅ **આવી ગયાં** — the Drive folder holds 109 finalised 3840×2160 PNG images, all 109 bound and serving. See §2.3: 109 is one more than the spec's 108 and the admin must confirm why |
| ~~**બાકીનાં ૯ વર્ણન — દ્રશ્ય ૧૦૧–૧૦૯**~~ | ✅ **done** — the sheet carries all 109 વર્ણન; `npm run darshan` reports *image, no વર્ણન: none*. All 109 દ્રશ્યો are live |
| **YouTube વિડિયોની લિંક** | ⛔ pending — blocks Level 1 and the entry gate |
| ~~**Firebase ખાતું અને એની ચાવીઓ**~~ | ✅ **obsolete** — the backend is Supabase, not Firebase. Project `tjovudfsodviwijyyvdw` (ap-south-1) is live and every migration is applied; no admin action is needed here |
| **બે ધૂન / કીર્તનની MP3 ફાઈલો** | ⛔ pending — blocks Phase 4 |

## 13. Open questions

1. ~~What is SMK?~~ ✅ **Answered.** The yuvak's unique member ID: three uppercase
   initials (first · middle · last name) then three digits — `PGV881`, `ABC789`,
   `ASD852`. Pattern `^[A-Z]{3}\d{3}$`, **unique across every yuvak**.
   Uniqueness is enforced by `smkIndex/{SMK}`, written in the same batch as the profile;
   the document id *is* the SMK and the rule permits create but never update, so exactly
   one yuvak can hold a value. A failed claim deletes the just-created auth account so
   nobody is stranded half-registered.
2. **The 108 વર્ણન** — Level 3 shows વર્ણન *without* images. Are the existing 100 captions
   the same text reused, or is there separate, shorter wording for the list?
3. **Password rules** — minimum length, and is there any recovery route for a yuvak who
   loses both his password and his email access? (See §2.1 — with no OTP, the email is
   the only recovery path.)

*Resolved: §2.1 login method · §2.2 hosting.*
