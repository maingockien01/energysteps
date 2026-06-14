-- =============================================================================
-- 0013 — Expose created_at on get_status_by_email queue_members
--
-- The idle-machine move grace (#7) now anchors a late arrival's slot to their
-- SIGN-UP time (created_at) + grace — a fixed point, so the participant status
-- page and the moderator board compute an identical estimate and the check-in
-- countdown still elapses. For the status page to do that math it needs each
-- queue member's created_at. Body is 0010's plus that one field on queue_members
-- (still no name/email — de-identification is unchanged).
--
-- Run AFTER 0012_gift_duration_mapping.sql. Idempotent / safe to re-run.
-- =============================================================================
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
