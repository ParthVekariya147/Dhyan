-- ================================================================================
-- માસ્ટર દર્શન — the સંચાલક arranges the collection, and the numbering follows.
--
-- What this adds
-- --------------
-- One RPC. `darshan_reorder(p_ids)` takes the master list in the order the સંચાલક dragged
-- it into and writes `public.scenes."order"` to match — the whole permutation, in one call,
-- in one transaction.
--
-- Why an RPC and not a bulk upsert from the panel
-- -----------------------------------------------
-- Three reasons, and each of them is a defect in the PATCH-from-the-browser version.
--
--   1. **The unique index cannot be deferred.** `scenes_order_unique` (0004) is a *partial*
--      unique index — `where "order" is not null` — and only constraints may be DEFERRABLE,
--      constraints may not be partial. A reorder is a permutation, so it passes through
--      states where two rows hold the same number, and a single bulk UPDATE is checked row
--      by row in an order Postgres does not promise. It collides mid-permutation and the
--      whole save fails, unpredictably, depending on which row the planner touched first.
--      This is the same wall `level4_publish()` met with `level4_one_published`, and the
--      answer is the same: two statements inside one function body, which is one
--      transaction, so no caller ever observes the state in between.
--
--   2. **The overlay is sparse.** `public.scenes` has no row for a દ્રશ્ય the સંચાલક has
--      never edited (see `src/lib/useScenes.js`), and most have never been edited. So a
--      reorder cannot be an UPDATE at all — for most of the collection there is nothing to
--      update, and the row has to be created. See the upsert below for why that is safe.
--
--   3. **It is one decision.** ~109 rows today and possibly a thousand later (LEVEL4.md
--      rule 1). A loop of PATCHes that stops half way leaves the collection in an order
--      nobody chose, with the trail saying so.
--
-- What it deliberately does NOT touch
-- -----------------------------------
-- `scenes."index"` — the printed number, the `sourceIndex` of ORDERING.md §1 — and the id.
-- Reordering changes presentation and never identity (ORDERING.md §8 rule 3). A યુવક's
-- progress, `level4_activity_items` and every attempt already written all reference દર્શન by
-- stable id, so a global reorder cannot corrupt any of them; and `displayIndex`, the number
-- a યુવક actually sees, is derived on read by `withDisplayIndex()` in
-- shared/domain/darshan.js and is stored nowhere. This function writes `"order"` and
-- nothing else, and the numbering falls out of it.
-- ================================================================================

