-- =============================================================================
-- 0002 — moderator_reset_event
-- Restarts the event DATA so a fresh run can begin:
--   * deletes ALL participants (sign-ups + results)
--   * restores every gift's remaining_quantity back to its total_quantity
--   * un-starts the event (event_started=false, started_at=null)
-- PRESERVED: machines/queues, buffer, allowed run durations, event_start_time,
-- and the moderator PINs. Run this file after 0001_init.sql.
-- =============================================================================
create or replace function public.moderator_reset_event(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.event_config%rowtype;
begin
  perform public.assert_moderator(p_pin);

  -- Explicit predicates: the platform blocks unqualified DELETE/UPDATE.
  delete from public.participants where id is not null;
  update public.gifts set remaining_quantity = total_quantity where id is not null;
  update public.event_config
     set event_started = false,
         started_at = null
   where id = 1
  returning * into v_cfg;

  return to_jsonb(v_cfg);
end;
$$;

grant execute on function public.moderator_reset_event(text) to anon, authenticated;
