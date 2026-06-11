-- =============================================================================
-- 0005 — Product improvements batch
--   P0-2  Capacity + waitlist (soft, non-destructive flag)
--   P1-2  verify_pin (single source of truth for the gate)
--   P1-3  Undo check-in / check-out (re-increments gift)
--   P1-4  Action log (moderator audit trail) + PIN labels
--   P1-5  get_leaderboard (de-identified, first-name + initial)
--   P2-1  Status payload exposes the runner's own distance + gift name
--
-- Run AFTER 0004_event_defaults.sql. Idempotent / safe to re-run.
--
-- DESIGN NOTE — waitlist is a SOFT FLAG, not a "no slot" queue. A waitlisted
-- runner is still assigned a real machine + position (so none of the queue-timer
-- math has to cope with null assignments); the flag only means "your finish is
-- projected past the event end time, so this slot is NOT promised." As no-shows
-- and skips shrink a queue, recompute_waitlist() clears the flag for anyone who
-- now fits before the end time. The projection used for the gate is the simple
-- event_start + remaining-wait summation (NOT the checkout-anchored board timer),
-- which intentionally OVER-estimates finish time → conservative (never promises
-- a slot it can't deliver). See docs/PRODUCT_IMPROVEMENTS.md P0-2.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema additions (all guarded / additive)
-- ---------------------------------------------------------------------------
alter table public.event_config  add column if not exists event_end_time timestamptz;
alter table public.participants   add column if not exists waitlisted boolean not null default false;
alter table public.moderator_pins add column if not exists label text;

-- Moderator audit trail. RLS-enabled with NO policies → locked from anon; only
-- the SECURITY DEFINER functions below read/write it (they bypass RLS).
create table if not exists public.action_log (
  id               uuid primary key default gen_random_uuid(),
  pin_label        text,              -- station label (never the raw PIN)
  action           text not null,     -- check_in | check_out | skip | no_show | undo_*
  participant_id   uuid,
  participant_name text,              -- denormalized for the audit view (moderator-only)
  payload          jsonb,
  created_at       timestamptz not null default now()
);
alter table public.action_log enable row level security;
create index if not exists action_log_created_idx on public.action_log (created_at desc);

-- ---------------------------------------------------------------------------
-- P1-2 — verify_pin: the gate validates against the DB (no frontend PIN list)
-- ---------------------------------------------------------------------------
create or replace function public.verify_pin(p_pin text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (select 1 from public.moderator_pins where pin = p_pin);
$$;
grant execute on function public.verify_pin(text) to anon, authenticated;

-- Resolve a PIN's station label (null if none). Used to attribute log rows
-- WITHOUT ever storing the raw PIN.
create or replace function public.pin_label(p_pin text)
returns text
language sql security definer set search_path = public
as $$
  select label from public.moderator_pins where pin = p_pin;
$$;

-- ---------------------------------------------------------------------------
-- P1-4 — internal logging helper
-- ---------------------------------------------------------------------------
create or replace function public.log_action(
  p_pin text, p_action text, p_participant_id uuid, p_payload jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  select name into v_name from public.participants where id = p_participant_id;
  insert into public.action_log (pin_label, action, participant_id, participant_name, payload)
  values (public.pin_label(p_pin), p_action, p_participant_id, v_name, p_payload);
end;
$$;

-- ---------------------------------------------------------------------------
-- P0-2 — recompute the waitlist: clear the flag for any waitlisted runner whose
-- projected finish now fits within the event window. Only ever PROMOTES (never
-- re-waitlists) so a promise, once made, is kept. No-op unless both
-- event_start_time and event_end_time are configured.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_waitlist()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_cfg        public.event_config%rowtype;
  r            record;
  v_wait_ahead bigint;
  v_finish     timestamptz;
begin
  select * into v_cfg from public.event_config where id = 1;
  if v_cfg.event_start_time is null or v_cfg.event_end_time is null then
    return;
  end if;

  for r in
    select * from public.participants
     where waitlisted = true
       and status not in ('finished','skipped','no_show')
     order by created_at
  loop
    select coalesce(sum(run_duration_seconds + v_cfg.buffer_seconds), 0)
      into v_wait_ahead
      from public.participants
     where assigned_queue_id = r.assigned_queue_id
       and position_in_queue < r.position_in_queue
       and status not in ('finished','skipped','no_show');

    v_finish := v_cfg.event_start_time
                + make_interval(secs => v_wait_ahead + r.run_duration_seconds + v_cfg.buffer_seconds);

    if v_finish <= v_cfg.event_end_time then
      update public.participants set waitlisted = false where id = r.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- P0-2 — sign_up with capacity gate. Body mirrors 0003 (concurrency-safe via
-- the advisory lock) plus the waitlist flag at the end.
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
begin
  perform pg_advisory_xact_lock(1366754901);

  select * into v_cfg from public.event_config where id = 1;

  if lower(trim(p_email)) not like '%@mblife.vn' then
    raise exception 'INVALID_EMAIL_DOMAIN' using errcode = '22023';
  end if;

  if not (p_run_duration_seconds = any (v_cfg.allowed_run_durations)) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  if exists (select 1 from public.participants where lower(email) = lower(trim(p_email))) then
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

  -- Capacity gate: if the runner's projected FINISH exceeds the event end time,
  -- flag them as waitlisted (not promised). Only when both times are configured.
  if v_cfg.event_start_time is not null and v_cfg.event_end_time is not null then
    if (v_cfg.event_start_time
        + make_interval(secs => v_wait_ahead + p_run_duration_seconds + v_cfg.buffer_seconds))
       > v_cfg.event_end_time then
      v_waitlisted := true;
      update public.participants set waitlisted = true where id = v_participant.id;
    end if;
  end if;

  return jsonb_build_object(
    'participant', to_jsonb(v_participant),
    'queue', to_jsonb(v_queue),
    'estimated_start', v_est,
    'event_start_time', v_cfg.event_start_time,
    'buffer_seconds', v_cfg.buffer_seconds,
    'waitlisted', v_waitlisted
  );
end;
$$;
grant execute on function public.sign_up(text,text,text,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- P2-1 — get_status_by_email now also returns the runner's OWN distance + gift
-- name + waitlisted flag (still no name/department/email — see ADR-006).
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
   where lower(email) = lower(trim(p_email)) limit 1;

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
-- P1-4 — redefine check-in / check-out / skip to write the audit log, and have
-- the queue-shrinking actions (check-out, skip) recompute the waitlist.
-- Bodies are otherwise identical to 0001.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_check_in(p_pin text, p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.participants
     set status = 'checked_in', actual_start = now()
   where id = p_participant_id
  returning * into v_row;
  perform public.log_action(p_pin, 'check_in', p_participant_id, '{}'::jsonb);
  return to_jsonb(v_row);
end; $$;

create or replace function public.moderator_check_out(
  p_pin text, p_participant_id uuid, p_distance numeric, p_gift_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);

  if p_gift_id is not null then
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

create or replace function public.moderator_skip(
  p_pin text, p_participant_id uuid, p_status text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  if p_status not in ('skipped','no_show') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  update public.participants
     set status = p_status
   where id = p_participant_id
  returning * into v_row;
  perform public.log_action(p_pin, p_status, p_participant_id, '{}'::jsonb);
  perform public.recompute_waitlist();
  return to_jsonb(v_row);
end; $$;

-- ---------------------------------------------------------------------------
-- P1-3 — Undo. Reverse the last check-in / check-out for a runner. Undo of a
-- check-out re-increments the gift (capped at total) and restores the runner to
-- 'checked_in' with their original start preserved.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_undo_check_in(p_pin text, p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.participants
     set status = 'signed_up', actual_start = null
   where id = p_participant_id and status = 'checked_in'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'UNDO_NOT_APPLICABLE' using errcode = '22023';
  end if;
  perform public.log_action(p_pin, 'undo_check_in', p_participant_id, '{}'::jsonb);
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_undo_check_in(text,uuid) to anon, authenticated;

create or replace function public.moderator_undo_check_out(p_pin text, p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row     public.participants%rowtype;
  v_old_gift uuid;
begin
  perform public.assert_moderator(p_pin);

  select gift_id into v_old_gift from public.participants
   where id = p_participant_id and status = 'finished';
  if not found then
    raise exception 'UNDO_NOT_APPLICABLE' using errcode = '22023';
  end if;

  -- Restore the gift (capped at total) before clearing the reference.
  if v_old_gift is not null then
    update public.gifts
       set remaining_quantity = least(remaining_quantity + 1, total_quantity)
     where id = v_old_gift;
  end if;

  update public.participants
     set status = 'checked_in',
         actual_finish = null,
         distance_logged = null,
         gift_id = null
   where id = p_participant_id
  returning * into v_row;

  perform public.log_action(p_pin, 'undo_check_out', p_participant_id, '{}'::jsonb);
  perform public.recompute_waitlist();
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_undo_check_out(text,uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- P1-4 — recent moderator activity (audit view). Moderator-only.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_get_action_log(p_pin text, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_log jsonb;
begin
  perform public.assert_moderator(p_pin);
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
    into v_log
  from (
    select * from public.action_log order by created_at desc limit p_limit
  ) a;
  return v_log;
end; $$;
grant execute on function public.moderator_get_action_log(text,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- P1-5 — public leaderboard. De-identified to a friendly handle: the given name
-- (last word, how Vietnamese names are addressed) + the family initial, e.g.
-- "Nguyễn Văn An" → "An N.", "John Smith" → "Smith J.". Engagement feature; the
-- identity exposure here is an explicit product decision (see ADR / decision log).
-- ---------------------------------------------------------------------------
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
            'distance', distance_logged
         ) order by distance_logged desc), '[]'::jsonb)
    into v_individuals
  from (
    select department, distance_logged,
      case
        when array_length(regexp_split_to_array(trim(name), '\s+'), 1) <= 1
          then trim(name)
        else (regexp_split_to_array(trim(name), '\s+'))[array_length(regexp_split_to_array(trim(name), '\s+'), 1)]
             || ' ' || upper(left((regexp_split_to_array(trim(name), '\s+'))[1], 1)) || '.'
      end as disp
    from public.participants
    where status = 'finished' and distance_logged is not null
    order by distance_logged desc
    limit 50
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

-- ---------------------------------------------------------------------------
-- P0-2 — moderator_update_config gains event_end_time, then recomputes the
-- waitlist (a widened window may free capacity). Body otherwise mirrors 0001.
-- Drop the old 5-arg signature first so the new optional 6th arg can't create an
-- overload ambiguity.
-- ---------------------------------------------------------------------------
drop function if exists public.moderator_update_config(text,timestamptz,int,int[],int);

create or replace function public.moderator_update_config(
  p_pin text,
  p_event_start_time timestamptz,
  p_buffer_seconds int,
  p_allowed_run_durations int[],
  p_queue_count int,
  p_event_end_time timestamptz default null
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
         queue_count = p_queue_count
   where id = 1
  returning * into v_cfg;

  perform public.recompute_waitlist();
  return to_jsonb(v_cfg);
end; $$;
grant execute on function public.moderator_update_config(text,timestamptz,int,int[],int,timestamptz) to anon, authenticated;
