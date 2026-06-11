# Manual test plan — EnergySteps

Human-runnable checklist. Each step has an action and an expected result. Run
against a live Supabase project (see RELEASE.md) with the dev server
(`npm run dev`) or the deployed site.

**Setup (do once):**
- S1. Run the migration (`supabase/migrations/0001_init.sql`). *Expected:* success.
- S2. `.env` (or Netlify env) has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  and `VITE_MODERATOR_PINS` set; the PIN(s) match the `moderator_pins` table.
- S3. In **Config**: set machines = **2**, buffer = **120** s, allowed durations
  = e.g. **5 / 10 / 15 min**, and an event start time a few minutes in the
  future. Add two gifts in **Gifts** (e.g. "Water bottle" ×5, "T-shirt" ×3).
  *Do NOT start the event yet.*

> Tip: to test the slot timer quickly, use a short buffer (e.g. 30 s) and short
> run durations (you can add e.g. a 1-minute = 60 s duration in Config).

---

## A. Sign-up + shortest-queue assignment
1. Go to `/`. Sign up **Alice / Eng / alice@x.com / 10 min**.
   *Expected:* confirmation shows an assigned machine (say **Machine 1**) and an
   estimated window.
2. Sign up **Bob / Eng / bob@x.com / 10 min**.
   *Expected:* Bob is assigned to the **other** machine (**Machine 2**) — the
   shortest-wait queue, since Machine 1 now has 10 min + buffer of wait.
