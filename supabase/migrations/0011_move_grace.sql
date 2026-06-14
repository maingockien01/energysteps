-- =============================================================================
-- 0011 — Configurable "move grace" for idle-machine re-anchoring (request #7)
--
-- Edge case: the slot anchor is the latest checkout in the queue (or event
-- start). If a machine sits IDLE — everyone finished a while ago, or a runner
-- re-registers / arrives late onto an empty machine — that anchor is stale and
-- in the past. The projection then shows a start time in the past, and the live
-- board even flips the fresh arrival straight to "running / slot elapsed",
-- skipping their check-in window.
--
-- Fix (client-side queue math): when the head is still waiting AND the normal
-- check-in window has already elapsed unused (now > anchor + buffer), the
-- machine is treated as idle and the head is re-anchored to now + move_grace —
-- a few minutes for them to walk to the machine. This value is moderator-tunable
-- here so it can be matched to the venue on the day.
--
-- Run AFTER 0010_status_full_history.sql. Idempotent / safe to re-run.
-- =============================================================================

-- Grace (seconds) given to a runner to reach an idle machine before their slot
-- clock starts. Default 180s (3 min).
alter table public.event_config
  add column if not exists move_grace_seconds int not null default 180;

-- Extend moderator_update_config with a trailing move-grace parameter. Body is
-- 0005's authoritative version plus this one field.
drop function if exists public.moderator_update_config(text,timestamptz,int,int[],int,timestamptz);

create or replace function public.moderator_update_config(
  p_pin text,
  p_event_start_time timestamptz,
  p_buffer_seconds int,
  p_allowed_run_durations int[],
  p_queue_count int,
  p_event_end_time timestamptz default null,
  p_move_grace_seconds int default 180
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_cfg public.event_config%rowtype;
  v_have_participants boolean;
begin
  perform public.assert_moderator(p_pin);
  select * into v_cfg from public.event_config where id = 1;

  if p_queue_count <> v_cfg.queue_count then
    if v_cfg.event_started then
      raise exception 'QUEUE_COUNT_LOCKED' using errcode = '22023';
    end if;
    select exists(select 1 from public.participants) into v_have_participants;
    if v_have_participants then
      raise exception 'QUEUE_COUNT_HAS_SIGNUPS' using errcode = '22023';
    end if;
    delete from public.queues;
    insert into public.queues (queue_number, name)
    select gs, 'Machine ' || gs from generate_series(1, p_queue_count) gs;
  end if;

  update public.event_config
     set event_start_time = p_event_start_time,
         event_end_time = p_event_end_time,
         buffer_seconds = p_buffer_seconds,
         allowed_run_durations = p_allowed_run_durations,
         queue_count = p_queue_count,
         move_grace_seconds = greatest(coalesce(p_move_grace_seconds, 180), 0)
   where id = 1
  returning * into v_cfg;

  perform public.recompute_waitlist();
  return to_jsonb(v_cfg);
end; $$;
grant execute on function public.moderator_update_config(text,timestamptz,int,int[],int,timestamptz,int) to anon, authenticated;
