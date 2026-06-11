# Features — how EnergySteps behaves

Plain-English description of every feature and the rules behind it.

---

## Public sign-up (`/`)

- Anyone can sign up with **name, department, email, and a run duration** chosen
  from the organizer-configured list.
- **Email is unique.** If an email has already signed up, the form rejects it
  with a friendly message — one registration per email.
- On submit, the system **permanently assigns** the runner to the queue (machine)
  with the **shortest total wait time** and appends them to the end of it. Wait
  time of a queue = the sum of `(run duration + buffer)` for everyone in that
  queue who hasn't finished yet. Ties go to the lowest-numbered machine.
- The runner immediately sees their **assigned machine** and an **estimated
  check-in window** (start → start + buffer). If the organizer hasn't set an
  event start time yet, the window is shown as "available later."
- **Assignment is permanent.** Once assigned, a runner is never moved to another
  machine (see "No rebalancing" below).

## Participant status lookup (`/status`)

- A participant types their **email** to look up their own status. No login.
- They see: their **assigned machine**, their **original estimated start** (once
  the event has started), their **current projected start**, and their **live
  position in line** (1 = up next).
- **Delay alert:** if the current projection is later than their original
  estimate, a large, impossible-to-miss banner appears —
  *"Running ~X minutes behind — your new estimated check-in is HH:MM"* — with the
  delay in minutes shown big and bold. If they're on time, a calm green
  "On schedule" state shows instead. The projection is never shown as *earlier*
  than the original estimate.
- The page **updates live** (Supabase Realtime) and also has a manual **Refresh**
  button.

## Moderator console (`/moderator`, PIN-gated)

Access requires a PIN (see RELEASE.md step 5). The console has five tabs:

### 1. Board (live ops)
- One panel per machine, selectable via tabs (each tab shows that machine's
  current runner at a glance). The whole board updates live.
- For the selected machine it shows the **current head runner** and the
  **upcoming runners** in order, driven by the **checkout-anchored slot timer**:
  - When the previous runner **checks out**, the next runner's slot timer starts,
    counting down `buffer + run duration`, anchored to that checkout time. (The
    very first runner's slot is anchored to the event start time.)
  - During the **buffer** portion the board shows a "check-in window" countdown —
    the time in which the next runner is expected to check in.
  - When the head runner **checks in**, the board switches to a **run countdown**.
    Because the slot is anchored to the previous checkout (not to check-in), a
    runner who checks in **late has less time remaining** in their slot — this is
    shown directly on the timer.
- **Check in** sets the runner to *running* and **auto-stamps the start time**
  (the moderator never types a time).
- **Check out** prompts only for **distance** and an optional **gift**, then
  **auto-stamps the finish time**, decrements the chosen gift's remaining count,
  and advances the queue so the next runner's slot timer starts.

### 2. Skip / no-show
- On the board, the head runner can be marked **No-show** or **Skipped**. This
  advances the queue to the next runner. It does **not** rebalance and does
  **not** recompute anyone's original estimate — the next person simply becomes
  the head.

### 3. Runners
- A searchable list of all sign-ups (search by email or name). Shows name,
  department, email, machine, duration, status.
- A moderator can **edit** a runner's name, department, email, and run duration.
  Email uniqueness is re-checked.
- **Moving a runner to a different machine is not possible** and is intentionally
  not offered in the UI — the machine is shown read-only.

### 4. Gifts
- Create / edit / delete gifts with a name and quantity. Shows
  **remaining / total** counts. Checking a runner out with a gift decrements that
  gift's remaining count.

### 5. Config
- Set the **event start time**, the **buffer** (seconds between runners), and the
  **allowed run durations**.
- The **number of machines** can be changed **only before the event starts** (and
  only before anyone has signed up — changing it would break permanent
  assignments). Once the event starts it is **locked**.
- **Start event** captures every signed-up runner's **original estimated start**
  (event start + cumulative `run + buffer` of everyone ahead in their queue),
  which becomes **immutable**, and locks the machine count.

### 6. Export
- One click downloads a **CSV** of every participant and their results: name,
  department, email, machine, run duration, original estimate, actual start /
  finish, distance, gift, status.

---

## Known behavior: idle machines (intentional — there is NO rebalancing)

The system **never** rebalances. A runner is assigned to a machine once, at
sign-up, and stays there. The system never moves anyone between machines and
never reorders a queue to "optimize," not on later sign-ups, not on a skip or
no-show, and not when config changes.

**Consequence:** a machine that gets several no-shows or unusually fast finishers
can **finish early and sit idle** while another machine still has a long line.
The system will **not** redistribute waiting runners to the idle machine.

**This is intentional.** Every participant keeps the exact machine and the time
window they were promised at sign-up; nobody's estimate is ever quietly pushed
later because someone else's queue moved. The trade-off is accepted on purpose.

**Moderators are the manual safety valve.** Watch the live slot timers on the
Board. If a machine goes idle while its next runner hasn't appeared, hustle that
next runner to check in so the machine isn't wasted — but you still never move
anyone to a different machine.

---

## Security model (short version)

Participant emails are **never** readable by an anonymous web client. The
`participants` table is locked; the public can only sign up and look up their own
status (by email) through controlled database functions that return either their
own row or a de-identified queue snapshot. Moderator actions are authorized by a
PIN checked **inside the database** on every call. See `docs/ADR.md` for the full
rationale.
