-- =============================================================================
-- 0018 — Require an explicit check-in before check-out
--
-- Previously a runner whose buffer elapsed could be checked OUT directly from the
-- auto-running state (0014's check-out stamped a start for them). Product change:
-- a runner must be checked IN before they can be checked out. Late arrivals are
-- now checked in via the adjustable-run-time control added in 0017, so there is
-- always a real check-in (and actual_start) behind every finish.
--
-- Body mirrors 0014 plus a status guard at the top (before any gift decrement,
-- so a rejected check-out never touches stock). Run AFTER 0017. Idempotent.
-- =============================================================================
create or replace function public.moderator_check_out(
  p_pin text, p_participant_id uuid, p_distance numeric, p_gift_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row    public.participants%rowtype;
  v_email  text;
  v_remaining int;
  v_status text;
begin
  perform public.assert_moderator(p_pin);

  -- Must be checked in first. Guard BEFORE any gift/stock work.
  select status into v_status
    from public.participants where id = p_participant_id;
  if v_status is null then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if v_status <> 'checked_in' then
    raise exception 'NOT_CHECKED_IN' using errcode = '22023';
  end if;

  -- H3 — distance must be a finite, non-negative number when provided.
  if p_distance is not null
     and (p_distance < 0 or p_distance = 'NaN'::numeric
          or p_distance = 'Infinity'::numeric or p_distance = '-Infinity'::numeric) then
    raise exception 'INVALID_DISTANCE' using errcode = '22023';
  end if;

  if p_gift_id is not null then
    -- One gift per email across ALL of a runner's registrations (0007).
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

    -- H2 — never award a gift that is out of stock (no silent floor-at-zero).
    select remaining_quantity into v_remaining
      from public.gifts where id = p_gift_id
      for update;
    if v_remaining is null or v_remaining <= 0 then
      raise exception 'GIFT_OUT_OF_STOCK' using errcode = '23514';
    end if;

    update public.gifts
       set remaining_quantity = remaining_quantity - 1
     where id = p_gift_id;
  end if;

  update public.participants
     set status = 'finished',
         actual_start = coalesce(actual_start, now()),
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

grant execute on function public.moderator_check_out(text,uuid,numeric,uuid) to anon, authenticated;
