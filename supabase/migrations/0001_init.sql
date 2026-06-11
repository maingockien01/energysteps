-- =============================================================================
-- EnergySteps — office running event — initial schema + RLS + RPCs
-- Paste this whole file into the Supabase SQL editor and run it once.
-- =============================================================================
-- SECURITY MODEL (see docs/ADR.md, ADR-002):
--   * The `participants` table holds PII (names, emails) and is LOCKED: the anon
--     role has NO direct SELECT/INSERT/UPDATE/DELETE on it. This guarantees an
--     anonymous REST client cannot read the participant list with emails.
--   * Public actions go through SECURITY DEFINER functions: sign_up(),
--     get_status_by_email().  These run with owner privileges but only ever
--     return the caller's own data (status lookup) or a de-identified queue
--     snapshot (no other names/emails).
--   * Moderator actions go through moderator_* SECURITY DEFINER functions that
--     validate a PIN against the moderator_pins table before doing anything.
--   * Non-sensitive config (queues, gifts, event_config) is anon-SELECT-able so
--     the public sign-up form and status projection can read it.
-- =============================================================================

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Single-row event configuration (enforced via id = 1 check).
create table if not exists public.event_config (
  id                    int primary key default 1 check (id = 1),
  event_start_time      timestamptz,
  buffer_seconds        int  not null default 120,
  queue_count           int  not null default 3 check (queue_count >= 1),
  allowed_run_durations int[] not null default '{300,600,900}',  -- seconds
  event_started         boolean not null default false,
  started_at            timestamptz
);

-- One row per running machine.
create table if not exists public.queues (
  id           uuid primary key default gen_random_uuid(),
  queue_number int  not null unique,        -- 1..queue_count
  name         text not null                -- e.g. "Machine 1"
);

create table if not exists public.gifts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  total_quantity     int  not null check (total_quantity >= 0),
  remaining_quantity int  not null check (remaining_quantity >= 0)
);

create table if not exists public.participants (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  department              text not null,
  email                   text not null,
  run_duration_seconds    int  not null check (run_duration_seconds > 0),
  assigned_queue_id       uuid not null references public.queues(id),
  position_in_queue       int  not null,
  status                  text not null default 'signed_up'
                            check (status in ('signed_up','checked_in','finished','skipped','no_show')),
  original_estimated_start timestamptz,     -- set once at event start, then immutable
  actual_start            timestamptz,
  actual_finish           timestamptz,
  distance_logged         numeric,
  gift_id                 uuid references public.gifts(id),
  created_at              timestamptz not null default now()
);

-- Case-insensitive unique email (the DB-level guarantee behind the friendly
-- "email already used" error on the sign-up form).
create unique index if not exists participants_email_unique
  on public.participants (lower(email));

create index if not exists participants_queue_idx
  on public.participants (assigned_queue_id, position_in_queue);

-- Moderator PINs (server-side authorization — see ADR-002). Keep this in sync
-- with the VITE_MODERATOR_PINS frontend env var.
create table if not exists public.moderator_pins (
  pin text primary key
);

-- ---------------------------------------------------------------------------
-- Seed data (safe defaults; edit in the Config view or here before launch)
-- ---------------------------------------------------------------------------
insert into public.event_config (id, buffer_seconds, queue_count, allowed_run_durations)
  values (1, 120, 3, '{300,600,900}')
  on conflict (id) do nothing;

-- Default machines matching the default queue_count (3).
insert into public.queues (queue_number, name) values
  (1, 'Machine 1'), (2, 'Machine 2'), (3, 'Machine 3')
  on conflict (queue_number) do nothing;

-- Default PIN. CHANGE THIS and keep it equal to VITE_MODERATOR_PINS.
insert into public.moderator_pins (pin) values ('1234')
  on conflict (pin) do nothing;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.event_config   enable row level security;
alter table public.queues         enable row level security;
alter table public.gifts          enable row level security;
alter table public.participants   enable row level security;
alter table public.moderator_pins enable row level security;

-- Non-sensitive config is readable by anyone (needed for the sign-up form and
-- the status-page projection). No write policies => anon cannot write directly.
create policy "anon can read event_config" on public.event_config
  for select using (true);
create policy "anon can read queues" on public.queues
  for select using (true);
create policy "anon can read gifts" on public.gifts
  for select using (true);

-- participants: NO policies => with RLS enabled, the anon role can do NOTHING
-- directly. All access is mediated by SECURITY DEFINER functions below.
-- (Intentionally empty. This is what protects the email list.)

-- moderator_pins: NO policies => never readable/writable by anon. Only the
-- SECURITY DEFINER functions (which run as owner, bypassing RLS) can read it.

-- ---------------------------------------------------------------------------
-- Helper: validate a moderator PIN (raises if invalid)
-- ---------------------------------------------------------------------------
create or replace function public.assert_moderator(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.moderator_pins where pin = p_pin) then
    raise exception 'INVALID_PIN' using errcode = '28000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- PUBLIC RPC: sign_up
