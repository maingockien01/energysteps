-- =============================================================================
-- 0004 — Event defaults for the mblife "EnergySteps / Amazers" run
--   * run durations  -> 2 / 3 / 5 minutes  (120, 180, 300 seconds)
--   * machines        -> exactly 2
--   * gifts (by tier) -> Cafe (50), Nước ép (30), Set hoa quả (20)
--
-- The @mblife.vn sign-up email guard lives in 0003_signup_concurrency.sql (the
-- single, concurrency-safe definition of sign_up()). Run this AFTER 0003.
--
-- SAFE TO RE-RUN. The machine reset only runs when no participants exist yet
-- (queues are FK-referenced by participants and are permanent once people sign
-- up — see ADR-005). If sign-ups already exist, set machines/durations/gifts
-- from the moderator Config & Gifts tabs instead.
-- =============================================================================

-- ---- Durations + machine count -------------------------------------------
update public.event_config
   set allowed_run_durations = '{120,180,300}',
       queue_count = 2
 where id = 1;

-- Regenerate machines to exactly 2, but only if nobody has signed up yet.
do $$
begin
  if not exists (select 1 from public.participants) then
    delete from public.queues;
    insert into public.queues (queue_number, name) values
      (1, 'Machine 1'), (2, 'Machine 2');
  end if;
end $$;

-- ---- Gifts (one per duration tier) ----------------------------------------
-- Insert each only if a gift with that name doesn't already exist (idempotent).
insert into public.gifts (name, total_quantity, remaining_quantity)
select v.name, v.qty, v.qty
from (values
        ('Cafe', 50),
        ('Nước ép', 30),
        ('Set hoa quả', 20)
     ) as v(name, qty)
where not exists (
  select 1 from public.gifts g where lower(g.name) = lower(v.name)
);
