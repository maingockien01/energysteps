-- 0016_rename_queue.sql
-- Moderator-editable machine names. Machines default to "Machine N"; let the
-- organizer give each a fun, event-themed name. Purely cosmetic — machine
-- assignment and the no-rebalancing invariant are unaffected.
--
-- NOTE: changing the machine COUNT in Config regenerates the queues and resets
-- their names, so rename AFTER the machine count is fixed.

create or replace function public.moderator_rename_queue(
  p_pin text, p_queue_id uuid, p_name text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := trim(p_name);
begin
  perform public.assert_moderator(p_pin);
  if coalesce(v_name, '') = '' or char_length(v_name) > 40 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  update public.queues set name = v_name where id = p_queue_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
end; $$;

grant execute on function public.moderator_rename_queue(text, uuid, text) to anon, authenticated;