-- Atomically: validate unique email, pick the shortest-wait queue, append to
-- it (permanent), insert the participant. Returns the created row + queue info
-- + a provisional estimated start computed from current queue contents.
-- ---------------------------------------------------------------------------
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
  v_wait_ahead     bigint;  -- seconds of run+buffer ahead of the new runner
  v_est            timestamptz;
begin
  select * into v_cfg from public.event_config where id = 1;

  -- validate run duration is one of the allowed values
  if not (p_run_duration_seconds = any (v_cfg.allowed_run_durations)) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  -- friendly duplicate-email guard (the unique index is the hard backstop)
  if exists (select 1 from public.participants where lower(email) = lower(trim(p_email))) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;

  -- choose the queue with the SHORTEST total remaining wait.
  -- wait(queue) = sum over not-yet-finished participants of (run + buffer).
  -- tie-break by lowest queue_number for determinism.
  select q.* into v_queue
  from public.queues q
  left join public.participants p
    on p.assigned_queue_id = q.id
   and p.status not in ('finished','skipped','no_show')
  group by q.id
  order by coalesce(sum(p.run_duration_seconds + v_cfg.buffer_seconds), 0) asc,
           q.queue_number asc
  limit 1;

  -- append to the end of the chosen queue
  select coalesce(max(position_in_queue), 0) + 1 into v_position
  from public.participants where assigned_queue_id = v_queue.id;

  insert into public.participants
    (name, department, email, run_duration_seconds, assigned_queue_id, position_in_queue)
  values
    (trim(p_name), trim(p_department), trim(p_email), p_run_duration_seconds, v_queue.id, v_position)
  returning * into v_participant;

  -- provisional estimate (pre-start display only): event_start + wait ahead.
  -- "ahead" = not-yet-finished participants in this queue with a smaller position.
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

-- ---------------------------------------------------------------------------
-- PUBLIC RPC: get_status_by_email
-- Returns the caller's own participant record, their queue, the event config,
-- and a DE-IDENTIFIED snapshot of everyone in their queue (positions, run
-- durations, statuses, timestamps — NO names/emails) so the client can compute
-- live position + projection without exposing other people's PII.
-- ---------------------------------------------------------------------------
create or replace function public.get_status_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     public.participants%rowtype;
  v_queue  public.queues%rowtype;
  v_cfg    public.event_config%rowtype;
  v_members jsonb;