3. Sign up **Carol / Eng / carol@x.com / 5 min**.
   *Expected:* Carol joins whichever machine has the smaller total wait (both
   have one 10-min runner, so it's a tie → lowest machine number, **Machine 1**).
4. Open the moderator **Board**.
   *Expected:* Machine 1 head = Alice, with Carol upcoming; Machine 2 head = Bob.

## B. Duplicate-email rejection
5. Go to `/`, sign up **Alice2 / Eng / ALICE@x.com / 5 min** (same email,
   different case).
   *Expected:* a friendly error: the email is already signed up; no second row is
   created. (Confirm in Runners that there's still only one alice@x.com.)

## C. Participant status lookup
6. Go to `/status`, enter **bob@x.com**.
   *Expected:* shows Bob's machine, position in line (1 = up next on Machine 2),
   and a projected start. "Original estimated start" reads "Set when the event
   starts" (event not started yet).
7. Enter a never-used email (e.g. `nobody@x.com`).
   *Expected:* "No sign-up found for that email."

## D. Start event + original estimate is captured and immutable
8. In **Config**, click **Start event** and confirm.
   *Expected:* event shows as started; **machine count is now locked/disabled**
   with a "Locked (event started)" badge.
9. Reload `/status` for **carol@x.com** and note her **Original estimated start**
   value.
   *Expected:* it now shows a concrete time (= event start + Alice's 10 min +
   buffer, since Carol is behind Alice on Machine 1).
10. Later, after some delays occur (Section F/G), re-check Carol's status.
    *Expected:* her **Original estimated start never changes** from the value in
    step 9, even as her *projected* start moves.

## E. queue_count locked after start
11. In **Config**, try to change the number of machines.
    *Expected:* the field is disabled / not editable; a badge explains it's
    locked because the event started. (Also: before any sign-up existed it was
    editable — that was exercised in setup S3.)

## F. Check-in / check-out with automatic timestamps + slot timer
12. On the **Board**, select Machine 1. The head is Alice, phase
    **awaiting check-in**, with a "check-in window" countdown.
    *Expected:* countdown runs down from the buffer toward 0:00.
13. Click **Check in** for Alice.
    *Expected:* phase switches to **running**; a run-time-remaining countdown
    shows; Alice's **start time is set automatically** (visible as "started
    HH:MM" — you never typed it).
14. **Late check-in / less run time:** wait until the check-in countdown has
    nearly elapsed (or past it) for the *next* runner before checking them in,
    and observe the run countdown.
    *Expected:* because the slot is anchored to the previous checkout, a late
    check-in starts the run countdown already partway down — **less remaining run
    time** than a full slot. (You can also verify with the unit test
    `computeSlotTimer` → "running … anchored to prev checkout".)
15. Click **Check out** for Alice. Enter distance **1500** and pick the gift
    **Water bottle**. Confirm.
    *Expected:* Alice's **finish time is set automatically**; the queue advances
    so **Carol becomes the head** and her slot timer starts (anchored to Alice's
    checkout).

## G. Gift decrement
16. Go to **Gifts**.
    *Expected:* "Water bottle" remaining is now **4** (was 5) after step 15.

## H. No-show / skip with NO rebalancing
17. Sign up **Dave / Eng / dave@x.com / 10 min** (joins the shorter machine).
    Note which machine and the head/upcoming order, and note Carol's
    **original estimated start**.
18. On the Board, for the current head of some machine, click **No-show** and
    confirm.
19. *Expected:*
    - That runner is marked no-show and the **next runner becomes head**.
    - **No runner moved between machines** (verify in Runners — everyone's
      machine is unchanged).
    - **No original estimates changed** (re-check Carol's status — her original
      estimate equals step 17's value). Her *projected* time may move; her
      *original* must not.

## I. Runner management (edit only, no cross-queue move)
20. Go to **Runners**, search `bob`. Open Bob's edit form.
    *Expected:* you can edit name, department, email, run duration. **There is NO
    control to change Bob's machine** — it's shown read-only.
21. Change Bob's department to "Sales" and save.
    *Expected:* the list reflects "Sales"; his machine is unchanged.
22. Try editing Bob's email to **carol@x.com** (an existing email).
    *Expected:* friendly duplicate-email error; no change saved.

## J. Delay alert on the status page
23. Ensure at least one runner ran longer than planned (e.g. you checked Alice in
    late, or checked her out well after her slot end). Open `/status` for a
    runner **behind** that delay (e.g. carol@x.com).
    *Expected:* a large, prominent banner — *"Running ~X minutes behind — your new
    estimated check-in is HH:MM"* — with the minutes shown big. A runner who is
    still on time shows the calm green "On schedule" state instead.
24. Leave the status page open and have a moderator check someone out on that
    machine.
    *Expected:* the status page updates **live** (Realtime) without you clicking
    anything; the manual **Refresh** button also re-pulls the latest numbers.

## K. CSV export
25. Go to **Export**, click **Download CSV**.
    *Expected:* a `energysteps-export.csv` downloads containing **every**
    participant with columns: Name, Department, Email, Machine, Run Duration,
    Original Estimate, Actual Start, Actual Finish, Distance, Gift, Status.
    Finished runners show their actual times, distance, and gift; commas/quotes
    in any name are properly escaped (open in a spreadsheet to confirm columns
    line up).

## L. RLS — anonymous client cannot read the participant list
26. Confirm emails are NOT exposed to an anonymous REST read. In a terminal
    (substitute your project URL and anon key):
    ```bash
    curl "https://<PROJECT>.supabase.co/rest/v1/participants?select=*" \
      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
    ```
    *Expected:* an **empty array `[]`** or a permission error — **never** a list
    of participants with their emails. (The table has no anon read policy; all
    legitimate reads go through the security-definer functions.)
27. Confirm the **status lookup leaks no identity**. With a known email, call the
    public lookup RPC directly (no PIN):
    ```bash
    curl "https://<PROJECT>.supabase.co/rest/v1/rpc/get_status_by_email" \
      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
      -H "Content-Type: application/json" -d '{"p_email":"alice@x.com"}'
    ```
    *Expected:* JSON with `found: true`, a de-identified `me` (position, estimate,
    status, run duration), the queue, config, and queue_members — but **no
    `name`, `department`, or `email`** anywhere in the response.
28. Confirm the moderator console still works (it reads via the PIN-gated
    function, not the table) — the Board shows full names. And confirm an
    **invalid PIN** is rejected at `/moderator` (try `0000`).

---

### Automated coverage
`npm test` runs the pure queue-math unit tests (`src/lib/queueLogic.test.ts`):
shortest-wait anchoring, active ordering, on-schedule vs delayed projection,
finished-runner projection, and the checkout-anchored slot timer (incl. the
late-check-in / prev-checkout anchoring). These back steps A, F, H, and J.
