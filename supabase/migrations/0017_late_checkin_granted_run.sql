-- =============================================================================
-- 0017 — Adjustable run time on a LATE (auto-running) check-in
--
-- When a runner's check-in buffer elapses unused, the slot auto-rolls into the
-- run clock (board "running (auto)"), and previously the moderator could only
-- check the runner OUT or skip them — a late arrival could no longer be checked
-- IN, and the auto-clock had already eaten into their time.
--
-- This adds an OPTIONAL granted run length to check-in. When supplied, the
-- runner's slot is re-anchored to their actual check-in and runs for exactly
-- that many seconds (the board + status projection both honor it; see
-- queueLogic.ts). The granted value is bounded: at least the shortest configured
-- run, at most what the runner REGISTERED for (we never grant more than they
-- signed up for). The leaderboard / gift TIER is unchanged — it stays keyed on
-- run_duration_seconds (achievement is by the originally-registered level; see
-- docs/RULES.md). granted_run_seconds only moves the live clock.
--
-- Run AFTER 0016_rename_queue.sql. Idempotent / safe to re-run.
-- =============================================================================

-- The run length (seconds) granted at a late check-in, measured from
-- actual_start. NULL = normal check-in (slot uses the buffer + registered run,
-- anchored to the previous checkout, exactly as before).
alter table public.participants
  add column if not exists granted_run_seconds int;

-- ---------------------------------------------------------------------------
-- moderator_check_in gains an optional p_run_seconds. Drop the old 2-arg
-- signature first so the new 3-arg form (with a default) can't create an
-- overload ambiguity when called with just {p_pin, p_participant_id}.
-- ---------------------------------------------------------------------------
drop function if exists public.moderator_check_in(text, uuid);

create or replace function public.moderator_check_in(
  p_pin text, p_participant_id uuid, p_run_seconds int default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row public.participants%rowtype;
  v_cfg public.event_config%rowtype;
  v_reg int;
  v_min int;
begin
  perform public.assert_moderator(p_pin);

  if p_run_seconds is not null then
    select * into v_cfg from public.event_config where id = 1;
    select run_duration_seconds into v_reg
      from public.participants where id = p_participant_id;
    v_min := (select min(d) from unnest(v_cfg.allowed_run_durations) d);
    -- At least the shortest configured run; at most what they registered for.
    if v_reg is null or p_run_seconds < v_min or p_run_seconds > v_reg then
      raise exception 'INVALID_DURATION' using errcode = '22023';
    end if;
  end if;

  update public.participants
     set status = 'checked_in',
         actual_start = now(),
         granted_run_seconds = p_run_seconds  -- null clears it on a normal check-in
   where id = p_participant_id
  returning * into v_row;

  perform public.log_action(
    p_pin, 'check_in', p_participant_id,
    case when p_run_seconds is not null
         then jsonb_build_object('granted_run_seconds', p_run_seconds)
         else '{}'::jsonb end
  );
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_check_in(text,uuid,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Undo of a check-in must also clear the granted run length (otherwise a
-- re-check-in would silently inherit the old grant). Body mirrors 0005.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_undo_check_in(p_pin text, p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.participants
     set status = 'signed_up', actual_start = null, granted_run_seconds = null
   where id = p_participant_id and status = 'checked_in'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'UNDO_NOT_APPLICABLE' using errcode = '22023';
  end if;
  perform public.log_action(p_pin, 'undo_check_in', p_participant_id, '{}'::jsonb);
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_undo_check_in(text,uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_status_by_email — expose granted_run_seconds on queue_members (so the
-- status-page projection re-anchors people behind a late-checked-in runner) and
-- on `me`. Body is 0013's plus that one field in two places.
-- ---------------------------------------------------------------------------
create or replace function public.get_status_by_email(p_email text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me      public.participants%rowtype;
  v_queue   public.queues%rowtype;
  v_cfg     public.event_config%rowtype;
  v_members jsonb;
  v_history jsonb;
  v_gift    text;
begin
  select * into v_me from public.participants
   where lower(email) = lower(trim(p_email))
   order by (status in ('signed_up','checked_in')) desc, created_at desc
   limit 1;

  if v_me.id is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_queue from public.queues where id = v_me.assigned_queue_id;
  select * into v_cfg from public.event_config where id = 1;
  select name into v_gift from public.gifts where id = v_me.gift_id;

  select coalesce(jsonb_agg(jsonb_build_object(
            'id', id,
            'position_in_queue', position_in_queue,
            'run_duration_seconds', run_duration_seconds,
            'status', status,
            'original_estimated_start', original_estimated_start,
            'actual_start', actual_start,
            'actual_finish', actual_finish,
            'granted_run_seconds', granted_run_seconds,
            'created_at', created_at
         ) order by position_in_queue), '[]'::jsonb)
  into v_members
  from public.participants
  where assigned_queue_id = v_me.assigned_queue_id;

  -- All participations for this email (newest first), with their result fields.
  select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id,
            'position_in_queue', p.position_in_queue,
            'run_duration_seconds', p.run_duration_seconds,
            'status', p.status,
            'original_estimated_start', p.original_estimated_start,
            'actual_start', p.actual_start,
            'actual_finish', p.actual_finish,
            'distance_logged', p.distance_logged,
            'gift_name', g.name,
            'queue_name', q.name,
            'created_at', p.created_at
         ) order by p.created_at desc), '[]'::jsonb)
  into v_history
  from public.participants p
  left join public.queues q on q.id = p.assigned_queue_id
  left join public.gifts  g on g.id = p.gift_id
  where lower(p.email) = lower(trim(p_email));

  return jsonb_build_object(
    'found', true,
    'me', jsonb_build_object(
            'id', v_me.id,
            'position_in_queue', v_me.position_in_queue,
            'run_duration_seconds', v_me.run_duration_seconds,
            'status', v_me.status,
            'original_estimated_start', v_me.original_estimated_start,
            'actual_start', v_me.actual_start,
            'actual_finish', v_me.actual_finish,
            'granted_run_seconds', v_me.granted_run_seconds,
            'distance_logged', v_me.distance_logged,
            'gift_name', v_gift,
            'waitlisted', v_me.waitlisted,
            'created_at', v_me.created_at
          ),
    'queue', to_jsonb(v_queue),
    'config', to_jsonb(v_cfg),
    'queue_members', v_members,
    'history', v_history
  );
end;
$$;
grant execute on function public.get_status_by_email(text) to anon, authenticated;
