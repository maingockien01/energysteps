-- =============================================================================
-- 0012 — Map gifts to a run-duration tier + backend-driven checkout suggestion
--
-- Until now the gift⇄duration relationship was a hardcoded NAME match in the
-- frontend (src/lib/gifts.ts GIFT_TIERS). This makes it data-driven and adds a
-- backend suggestion so the checkout dropdown can auto-pick the right in-stock
-- gift, with the authoritative stock read on the server (concurrency-safe: the
-- actual award still decrements under the for-update guard in moderator_check_out
-- from 0009, so two moderators can never oversell a tier).
--
--   * gifts.duration_seconds — the run-duration tier this gift is awarded for
--     (null = not tied to a tier / general gift).
--   * moderator_create_gift / moderator_update_gift — accept the mapping.
--   * moderator_suggest_gift(pin, participant_id) — returns the best in-stock
--     gift for that participant's duration, or null (also null if the runner's
--     email has already been awarded a gift anywhere — one-gift-per-email, 0007).
--
-- Run AFTER 0011_move_grace.sql. Idempotent / safe to re-run.
-- =============================================================================

alter table public.gifts
  add column if not exists duration_seconds int;

-- ---- create / update gift: carry the duration mapping ----------------------
drop function if exists public.moderator_create_gift(text,text,int);
create or replace function public.moderator_create_gift(
  p_pin text, p_name text, p_quantity int, p_duration_seconds int default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.gifts%rowtype;
begin
  perform public.assert_moderator(p_pin);
  insert into public.gifts (name, total_quantity, remaining_quantity, duration_seconds)
  values (trim(p_name), p_quantity, p_quantity, p_duration_seconds)
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_create_gift(text,text,int,int) to anon, authenticated;

drop function if exists public.moderator_update_gift(text,uuid,text,int,int);
create or replace function public.moderator_update_gift(
  p_pin text, p_id uuid, p_name text, p_total_quantity int,
  p_remaining_quantity int, p_duration_seconds int default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.gifts%rowtype;
begin
  perform public.assert_moderator(p_pin);
  update public.gifts
     set name = trim(p_name),
         total_quantity = p_total_quantity,
         remaining_quantity = p_remaining_quantity,
         duration_seconds = p_duration_seconds
   where id = p_id
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.moderator_update_gift(text,uuid,text,int,int,int) to anon, authenticated;

-- ---- suggest the gift to auto-select at checkout ---------------------------
-- Authoritative, live read. Returns {gift_id, gift_name} for the in-stock gift
-- matching the participant's run duration, or null when there is none or the
-- runner's email already holds a gift (one-gift-per-email).
create or replace function public.moderator_suggest_gift(
  p_pin text, p_participant_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dur   int;
  v_email text;
  v_gift  public.gifts%rowtype;
begin
  perform public.assert_moderator(p_pin);

  select run_duration_seconds, lower(trim(email))
    into v_dur, v_email
    from public.participants where id = p_participant_id;
  if v_dur is null then
    return jsonb_build_object('gift_id', null, 'gift_name', null);
  end if;

  -- One gift per email across all participations: nothing to suggest if already
  -- awarded somewhere.
  if exists (
    select 1 from public.participants
     where lower(trim(email)) = v_email and gift_id is not null
  ) then
    return jsonb_build_object('gift_id', null, 'gift_name', null);
  end if;

  select * into v_gift
    from public.gifts
   where duration_seconds = v_dur and remaining_quantity > 0
   order by remaining_quantity desc
   limit 1;

  return jsonb_build_object('gift_id', v_gift.id, 'gift_name', v_gift.name);
end; $$;
grant execute on function public.moderator_suggest_gift(text,uuid) to anon, authenticated;
