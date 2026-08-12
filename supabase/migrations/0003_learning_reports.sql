-- Reporting helpers for the સંચાલક panel.
--
-- PostgREST cannot express a GROUP BY, so aggregate reports go through RPCs. Both are
-- SECURITY INVOKER (the default), so RLS still applies and a non-admin caller gets
-- nothing — the function is a convenience, never a way around a policy.

-- §38 — how many yuvaks sit at each stage.
--
-- This replaces eight separate count queries, one per stage. It is one scan, and it also
-- cannot drift the way a precomputed counter document would.
create or replace function public.stage_breakdown()
returns table (stage text, count bigint)
language sql
stable
as $$
  select s.stage::text, coalesce(c.n, 0) as count
  from unnest(enum_range(null::public.learning_stage)) as s(stage)
  left join (
    select current_stage, count(*) as n
    from public.learning_state
    group by current_stage
  ) c on c.current_stage = s.stage
  order by array_position(enum_range(null::public.learning_stage), s.stage);
$$;

grant execute on function public.stage_breakdown() to authenticated;
