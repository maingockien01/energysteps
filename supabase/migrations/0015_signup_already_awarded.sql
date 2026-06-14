-- =============================================================================
-- 0015 — sign_up returns `already_awarded` so the confirmation screen can show
--        the right gift message for every case:
--          1. Tier gift in stock AND a slot is still expected for this runner
--             → show the "gifts still waiting" nudge with the real count.
--          2. The tier's gifts are expected to be exhausted by earlier sign-ups,
--             or the gift is out of stock → motivational message (no false promise).
--          3. This email has ALREADY received a gift (a repeat run — one gift per
--             person, ever) → motivational message.
--
-- Case 3 needs a fact the client cannot see (the participants table is RLS-locked):
-- whether ANY registration for this email already holds a gift. We compute it
-- here and return it. Body is 0008's authoritative sign_up (waitlist gate +
-- tier_signup_count) with only the new flag added.
--
-- Run AFTER 0014_gift_tier_backfill_and_checkout_actual_start.sql. Idempotent.
-- =============================================================================
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
  v_cfg             public.event_config%rowtype;
  v_queue           public.queues%rowtype;
  v_position        int;
  v_participant     public.participants%rowtype;
  v_wait_ahead      bigint;
  v_est             timestamptz;
  v_waitlisted      boolean := false;
  v_tier_count      int;
  v_already_awarded boolean := false;
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

  -- Has this email ALREADY received a gift on any prior participation? (One gift
  -- per person, ever — 0007.) Computed BEFORE the insert; the new row carries no
  -- gift, so it never counts itself.
  select exists (
    select 1 from public.participants
     where lower(trim(email)) = lower(trim(p_email))
       and gift_id is not null
  ) into v_already_awarded;

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

  -- How many are in the running for a gift in this duration tier so far (this
  -- runner included). EXCLUDES no-shows and skips — they never finish, so they
  -- don't consume an expected gift slot. Counts signed_up + checked_in + finished.
  select count(*) into v_tier_count
  from public.participants
  where run_duration_seconds = p_run_duration_seconds
    and status not in ('no_show', 'skipped');

  return jsonb_build_object(
    'participant', to_jsonb(v_participant),
    'queue', to_jsonb(v_queue),
    'estimated_start', v_est,
    'event_start_time', v_cfg.event_start_time,
    'buffer_seconds', v_cfg.buffer_seconds,
    'waitlisted', v_waitlisted,
    'tier_signup_count', v_tier_count,
    'already_awarded', v_already_awarded
  );
end;
$$;
grant execute on function public.sign_up(text,text,text,int) to anon, authenticated;
