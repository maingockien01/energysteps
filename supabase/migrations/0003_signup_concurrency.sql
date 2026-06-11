-- =============================================================================
-- 0003 — make sign_up() safe under concurrent bursts (1000 signups in minutes)
-- =============================================================================
-- PROBLEM (see chat / ADR): sign_up() runs at READ COMMITTED. Two signups that
-- land at the same instant both:
--   (a) read the same max(position_in_queue) and insert the SAME position, and
--   (b) independently pick the same "shortest-wait" queue and pile onto it.
-- (a) silently corrupts queue ordering; (b) defeats load balancing.
--
-- FIX:
--   1. A transaction-scoped advisory lock serializes the whole select-queue +
--      compute-position + insert critical section. Each signup is sub-ms, so
--      even 1000 serialized signups drain in a few seconds.
--   2. A unique (assigned_queue_id, position_in_queue) constraint is the hard
--      backstop: if anything ever races past the lock, it errors instead of
--      corrupting data.
-- Run this file after 0002_reset_event.sql.
-- =============================================================================

-- 1. Hard backstop. Guarded so re-running is safe; will raise if pre-existing
--    duplicate positions exist (clean those up / reset the event first).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'participants_queue_position_unique'
  ) then
    alter table public.participants
      add constraint participants_queue_position_unique
      unique (assigned_queue_id, position_in_queue);
  end if;
end $$;

-- 2. Serialize the critical section. Body is identical to 0001 except for the
--    pg_advisory_xact_lock() guard at the top.
create or replace function public.sign_up(
  p_name text,
  p_department text,
  p_email text,
  p_run_duration_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg            public.event_config%rowtype;
  v_queue          public.queues%rowtype;
  v_position       int;
  v_participant    public.participants%rowtype;
  v_wait_ahead     bigint;
  v_est            timestamptz;
begin
  -- Serialize all concurrent signups. The lock is released automatically at
  -- transaction end (commit or rollback). Constant key, shared by every signup.
  perform pg_advisory_xact_lock(1366754901);  -- arbitrary fixed key shared by all signups

  select * into v_cfg from public.event_config where id = 1;

  -- email must be an mblife.vn address (event eligibility guard)
  if lower(trim(p_email)) not like '%@mblife.vn' then
    raise exception 'INVALID_EMAIL_DOMAIN' using errcode = '22023';
  end if;

  if not (p_run_duration_seconds = any (v_cfg.allowed_run_durations)) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  if exists (select 1 from public.participants where lower(email) = lower(trim(p_email))) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;

  -- choose the queue with the SHORTEST total remaining wait (now race-free:
  -- the advisory lock means no other signup is mid-insert).
  select q.* into v_queue
  from public.queues q
  left join public.participants p
    on p.assigned_queue_id = q.id
   and p.status not in ('finished','skipped','no_show')
  group by q.id
  order by coalesce(sum(p.run_duration_seconds + v_cfg.buffer_seconds), 0) asc,
           q.queue_number asc
  limit 1;

  select coalesce(max(position_in_queue), 0) + 1 into v_position
  from public.participants where assigned_queue_id = v_queue.id;

  insert into public.participants
    (name, department, email, run_duration_seconds, assigned_queue_id, position_in_queue)
  values
    (trim(p_name), trim(p_department), trim(p_email), p_run_duration_seconds, v_queue.id, v_position)
  returning * into v_participant;

  select coalesce(sum(run_duration_seconds + v_cfg.buffer_seconds), 0) into v_wait_ahead
  from public.participants
  where assigned_queue_id = v_queue.id
    and position_in_queue < v_position
    and status not in ('finished','skipped','no_show');

  v_est := case when v_cfg.event_start_time is not null
                then v_cfg.event_start_time + make_interval(secs => v_wait_ahead)
                else null end;

  return jsonb_build_object(
    'participant', to_jsonb(v_participant),
    'queue', to_jsonb(v_queue),
    'estimated_start', v_est,
    'event_start_time', v_cfg.event_start_time,
    'buffer_seconds', v_cfg.buffer_seconds
  );
end;
$$;

grant execute on function public.sign_up(text,text,text,int) to anon, authenticated;
