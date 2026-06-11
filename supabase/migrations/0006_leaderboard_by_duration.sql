-- =============================================================================
-- 0006 — Leaderboard categorized by run duration
-- Distance isn't comparable across run lengths (a 5-min runner covers more than
-- a 2-min runner), so the individual leaderboard is grouped by the runner's
-- chosen run_duration_seconds. We expose `duration` on each entry and let the
-- client group into tiers. Department totals are unchanged (participation view).
--
-- Rules: docs/RULES.md §"Achievement awards". KNOWN GAP (deviation B): the
-- per-level tie-break should be earliest finish time; the order by below ranks
-- by distance only. To comply, select actual_finish and add `, actual_finish
-- asc` to the individuals order by.
-- Run AFTER 0005_improvements.sql. Idempotent.
-- =============================================================================
create or replace function public.get_leaderboard()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_individuals jsonb;
  v_departments jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
            'display_name', disp,
            'department', department,
            'distance', distance_logged,
            'duration', run_duration_seconds
         ) order by run_duration_seconds asc, distance_logged desc), '[]'::jsonb)
    into v_individuals
  from (
    select department, distance_logged, run_duration_seconds,
      case
        when array_length(regexp_split_to_array(trim(name), '\s+'), 1) <= 1
          then trim(name)
        else (regexp_split_to_array(trim(name), '\s+'))[array_length(regexp_split_to_array(trim(name), '\s+'), 1)]
             || ' ' || upper(left((regexp_split_to_array(trim(name), '\s+'))[1], 1)) || '.'
      end as disp
    from public.participants
    where status = 'finished' and distance_logged is not null
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
            'department', department,
            'total_distance', total,
            'finishers', cnt
         ) order by total desc), '[]'::jsonb)
    into v_departments
  from (
    select department, sum(distance_logged) as total, count(*) as cnt
    from public.participants
    where status = 'finished' and distance_logged is not null
    group by department
  ) d;

  return jsonb_build_object('individuals', v_individuals, 'departments', v_departments);
end; $$;
grant execute on function public.get_leaderboard() to anon, authenticated;
