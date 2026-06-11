-- =============================================================================
-- 0008 — PM feedback batch (15.06.2026)
--   Item 7  Re-sign-up allowed once the prior run is finished/skipped/no-show.
--           (At most ONE *active* sign-up per email; history is kept.)
--   Item 12 sign_up returns the runner's duration-tier sign-up count, for the
--           "gifts still waiting" nudge on the confirmation screen.
--   Item 14 moderator_move_participant: move a waiting runner to a FREE machine.
--
-- Run AFTER 0007_one_gift_per_email_multi_signup.sql. This overlaps 0007 on
-- item 7 and intentionally redefines sign_up LAST: 0007's sign_up is based on
-- 0003 and drops the 0005 waitlist capacity gate, so the version here (waitlist
-- gate restored + tier_signup_count) is authoritative. 0007's check_out
-- (one-gift-per-email) is NOT touched here and survives. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Item 7 — replace the all-rows unique email index with a PARTIAL one that only
-- covers ACTIVE sign-ups. A finished / skipped / no-show row no longer blocks a
-- fresh sign-up, but a runner still can't hold two live sign-ups at once.
-- ---------------------------------------------------------------------------
drop index if exists public.participants_email_unique;

create unique index if not exists participants_active_email_unique
  on public.participants (lower(email))
  where status in ('signed_up', 'checked_in');

-- ---------------------------------------------------------------------------
-- Item 7 + 12 — sign_up: the duplicate guard now only trips on an ACTIVE row,
-- and the result carries tier_signup_count (sign-ups in this run-duration tier,
-- including this one). Body otherwise mirrors 0005.
-- ---------------------------------------------------------------------------
create or replace function public.sign_up(
  p_name text,
  p_department text,
  p_email text,
  p_run_duration_seconds int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cfg         public.event_config%rowtype;
  v_queue       public.queues%rowtype;
  v_position    int;
  v_participant public.participants%rowtype;
  v_wait_ahead  bigint;
  v_est         timestamptz;
  v_waitlisted  boolean := false;
  v_tier_count  int;
begin
  perform pg_advisory_xact_lock(1366754901);

  select * into v_cfg from public.event_config where id = 1;

  if lower(trim(p_email)) not like '%@mblife.vn' then
    raise exception 'INVALID_EMAIL_DOMAIN' using errcode = '22023';
  end if;

  if not (p_run_duration_seconds = any (v_cfg.allowed_run_durations)) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  -- Only an ACTIVE (not-yet-finished) sign-up blocks a re-registration.
  if exists (
    select 1 from public.participants
     where lower(email) = lower(trim(p_email))
       and status in ('signed_up', 'checked_in')
  ) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;

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

  if v_cfg.event_start_time is not null and v_cfg.event_end_time is not null then
    if (v_cfg.event_start_time
        + make_interval(secs => v_wait_ahead + p_run_duration_seconds + v_cfg.buffer_seconds))
       > v_cfg.event_end_time then
      v_waitlisted := true;
      update public.participants set waitlisted = true where id = v_participant.id;
    end if;
  end if;

  -- How many have signed up in this duration tier so far (this runner included).
  select count(*) into v_tier_count
  from public.participants
  where run_duration_seconds = p_run_duration_seconds;

  return jsonb_build_object(
    'participant', to_jsonb(v_participant),
    'queue', to_jsonb(v_queue),
    'estimated_start', v_est,
    'event_start_time', v_cfg.event_start_time,
    'buffer_seconds', v_cfg.buffer_seconds,
    'waitlisted', v_waitlisted,
    'tier_signup_count', v_tier_count
  );
end;
$$;
grant execute on function public.sign_up(text,text,text,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item 7 — status lookup must resolve to the runner's ACTIVE sign-up when one
-- exists (a re-registration), else their most recent historical row. Body
-- otherwise mirrors 0005.
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
            'actual_finish', actual_finish
         ) order by position_in_queue), '[]'::jsonb)
  into v_members
  from public.participants
  where assigned_queue_id = v_me.assigned_queue_id;

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
            'distance_logged', v_me.distance_logged,
            'gift_name', v_gift,
            'waitlisted', v_me.waitlisted
          ),
    'queue', to_jsonb(v_queue),
    'config', to_jsonb(v_cfg),
    'queue_members', v_members
  );
end;
$$;
grant execute on function public.get_status_by_email(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item 7 — editing a runner only conflicts with ANOTHER ACTIVE sign-up sharing
-- the email (historical finished rows no longer block edits). Mirrors 0001.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_update_participant(
  p_pin text, p_id uuid, p_name text, p_department text,
  p_email text, p_run_duration_seconds int
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  if exists (
    select 1 from public.participants
     where lower(email) = lower(trim(p_email))
       and id <> p_id
       and status in ('signed_up','checked_in')
  ) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;
  update public.participants
     set name = trim(p_name),
         department = trim(p_department),
         email = trim(p_email),
         run_duration_seconds = p_run_duration_seconds
   where id = p_id
  returning * into v_row;   -- assigned_queue_id intentionally untouched here
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.moderator_update_participant(text,uuid,text,text,text,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item 14 — move a WAITING (signed_up) runner to a machine that is currently
-- FREE (no signed_up / checked_in runner). Appends them to the target queue's
-- tail, logs the move, and recomputes the waitlist (loads shifted).
-- ---------------------------------------------------------------------------
create or replace function public.moderator_move_participant(
  p_pin text, p_participant_id uuid, p_target_queue_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_p   public.participants%rowtype;
  v_row public.participants%rowtype;
  v_pos int;
begin
  perform public.assert_moderator(p_pin);

  select * into v_p from public.participants where id = p_participant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Only waiting runners can be moved (not mid-run, not already done).
  if v_p.status <> 'signed_up' then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  if not exists (select 1 from public.queues where id = p_target_queue_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Target must be free: same machine, or any active runner there, is rejected.
  if v_p.assigned_queue_id = p_target_queue_id
     or exists (
       select 1 from public.participants
        where assigned_queue_id = p_target_queue_id
          and status in ('signed_up','checked_in')
     ) then
    raise exception 'QUEUE_NOT_FREE' using errcode = '22023';
  end if;

  select coalesce(max(position_in_queue), 0) + 1 into v_pos
  from public.participants where assigned_queue_id = p_target_queue_id;

  update public.participants
     set assigned_queue_id = p_target_queue_id,
         position_in_queue = v_pos
   where id = p_participant_id
  returning * into v_row;

  perform public.log_action(
    p_pin, 'move', p_participant_id,
    jsonb_build_object('to_queue', p_target_queue_id)
  );
  perform public.recompute_waitlist();
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.moderator_move_participant(text,uuid,uuid) to anon, authenticated;
