-- =============================================================================
-- 0009 — One-time-event hardening (review follow-up)
--   C1  Retire the guessable default PIN '1234'. The moderator console exposes
--       every participant's name + email via moderator_get_state, and the gate
--       is just this PIN — so a default of '1234' means anyone who guesses the
--       obvious value gets the full email list. Replace it with a real secret.
--   H2  moderator_check_out: REJECT awarding a gift whose stock is exhausted
--       (the old greatest(remaining-1,0) silently floored at 0 → overselling a
--       fixed physical stock on the day, with no do-over).
--   H3  moderator_check_out: REJECT a negative / NaN / infinite distance
--       (defense in depth; the board form also validates client-side now).
--
-- Run AFTER 0008_pm_feedback.sql. The check_out body below is 0007's
-- authoritative version (one-gift-per-email) plus the two new guards.
-- Idempotent / safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- C1 — retire the default '1234' PIN.
--
-- DELIBERATELY NOT DONE HERE. The new PIN is a secret and this file lives in
-- git; committing the real value would just recreate the "guessable PIN in a
-- known place" problem. Set it MANUALLY (Supabase SQL editor), once, with your
-- own value — do not commit it anywhere:
--
--     delete from public.moderator_pins where pin = '1234';
--     insert into public.moderator_pins (pin) values ('<your-secret-pin>');
--
-- The PIN column is plain `text`, so make it long and non-guessable (a long
-- number is easiest to type on the day). Then tell your moderators.
-- ---------------------------------------------------------------------------
-- H2 + H3 — moderator_check_out with a stock guard and a distance guard.
-- Body mirrors 0007 (one-gift-per-email) with the two new validations added.
-- ---------------------------------------------------------------------------
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