-- p_ids is the collection in its new order: `"order"` becomes each id's 1-based position.
--
-- The upsert, and why a row carrying only `id` and `"order"` is safe
-- -----------------------------------------------------------------
-- Most ids in p_ids have no row in `public.scenes`, so this creates one. It is worth
-- checking, column by column, that such a row changes **nothing a યુવક sees** — a reorder
-- that silently blanked a વર્ણન or renumbered the artwork would be a very expensive way to
-- move a card up a list. Against `src/lib/useScenes.js` and `applyOverlay()`:
--
--   caption  defaults ''    — `applyOverlay` tests `if (scene.caption)`, and '' is falsy, so
--                             the manifest's વર્ણન survives untouched. That is the rule the
--                             file states outright: an empty caption is "no વર્ણન written
--                             here", never "blank this scene".
--   index    stays null     — `applyOverlay` tests `Number.isInteger(scene.index)`, so the
--                             printed number is left exactly as the sheet built it.
--   image_url stays null    — falsy, so the manifest's Drive link and its `fullUrl` stand.
--   active   defaults true
--   status   defaults ACTIVE — `isWithheld()` in useScenes.js passes a row that is `active`
--                             and PUBLISHED/ACTIVE, which is precisely how a row-*less*
--                             દ્રશ્ય already behaves: absence of a row means the સંચાલક has
--                             never ruled on that દ્રશ્ય, and withholding is a deliberate act
--                             with a row to prove it. And the content gate (`isLearnable`)
--                             is applied *after* the overlay either way, so a દ્રશ્ય with no
--                             વર્ણન stays invisible to a યુવક exactly as before.
--
-- One panel-side consequence, which is not a યુવક-side one: `toDarshanItem` derives
-- `active` from `isLearnable` only while there is **no** row, and reads `scene.active`
-- once there is. So a દ્રશ્ય with no વર્ણન, which the તપાસ page listed as inactive, now
-- lists as active with its `reason` still naming the missing વર્ણન. Nothing a યુવક sees
-- changes, and — deliberately — its display number does not either: `withDisplayIndex()`
-- numbers on the content rule (વર્ણન **and** image, not withheld), not on that flag,
-- exactly so that materialising a row cannot shift the numbering.
--
-- What happens to દર્શન not named in p_ids
-- ----------------------------------------
-- Nothing. Their `"order"` is not touched and they are not renumbered — this function moves
-- what it was given and makes no decision about anything else. The panel sends the whole
-- list (ORDERING.md §5), so a subset is the deliberate-partial case: "put these five at the
-- front" leaves the rest sorting on the `position ?? sourceIndex` they already had.
--
-- The one thing that cannot be allowed to happen quietly is a subset whose target slots are
-- already occupied by a દ્રશ્ય it does not name — `scenes_order_unique` would reject it, and
-- the caller would get a raw index-violation with a constraint name in it. It is checked up
-- front instead, and refused by name, before anything is written.
--
--   darshan_reorder_denied         — not permitted
--   darshan_reorder_invalid_id     — a null or empty id in the list
--   darshan_reorder_duplicate      — the same દ્રશ્ય listed twice; there is no honest answer
--                                    to "which position is it in", so the whole call is
--                                    refused rather than one of them silently winning
--   darshan_reorder_conflict: <id> — a દ્રશ્ય NOT in p_ids already holds one of the target
--                                    positions. Send the whole list, or move that one too.
create or replace function public.darshan_reorder(p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n         integer := coalesce(array_length(p_ids, 1), 0);
  n_created integer;
  n_moved   integer;
  clash_id  text;
  park_base integer;
begin
  -- 1. The permission, checked inside, because SECURITY DEFINER runs as the owner and so
  --    is not subject to the RLS policies on `public.scenes` that would otherwise ask this.
  --    `darshan.update` and not `darshan.create`: arranging the collection is editing it,
  --    and the rows this creates are the overlay catching up with દ્રશ્યો the manifest
  --    already contains — no દ્રશ્ય comes into existence here. LEVEL4.md §1 freezes the
  --    permission matrix and this adds nothing to it.
  if not public.has_permission('darshan.update') then
    raise exception 'darshan_reorder_denied';
  end if;

  -- An empty list is not an error and not an administrative act either: nothing moved, so
  -- there is nothing to write and nothing to record. `Save Order` on an untouched list
  -- should cost a round trip, not an audit row.
  if n = 0 then
    return jsonb_build_object('reordered', 0);
  end if;

  if exists (select 1 from unnest(p_ids) as t(id) where t.id is null or t.id = '') then
    raise exception 'darshan_reorder_invalid_id';
  end if;

  -- 2. `count(distinct)` rather than a GROUP BY … HAVING, so the comparison is against the
  --    length the positions were numbered from and not against a second reading of it.
  if n <> (select count(distinct t.id) from unnest(p_ids) as t(id)) then
    raise exception 'darshan_reorder_duplicate';
  end if;

  -- The subset guard described above. Only positions 1…n can be written, so only a row
  -- sitting in that range and not in the list can be in the way.
  select s.id into clash_id
  from public.scenes s
  where s."order" between 1 and n
    and not (s.id = any(p_ids))
  order by s."order"
  limit 1;

  if clash_id is not null then
    raise exception 'darshan_reorder_conflict: %', clash_id;
  end if;

  select count(*) into n_created
  from unnest(p_ids) as t(id)
  where not exists (select 1 from public.scenes s where s.id = t.id);

  select count(*) into n_moved
  from unnest(p_ids) with ordinality as t(id, pos)
  left join public.scenes s on s.id = t.id
  where s.id is null
     or s."order" is distinct from t.pos::integer;

  -- 3. Park, then write. Two statements, one function body, one transaction.
  --
  --    **Only the rows that actually move are written.** A દ્રશ્ય already sitting at its
  --    target position is left alone by both statements, which is not merely an
  --    optimisation: `audit_scene()` writes one row per row touched, so touching all of
  --    them would cost two audit entries per દ્રશ્ય for a drag that moved one card — 218
  --    today, 2,000 at the size LEVEL4.md rule 1 warns about — and would bury the change
  --    inside its own trail. It also makes the call idempotent: sending the same list twice
  --    writes nothing the second time.
  --
  --    Skipping them is safe because the positions in `p_ids` are distinct: a row left
  --    alone holds its *own* target, which no other id is heading for, so it cannot be in
  --    the way of anything the second statement writes.
  --
  --    The parking values must collide with nothing, including with a row this call does not
  --    touch, so they start below the lowest `"order"` in the table rather than at a
  --    hard-coded -1: `least(0, min)` puts the base at zero for the ordinary collection
  --    (every order ≥ 1) and below any negative order left by an interrupted earlier call,
  --    and subtracting the 1-based position keeps them distinct from each other.
  --
  --    `scenes_sync_status` (0004) fires BEFORE both statements and does not interfere with
  --    either: neither names `active` or `status`, so on UPDATE both of its `is distinct
  --    from` tests are false and it only stamps `updated_at`, and on INSERT the row takes
  --    the ACTIVE default, falls into the `else` branch, and has its status re-derived from
  --    `active` as ACTIVE — the value it already had.
  select least(0, coalesce(min("order"), 0)) into park_base from public.scenes;

  update public.scenes s
     set "order" = park_base - t.pos::integer
    from unnest(p_ids) with ordinality as t(id, pos)
   where s.id = t.id
     and s."order" is distinct from t.pos::integer;

  -- The `not exists` reads `public.scenes` *after* the parking statement, so a row that was
  -- just parked no longer holds its target and is correctly included here; one that was
  -- skipped above still does, and is correctly left out.
  insert into public.scenes (id, "order")
  select t.id, t.pos::integer
  from unnest(p_ids) with ordinality as t(id, pos)
  where not exists (
    select 1
    from public.scenes s
    where s.id = t.id
      and s."order" = t.pos::integer
  )
  on conflict (id) do update set "order" = excluded."order";

  -- 4. The trail.
  --
  --    `audit_scene()` (0004) has already written a per-row DARSHAN_ORDER_CHANGED for every
  --    row both statements touched, with the real before/after in it — that is 0004's rule,
  --    that the database writes its own trail and no client can omit it, and it is left
  --    alone. What it cannot say is that the two hundred rows were one act by one person,
  --    which is the thing a reader of the log is actually looking at. Hence this one summary
  --    row on top of them.
  --
  --    `target_id` is '' because a reorder has no single target; the ids are in the per-row
  --    entries beside it. auth.uid() is known to be non-null here — `has_permission` is
  --    false for a caller without one — so this needs no guard of its own.
  insert into public.audit_logs
    (actor_id, actor_role, action, resource_type, target_id, meta)
  values
    (auth.uid(), public.effective_role()::text, 'DARSHAN_ORDER_CHANGED', 'scenes', '',
     jsonb_build_object(
       'count',   n,
       'moved',   n_moved,
       'created', n_created,
       'firstId', p_ids[1],
       'lastId',  p_ids[n]
     ));

  -- The count of દર્શન this call placed — i.e. the length of the list it accepted, not the
  -- number of rows it happened to have to write. The caller asked for a whole arrangement
  -- and got it; how much of it was already true is a fact about the trail (`moved` above),
  -- not about whether the save succeeded.
  return jsonb_build_object('reordered', n);
end;
$$;

revoke all on function public.darshan_reorder(text[]) from public;
grant execute on function public.darshan_reorder(text[]) to authenticated;

comment on function public.darshan_reorder(text[]) is
  'Writes public.scenes."order" to match the given id list, creating the overlay row for '
  'any દ્રશ્ય that has none. One transaction, so the partial index scenes_order_unique never '
  'sees the middle of the permutation. It writes "order" and nothing else — "index" and id '
  'are identity and are never renumbered — and the number a યુવક sees is derived from the '
  'result by withDisplayIndex() in shared/domain/darshan.js, never stored.';
