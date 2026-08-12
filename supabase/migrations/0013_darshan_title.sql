-- ================================================================================
-- A દ્રશ્ય gets a name.
--
-- Until now a દ્રશ્ય was three things — a **link**, a **વર્ણન** and a **number** (0009). The
-- વર્ણન is a sentence: "સાગરકિનારે પથ્થર પર ઊભા રહી, ઊછળતાં પ્રચંડ મોજાં વચ્ચે નિર્ભય ઊભેલા
-- વર્ણીનું દર્શન". It is what લેવલ ૩ reads aloud and what લેવલ ૪ tests, and it is exactly the
-- wrong thing to put in a list row, a search result or a કસોટી's heading: a hundred rows of
-- full sentences is a wall of text a સંચાલક cannot scan.
--
-- `title` is the short name for the same દ્રશ્ય — "વનવિચરણ", "સાગર-દર્શન". One column,
-- because the alternative that was considered — deriving a title by truncating the વર્ણન —
-- is not a title, it is a sentence with its end cut off, and Gujarati conjuncts make the cut
-- land inside a cluster as often as not.
--
-- What this does NOT do
-- ---------------------
-- It does not rename `caption`. The Excel sheet's "Description" column is `scenes.caption` /
-- manifest `t` and stays that way: applyOverlay, useScenes, the લેવલ ૪ engine, the manifest
-- builder and 153 passing tests all read `caption`, and a rename buys nothing. `title` is a
-- fourth thing beside it, not a second spelling of it.
--
-- It adds no permission and changes no policy. Editing a title is editing a દ્રશ્ય, which is
-- `darshan.update` — the permission 0006's "scenes updatable by permission" policy already
-- names. An RLS policy governs the *row*, not the column list, so a new column on this table
-- is covered by the policy that was already there. A `darshan.title.edit` would need a
-- migration to permissions_for(), a matching edit to shared/domain/permissions.js, and would
-- be checked in exactly the places `darshan.update` already is.
--
-- The audit trail needs nothing either: audit_scene() (0004) writes to_jsonb(old) and
-- to_jsonb(new) for the whole row, so a title change appears in `before`/`after` from the
-- moment the column exists, under action DARSHAN_UPDATED.
-- ================================================================================

-- `not null default ''` mirrors `caption` in 0001_init.sql — and `level4_configs.title` and
-- `level4_activities.title` in 0010, which are the same decision made twice already. It is
-- copied deliberately
-- rather than allowing null. The overlay's empty-string convention is what
-- shared/domain/darshan.js turns on: **an empty title means "not written yet", never "blank
-- this દ્રશ્ય's title"**. `applyOverlay` therefore folds it exactly as it folds `caption` —
-- `if (scene.title) out.title = scene.title` — so a row that exists only because somebody
-- once toggled a દ્રશ્ય's visibility cannot erase a title through the merge.
--
-- Backfilling is not attempted. Every existing row and every manifest entry gets '', which
-- is the honest state: no title has been written for any દ્રશ્ય yet. They arrive in one
-- Excel round-trip, and until then the તપાસ page counts them as a named gap
-- (`missingTitles`), the same way it already counts `missingCaptions`.
alter table public.scenes
  add column if not exists title text not null default '';

comment on column public.scenes.title is
  'Short name for the દ્રશ્ય, for lists and headings. Empty means "not written yet", never '
  '"blank it" — see applyOverlay in shared/domain/darshan.js. NOT part of the content gate.';

-- ---------------------------------------------------------------- the rule that must hold
--
-- **`title` is not part of the content gate, and must never become part of it.**
--
-- `isLearnable()` / `isNumbered()` in shared/domain/darshan.js require an image AND a વર્ણન.
-- That pair is the gate because each half is a real dead end for a યુવક (§1): a દ્રશ્ય with no
-- picture is an empty frame, and one with no વર્ણન teaches nothing. A missing *title* is
-- neither — the યુવક is shown the picture and reads the વર્ણન exactly as before.
--
-- The cost of getting this wrong is not subtle. Every row here ships with `title = ''`, so
-- adding it to the gate would withhold the entire collection from the યુવક app the moment
-- this migration was applied, and would null every `displayIndex` — which would in turn make
-- every લેવલ ૪ કસોટી range empty, because the engine spans display numbers (ORDERING.md
-- decision #2). One `&& title` would take the app down and leave the database untouched, so
-- nothing in the schema would say why.
--
-- A missing title is reported, never enforced.
