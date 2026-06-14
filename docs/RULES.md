# ENERGY STEPS — Official Program Rules ("Thể lệ")

This is the **source of truth** for the contest rules the app implements, taken
verbatim from the organizer (PM) brief. When code and this doc disagree, this
doc wins for *intent* — but see "Known deviations" at the bottom for the two
places the running app currently differs, which are open product decisions, not
bugs to silently "fix."

Last reconciled against the code: 2026-06-11 (commit `56dce27`).

---

## How to participate

### Step 1 — Register
Amazers scan a QR code to register. Registration collects:

- **Họ và tên** (full name)
- **Khối/Phòng** (block / department) — stored under the `department` key; the
  UI label is "Domain / Khối/Phòng".
- **Mức thử thách mong muốn** (desired challenge level)

The three challenge levels:

| Level   | Duration |
|---------|----------|
| Mức 1   | 2 minutes (120 s) |
| Mức 2   | 3 minutes (180 s) |
| Mức 3   | 5 minutes (300 s) |

> **Rule:** *"Không giới hạn số lần đăng ký, tuy nhiên mỗi Amazer chỉ được nhận
> quà 01 lần trong suốt chương trình."* — No limit on the number of
> registrations; **but each Amazer may receive a gift only once** for the whole
> program. (Repeated under General rules: *"Không giới hạn số lượt đăng ký."*)
>
> **How the app implements this** (migration `0007`): an email may register and
> run **multiple times**, but only **one *active* registration at a time** — you
> can sign up again once your previous attempt is finished / skipped / no-show.
> A gift may be awarded to an email **at most once across all its runs**;
> check-out blocks a second gift (`GIFT_ALREADY_AWARDED`).

### Step 2 — Track the schedule
After a successful registration the Amazer keeps the info the system gives them:

- **Thứ tự tham gia** — position in queue
- **Máy thực hiện** — assigned machine
- **Thời gian dự kiến bắt đầu** — estimated start time

Amazers should arrive at the venue ~5 minutes before their estimated time.

### Step 3 — Do the challenge
- **Location:** Sảnh tầng 15 (15th-floor lobby).
- BTC guides the Amazer on the walking machine.
- On completion BTC records the **distance in km** shown on the machine at the
  moment the challenge ends.

---

## Gift structure

### 1. Completion gifts (Quà hoàn thành thử thách)
First N **finishers** in each level, ranked by finish time, receive:

| Level        | First N | Gift          |
|--------------|---------|---------------|
| 2 min (120s) | 50      | Cafe          |
| 3 min (180s) | 30      | Nước ép       |
| 5 min (300s) | 20      | Set hoa quả   |

Each Amazer receives **at most one** completion gift. This is enforced
per-email at check-out (migration `0007`): if any other registration for the
same email already holds a gift, the moderator can only check the runner out
with **"No gift"**. At check-out the moderator must make an explicit gift
decision — either pick a gift or tick **"No gift"** (no silent default).

### 2. Achievement awards (Giải thưởng thành tích)
- A special prize for the top performers **at each level**.
- **One winner per level** — the longest distance recorded by BTC.
- **Tie-break:** if several runners tie on distance, the one who **finished
  earliest** wins.

> **Note (see deviation D):** the running app does **not** advertise an
> individual "top 1" gift to participants at sign-up. Sign-up messaging frames a
> run's competitive value as contributing to the **department total distance**.
> Confirm whether the per-level achievement award above is still being given so
> this section and the app stay in sync.

---

## General rules (Quy định chung)
- No limit on the number of registrations.
- Achievement is judged by the **originally-registered** challenge level.
- BTC may reject invalid or rule-breaking registrations.
- BTC's decision is final.

---

## Where each rule lives in the code

