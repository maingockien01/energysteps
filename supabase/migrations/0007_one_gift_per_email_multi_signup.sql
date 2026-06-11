-- =============================================================================
-- 0007 — One gift per email + multiple participations
--
-- New rules (docs/RULES.md §"Gift structure" + General rules):
--   * "Không giới hạn số lần đăng ký" — an Amazer may register/run MORE THAN
--     ONCE. We allow re-registration once their previous attempt is no longer
--     active (finished / skipped / no_show), matching the sign-up form's
--     existing "you can register again after finishing" copy. At most ONE
--     ACTIVE registration per email at a time (prevents one person holding a
--     slot on both machines simultaneously).
--   * "Mỗi Amazer chỉ được nhận quà 01 lần" — each email may receive AT MOST
--     ONE gift across ALL their participations. Enforced at check-out.
--
-- Run AFTER 0006_leaderboard_by_duration.sql. Idempotent / safe to re-run.
-- =============================================================================

-- ---- 1. Allow multiple registrations, one ACTIVE at a time ------------------
-- Replace the unconditional unique email index with a PARTIAL one that only
-- constrains active rows. Finished/skipped/no_show rows no longer block a new
-- sign-up with the same email.
drop index if exists public.participants_email_unique;

create unique index if not exists participants_active_email_unique
  on public.participants (lower(email))
  where status not in ('finished', 'skipped', 'no_show');

-- ---- 2. sign_up(): block only an ACTIVE duplicate --------------------------
-- Body identical to 0003 except the duplicate-email guard now ignores rows
-- whose attempt is already complete.
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
  perform pg_advisory_xact_lock(1366754901);  -- serialize all signups (see 0003)

  select * into v_cfg from public.event_config where id = 1;

  if lower(trim(p_email)) not like '%@mblife.vn' then
    raise exception 'INVALID_EMAIL_DOMAIN' using errcode = '22023';
  end if;

  if not (p_run_duration_seconds = any (v_cfg.allowed_run_durations)) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  -- Only an ACTIVE registration blocks a new one. Once the prior attempt is
  -- finished/skipped/no_show, the same email may sign up again.
  if exists (
    select 1 from public.participants
     where lower(email) = lower(trim(p_email))
       and status not in ('finished', 'skipped', 'no_show')
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

-- ---- 3. moderator_check_out(): enforce one gift per email ------------------
-- Body identical to 0005 plus a gift-once-per-email guard. Awarding a gift is
-- rejected if ANY other registration for the same email already holds a gift —
-- the moderator must check out with "no gift" instead.
create or replace function public.moderator_check_out(
  p_pin text, p_participant_id uuid, p_distance numeric, p_gift_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.participants%rowtype;
  v_email text;
begin
  perform public.assert_moderator(p_pin);

  if p_gift_id is not null then
    select lower(trim(email)) into v_email
      from public.participants where id = p_participant_id;

    if exists (
      select 1 from public.participants
       where lower(trim(email)) = v_email
         and id <> p_participant_id
         and gift_id is not null
    ) then
      raise exception 'GIFT_ALREADY_AWARDED' using errcode = '23505';
    end if;

    update public.gifts
       set remaining_quantity = greatest(remaining_quantity - 1, 0)
     where id = p_gift_id;
  end if;

  update public.participants
     set status = 'finished',
         actual_finish = now(),
         distance_logged = p_distance,
         gift_id = p_gift_id
   where id = p_participant_id
  returning * into v_row;

  perform public.log_action(
    p_pin, 'check_out', p_participant_id,
    jsonb_build_object('distance', p_distance, 'gift_id', p_gift_id)
  );
  perform public.recompute_waitlist();
  return to_jsonb(v_row);
end; $$;

-- ---- 4. moderator_update_participant(): only block ACTIVE email clashes ----
create or replace function public.moderator_update_participant(
  p_pin text, p_id uuid, p_name text, p_department text,
  p_email text, p_run_duration_seconds int
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  if exists (select 1 from public.participants
              where lower(email) = lower(trim(p_email)) and id <> p_id
                and status not in ('finished','skipped','no_show')) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;
  update public.participants
     set name = trim(p_name),
         department = trim(p_department),
         email = trim(p_email),
         run_duration_seconds = p_run_duration_seconds
   where id = p_id
  returning * into v_row;   -- assigned_queue_id intentionally untouched
  return to_jsonb(v_row);
end; $$;

-- ---- 5. get_status_by_email(): pick the most relevant registration ---------
-- With multiple registrations the lookup returns the runner's ACTIVE attempt if
-- they have one, otherwise their most recent (latest created) attempt. Body is
-- otherwise identical to 0005.
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
   order by (status in ('finished','skipped','no_show')) asc,  -- active first
            created_at desc                                     -- else newest attempt
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