begin
  select * into v_me from public.participants
   where lower(email) = lower(trim(p_email)) limit 1;

  if v_me.id is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_queue from public.queues where id = v_me.assigned_queue_id;
  select * into v_cfg from public.event_config where id = 1;

  -- de-identified queue members (NO name/email)
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
    'me', to_jsonb(v_me),
    'queue', to_jsonb(v_queue),
    'config', to_jsonb(v_cfg),
    'queue_members', v_members
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: full state for the console
-- ---------------------------------------------------------------------------
create or replace function public.moderator_get_state(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
begin
  perform public.assert_moderator(p_pin);
  select jsonb_build_object(
    'config', (select to_jsonb(c) from public.event_config c where id = 1),
    'queues', (select coalesce(jsonb_agg(to_jsonb(q) order by q.queue_number), '[]'::jsonb) from public.queues q),
    'gifts',  (select coalesce(jsonb_agg(to_jsonb(g) order by g.name), '[]'::jsonb) from public.gifts g),
    'participants', (select coalesce(jsonb_agg(to_jsonb(p) order by p.assigned_queue_id, p.position_in_queue), '[]'::jsonb)
                     from public.participants p)
  ) into v_state;
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: check in the current head runner (auto actual_start = now())
-- ---------------------------------------------------------------------------
create or replace function public.moderator_check_in(p_pin text, p_participant_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.participants
     set status = 'checked_in', actual_start = now()
   where id = p_participant_id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: check out (auto actual_finish = now()) + distance + gift.
-- Decrements the gift's remaining_quantity when a gift is given.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_check_out(
  p_pin text, p_participant_id uuid, p_distance numeric, p_gift_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
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
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: skip / no-show (advance queue, NO rebalance, NO recompute)
-- ---------------------------------------------------------------------------
create or replace function public.moderator_skip(
  p_pin text, p_participant_id uuid, p_status text
)
returns jsonb
language plpgsql security definer set search_path = public
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
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: edit a runner's sign-up fields. Queue is NEVER changed.
-- Re-validates unique email.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_update_participant(
  p_pin text, p_id uuid, p_name text, p_department text,
  p_email text, p_run_duration_seconds int
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row public.participants%rowtype;
begin
  perform public.assert_moderator(p_pin);
  if exists (select 1 from public.participants
              where lower(email) = lower(trim(p_email)) and id <> p_id) then
    raise exception 'EMAIL_TAKEN' using errcode = '23505';
  end if;
  update public.participants
     set name = trim(p_name),
         department = trim(p_department),
         email = trim(p_email),
         run_duration_seconds = p_run_duration_seconds
   where id = p_id
  returning * into v_row;   -- NOTE: assigned_queue_id intentionally untouched
  return to_jsonb(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPCs: gift CRUD
-- ---------------------------------------------------------------------------
create or replace function public.moderator_create_gift(
  p_pin text, p_name text, p_quantity int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.gifts%rowtype;
begin
  perform public.assert_moderator(p_pin);
  insert into public.gifts (name, total_quantity, remaining_quantity)
  values (trim(p_name), p_quantity, p_quantity)
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.moderator_update_gift(
  p_pin text, p_id uuid, p_name text, p_total_quantity int, p_remaining_quantity int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.gifts%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.gifts
     set name = trim(p_name),
         total_quantity = p_total_quantity,
         remaining_quantity = p_remaining_quantity
   where id = p_id
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create or replace function public.moderator_delete_gift(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_moderator(p_pin);
  -- null out references first so finished runners keep a valid row
  update public.participants set gift_id = null where gift_id = p_id;
  delete from public.gifts where id = p_id;
end; $$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: update event config.
-- queue_count is editable ONLY before the event starts AND only while no
-- participants exist (changing it would orphan permanent queue assignments —
-- see ADR-005). When it changes, queues are regenerated to match.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_update_config(
  p_pin text,
  p_event_start_time timestamptz,
  p_buffer_seconds int,
  p_allowed_run_durations int[],
  p_queue_count int
)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    -- safe to regenerate machines
    delete from public.queues;
    insert into public.queues (queue_number, name)
    select gs, 'Machine ' || gs from generate_series(1, p_queue_count) gs;
  end if;

  update public.event_config
     set event_start_time = p_event_start_time,
         buffer_seconds = p_buffer_seconds,
         allowed_run_durations = p_allowed_run_durations,
         queue_count = p_queue_count
   where id = 1
  returning * into v_cfg;
  return to_jsonb(v_cfg);
end; $$;

-- ---------------------------------------------------------------------------
-- MODERATOR RPC: start the event.
-- Captures each participant's original_estimated_start (immutable thereafter)
-- as event_start_time + cumulative (run + buffer) of everyone ahead in their
-- queue, ordered by position. Locks queue_count and flips event_started.
-- ---------------------------------------------------------------------------
create or replace function public.moderator_start_event(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.event_config%rowtype;
begin
  perform public.assert_moderator(p_pin);
  select * into v_cfg from public.event_config where id = 1;

  if v_cfg.event_started then
    raise exception 'ALREADY_STARTED' using errcode = '22023';
  end if;
  if v_cfg.event_start_time is null then
    raise exception 'NO_START_TIME' using errcode = '22023';
  end if;

  -- Compute cumulative offsets per queue using a window running sum that
  -- EXCLUDES the current row (everyone "ahead" only), ordered by position.
  with ordered as (
    select id,
           v_cfg.event_start_time
             + make_interval(secs => coalesce(
                 sum(run_duration_seconds + v_cfg.buffer_seconds)
                   over (partition by assigned_queue_id
                         order by position_in_queue
                         rows between unbounded preceding and 1 preceding), 0)) as est
    from public.participants
  )
  update public.participants p
     set original_estimated_start = o.est
    from ordered o
   where p.id = o.id;

  update public.event_config
     set event_started = true, started_at = now()
   where id = 1
  returning * into v_cfg;
  return to_jsonb(v_cfg);
end; $$;

-- ---------------------------------------------------------------------------
-- Privileges: allow the anon (and authenticated) roles to EXECUTE the RPCs.
-- They still cannot touch the tables directly (RLS + no policies on PII).
-- ---------------------------------------------------------------------------
grant execute on function public.sign_up(text,text,text,int) to anon, authenticated;
grant execute on function public.get_status_by_email(text) to anon, authenticated;
grant execute on function public.moderator_get_state(text) to anon, authenticated;
grant execute on function public.moderator_check_in(text,uuid) to anon, authenticated;
grant execute on function public.moderator_check_out(text,uuid,numeric,uuid) to anon, authenticated;
grant execute on function public.moderator_skip(text,uuid,text) to anon, authenticated;
grant execute on function public.moderator_update_participant(text,uuid,text,text,text,int) to anon, authenticated;
grant execute on function public.moderator_create_gift(text,text,int) to anon, authenticated;
grant execute on function public.moderator_update_gift(text,uuid,text,int,int) to anon, authenticated;
grant execute on function public.moderator_delete_gift(text,uuid) to anon, authenticated;
grant execute on function public.moderator_update_config(text,timestamptz,int,int[],int) to anon, authenticated;
grant execute on function public.moderator_start_event(text) to anon, authenticated;

-- assert_moderator is a helper; not granted to anon (called internally only).
revoke execute on function public.assert_moderator(text) from anon, authenticated;