| Rule | Implementation |
|------|----------------|
| 3 levels = 2/3/5 min | `event_config.allowed_run_durations = {120,180,300}` — `supabase/migrations/0004_event_defaults.sql` |
| Registration fields | `src/pages/SignUpPage.tsx` (name, domain→`department`, duration; **+ email**) |
| Multiple registrations, one active per email | `sign_up()` + partial unique index `participants_active_email_unique` — `supabase/migrations/0007_one_gift_per_email_multi_signup.sql` |
| One gift per email (across all runs) | `moderator_check_out()` guard → `GIFT_ALREADY_AWARDED` (0007); surfaced in `src/moderator/BoardView.tsx` |
| Explicit gift / "No gift" at check-out | `src/moderator/BoardView.tsx` (`skipGift` checkbox + validation) |
| Queue position / machine / estimated start | `SignUpResult`, `src/pages/StatusPage.tsx`, `src/lib/queueLogic.ts` |
| Distance in km at finish | `moderator_check_out()` → `participants.distance_logged` (0001) |
| Completion-gift tiers + quantities | `GIFT_TIERS` in `src/lib/gifts.ts`; gift seeds in `0004_event_defaults.sql` |
| First-N-finishers, ranked by finish time | `src/moderator/GiftEligibility.tsx` (sorts by `actual_finish` asc) |
| Achievement = top distance per level | `get_leaderboard()` in `0006_leaderboard_by_duration.sql`; rendered per-tier in `src/pages/LeaderboardPage.tsx` |
| Achievement by registered level | `participants.run_duration_seconds` (set at signup) |

---

## Known deviations (open product decisions — read before "fixing")

### A. Email-unique vs. "unlimited registrations" — RESOLVED (migration 0007)
Originally the app enforced **one signup per email** (`EMAIL_TAKEN`) with no
separate gift-once mechanism — stricter than the rule.

Resolved by allowing **re-registration once the prior attempt is complete**
(at most one *active* registration per email, via a partial unique index) and
moving gift-once enforcement to **check-out** (a gift is rejected if the email
already holds one). This matches the sign-up form's existing "you can register
again after finishing" copy.

**Deliberately NOT fully unlimited-simultaneous:** an email cannot hold a second
active slot while one is still pending — this stops one person occupying both
machines at once. If the PM wants literally unlimited concurrent registrations,
drop the `status not in (...)` filter in `sign_up()` and the partial index in
`0007`.

### B. Achievement tie-break is not implemented
The rule breaks distance ties by **earliest finish time**. `get_leaderboard()`
currently orders by `distance_logged desc` only (within each duration tier),
with no secondary sort — so ties are non-deterministic. Fix: add
`, actual_finish asc` to the `order by` in `0006_leaderboard_by_duration.sql`
(needs `actual_finish` selected in the inner query).

### C. Minor
- Challenge levels are shown as durations ("Mức thử thách 2 phút"), not as the
  literal labels "Mức 1/2/3". Equivalent meaning.
- **Email** and the **`@mblife.vn`** domain guard are extra eligibility
  constraints not mentioned in the rules.
- The venue ("Sảnh tầng 15") and "arrive 5 min early" are not surfaced in the
  app UI (informational only).
- A moderator can edit a runner's `run_duration_seconds` after signup, which can
  move them between levels (rule says achievement is by the *originally*
  registered level). Accepted as a manual BTC override.

### D. No individual "top 1" gift surfaced at sign-up
Per the organizer, there is **no individual "top 1" gift for individual runs** —
an individual run's competitive contribution is to the **department total
distance** (the headline leaderboard ranking). The sign-up confirmation messaging
reflects this: runners who won't receive a completion gift (tier exhausted / out
of stock / already gifted on a prior run) are encouraged that their distance adds
to their department total, **not** that an individual prize awaits. See
`APP_LOGIC_OVERVIEW.md §5` and the `confirm.giftGone` / `confirm.giftAlready`
strings.

This needs reconciling with §2 "Achievement awards" above (the verbatim brief,
left intact): if the per-level top-distance prize is no longer awarded, update
§2; if it is still given, it's simply not advertised in the sign-up flow.
