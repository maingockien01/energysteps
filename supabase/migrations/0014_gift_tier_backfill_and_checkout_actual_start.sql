-- =============================================================================
-- 0014 — Review fixes: (M1) backfill gift→duration mapping; (L2) never leave a
--        finished runner with a null actual_start.
--
-- M1  The seed gifts (Cafe / Nước ép / Set hoa quả) were inserted in 0004,
--     BEFORE gifts.duration_seconds existed (added in 0012). 0012 never
--     backfilled them, so every seeded gift has duration_seconds = NULL and
--     moderator_suggest_gift() matches nothing — the documented "auto-select
--     the right gift at check-out" never fires on a fresh deploy. Backfill the
--     three known seeds by name. Guarded with `duration_seconds is null` so a
--     moderator's manual tier mapping is never overwritten, and re-runnable.
--
-- L2  moderator_check_out() could finish a runner who auto-started without an
--     explicit check-in (the board allows check-out once the buffer elapses),
--     leaving status='finished' with actual_start=NULL. Stamp actual_start =
--     coalesce(actual_start, now()) so a finished row always has a start. Body
--     is 0009's authoritative version (one-gift-per-email + stock + distance
--     guards) with only that one change.
--
-- Run AFTER 0013_status_member_created_at.sql. Idempotent / safe to re-run.
-- =============================================================================

-- ---- M1 — backfill the seed gift→duration mapping (only where unset) --------
update public.gifts set duration_seconds = 120
  where lower(name) = lower('Cafe')        and duration_seconds is null;
update public.gifts set duration_seconds = 180
  where lower(name) = lower('Nước ép')     and duration_seconds is null;
update public.gifts set duration_seconds = 300
  where lower(name) = lower('Set hoa quả') and duration_seconds is null;

-- ---- L2 — moderator_check_out: guarantee a non-null actual_start ------------
create or replace function public.moderator_check_out(
  p_pin text, p_participant_id uuid, p_distance numeric, p_gift_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_row   public.participants%rowtype;
  v_email text;
  v_remaining int;
begin
  perform public.assert_moderator(p_pin);

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
         -- L2: a runner who auto-started without an explicit check-in still gets
         -- a start stamped here, so no finished row is left with a null start.
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
