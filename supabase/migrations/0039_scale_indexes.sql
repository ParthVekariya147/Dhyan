-- વર્ણી ધ્યાન — the two things that stop being free as the roll grows.
--
-- Written against a real number: ~500 યુવક, each holding up to 108 દર્શન, each producing a
-- daily_activity_records row and a point_transactions row per active day. The reports join
-- across all of that. Nothing here changes what any query *means*; it changes what Postgres
-- has to touch to answer it.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE POLICIES ARE EVALUATED ONCE PER ROW
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every RLS policy in this schema is written like 0004:592:
--
--     for select using (id = auth.uid() or public.has_permission('users.read'))
--
-- `has_permission()` is STABLE, which permits Postgres to call it fewer times — it does not
-- oblige it to. For a function call sitting bare in a qual, the planner has no way to know the
-- argument is constant for the whole statement, so it is invoked **per row examined**. Each
-- invocation runs `permissions_for(effective_role())`, and `effective_role()` is itself two
-- indexed lookups plus an array construction and a linear scan of up to seventeen strings.
--
-- Listing 500 yuvaks therefore runs it 500 times. Joining profiles to a month of
-- point_transactions runs it once per row of the join. It is invisible at 20 rows and it is
-- the dominant cost of a report at 15,000.
--
-- The fix is the one PostgreSQL documents for exactly this: wrap the call in a scalar
-- subquery. `(select public.has_permission('users.read'))` has no dependency on the row, so
-- the planner hoists it into an InitPlan and evaluates it **once per statement**, caching the
-- boolean. The expression returns the same value for the same row it always did — this is a
-- change of evaluation strategy and not of meaning, which is why the whole of
-- scripts/test-rls.mjs is expected to pass unchanged, and why it is the proof this migration
-- leans on.
--
-- ── Why a loop rather than forty rewritten policies ─────────────────────────
--
-- The policies are spread across 0001, 0004, 0005, 0008, 0010, 0021, 0023, 0026, 0028, 0031,
-- 0033, 0034, 0035 and 0036, and several were replaced by later migrations, so the current
-- text of any one of them is not the text of the CREATE POLICY that first defined it.
-- Hand-transcribing forty policy bodies from thirteen files is the version of this change most
-- likely to silently drop a clause.
--
-- So the definitions are read back from the catalogue — `pg_policies.qual` and `with_check`
-- are what the database is actually enforcing right now — and only the function call itself is
-- wrapped. Anything the pattern does not match is left exactly as it was, and any rewrite that
-- fails to parse aborts the whole migration, because this file is one transaction.

do $$
declare
  r          record;
  new_qual   text;
  new_check  text;
  stmt       text;
  touched    integer := 0;
  -- One boolean call, wrapped whole. pg_get_expr() renders literals with their cast, so
  -- has_permission('users.read') comes back as has_permission('users.read'::text).
  pattern    constant text :=
    '(public\.(?:has_permission\(''[a-z0-9._]+''::text\)|is_admin\(\)))';
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual like '%has_permission%' or qual like '%is_admin%'
           or with_check like '%has_permission%' or with_check like '%is_admin%')
    order by tablename, policyname
  loop
    -- Already hoisted (a re-run of this migration, or a policy written the new way): leave it.
    if r.qual like '%SELECT public.has_permission%' or r.qual like '%SELECT public.is_admin%'
       or r.with_check like '%SELECT public.has_permission%'
       or r.with_check like '%SELECT public.is_admin%' then
      continue;
    end if;

    new_qual  := regexp_replace(r.qual,       pattern, '(select \1)', 'g');
    new_check := regexp_replace(r.with_check, pattern, '(select \1)', 'g');

    stmt := format('alter policy %I on public.%I', r.policyname, r.tablename);
    -- A SELECT/DELETE policy has no WITH CHECK and an INSERT policy has no USING; naming the
    -- half that does not exist is an error rather than a no-op.
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    execute stmt;
    touched := touched + 1;
  end loop;

  raise notice '[0039] % policies hoisted to an InitPlan.', touched;
  if touched = 0 then
    raise notice '[0039] Nothing matched — either already applied, or the catalogue renders';
    raise notice '[0039] these calls differently on this server. Check pg_policies by hand.';
  end if;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE USERS LIST HAS NO INDEX BEHIND IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `profiles` carries exactly one index that a report can use — profiles_zone_idx
-- (zone_id, sub_zone_id, status), added by 0030 — plus the UNIQUE constraints on smk and
-- mobile. Nothing covers `created_at`, which is:
--
--   * the default ORDER BY of the users list (userService.listUsers, sortField 'createdAt'),
--   * both bounds of the તારીખવાર filter (applyDateRange: gte / lt),
--   * the ordering the Excel export tiles its 1,000-row chunks along, where a mis-ordered
--     scan does not merely run slowly, it can repeat or skip rows between chunks.
--
-- At 500 rows a sequential scan and a sort cost little. The reason to add these now is the
-- export and the reports, which walk the same predicate repeatedly, and the fact that the
-- correct index is cheap on a table this size and awkward to add once it is not.

-- `id` trails `created_at` to make the pair unique, which is what keyset pagination needs to
-- tile pages without a gap when two yuvaks registered in the same instant. Descending to match
-- the list's own order, so the scan reads the index forwards.
create index if not exists profiles_created_idx
  on public.profiles (created_at desc, id);

-- The composite the list actually issues: one સબઝોન, newest first. profiles_zone_idx cannot
-- serve this — its second column is sub_zone_id and it has no date at all, so a filtered list
-- still sorts every matching row.
create index if not exists profiles_subzone_created_idx
  on public.profiles (sub_zone_id, created_at desc);

-- §17 search by address. `applyTerm()` lowercases the term and issues `eq('email', …)`, and
-- `profiles.email` — unlike mobile and smk — has no UNIQUE constraint and so no index.
create index if not exists profiles_email_idx
  on public.profiles (lower(email));

comment on index public.profiles_created_idx is
  'The users list default order, the તારીખવાર range filter, and the ordering the export tiles '
  'its chunks along. (created_at, id) so a keyset cursor is unique — see 0039.';

-- ---------------------------------------------------------------- what is deliberately absent
--
-- **No trigram index on `name`.** The name branch of §17 search is `name ilike 'પ્ર%'`, which a
-- btree cannot serve and pg_trgm can. It is not added because pg_trgm has to be installed into
-- a schema, that schema differs between a Supabase project and the postgres:16 container
-- scripts/lib/pgtest.mjs builds, and a migration that applies in one and not the other is worse
-- than a sequential scan over 500 short strings — which is roughly a tenth of a millisecond.
-- Revisit when `profiles` passes ~50,000 rows:
--     create extension if not exists pg_trgm;
--     create index profiles_name_trgm on public.profiles using gin (name gin_trgm_ops);
--
-- **No new aggregate view for the reports.** 0029 and 0030 already answer the progress report
-- with a server-side function rather than by shipping rows to the browser, and 0032 does the
-- same for points. Adding a second aggregation path would be two definitions of "how far has
-- this યુવક reached" — the failure the data contract exists to prevent.

do $$
begin
  raise notice '[0039] profiles indexes: created, subzone+created, email.';
  raise notice '[0039] Re-run ANALYZE if a report still plans badly: analyze public.profiles;';
end
$$;

analyze public.profiles;
