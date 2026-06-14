# EnergySteps — How the App Works (Project Manager Overview)

A plain-language guide to what the app does, who uses it, and the rules behind
the scenes. No code knowledge needed. For the exact business rules see
[RULES.md](./RULES.md); for design trade-offs see [ADR.md](./ADR.md).

---

## 1. What the event is

A one-day wellbeing activity ("Energy Steps"). Staff ("Amazers") sign up to use a
set of walking/running machines for a chosen duration (e.g. 2 / 3 / 5 minutes).
The further they go, the higher they rank. There are a fixed number of machines,
gifts to hand out, and a public leaderboard.

There are two kinds of users:

- **Participants (Amazers)** — sign up, check their place in line, see their
  result. They only ever use their phone browser.
- **Moderators (organizers)** — run the event live: call people up, check them
  in and out, record distance, hand out gifts, and watch the dashboard. Access
  is protected by a PIN.

---

## 2. The participant journey

1. **Sign up** — name, department, email (must be a company `@mblife.vn`
   address), and a run duration. The system automatically assigns them to the
   **least-busy machine** and gives them a place in that machine's line.
2. **Get an estimated time** — based on who is ahead of them, the app shows a
   projected check-in time.
3. **Check status anytime** — they enter their email and see their position in
   line, an updated estimate, and (optionally) a phone alert when they're nearly
   up. *This page refreshes every 30 seconds rather than streaming live, which
   keeps us within the free hosting tier even with ~1,000 people watching.*
4. **Run** — when called, a moderator checks them in, they run, then the
   moderator checks them out and records their distance.
5. **See the result** — their distance, any gift, and a link to the leaderboard.

**Multiple turns are allowed.** Someone can run more than once (after finishing
their previous turn). When they look up their email, they now see the **full
history of every turn** they've taken, not just the latest one.

**Capacity / waitlist.** If an organizer sets an event end time, anyone whose
projected turn falls after that time is marked **waitlisted** ("not guaranteed").
If people ahead drop out, waitlisted runners are automatically promoted.

---

## 3. The moderator console

Six screens, behind a PIN:

| Screen | What it's for |
|---|---|
| **Board** | The live control room. Pick a machine, see who's up, check people in/out, skip/no-show, "call next" over the PA. |
| **Dashboard** | At-a-glance event health: sign-ups, completion rate, machine use, distance totals, gifts given, recent activity. |
| **Registration** | The full sign-up list — searchable, **grouped by machine, ordered by estimated turn time, filterable by department**. Edit a person's details here. |
| **Gifts** | Manage the gift catalogue and stock, and which **run-duration tier** each gift belongs to. |
| **Config** | Set event start/end time, the check-in buffer, allowed durations, machine count, the idle-machine "move grace", and start/reset the event. |
| **Export** | Download all data as a CSV. |

---

## 4. The timing logic (the heart of the app)

Each machine runs as a **single line**. Only one person is "current" at a time.

- **Slot anchor** — a person's turn starts when the previous person on that
  machine finishes (or at the event start time for the very first person).
- **Check-in window** — once it's your turn, there's a short **buffer** (e.g. 2
  minutes) to physically arrive and be checked in. If the buffer runs out, the
  run clock starts anyway, so a late arrival doesn't steal time from everyone
  behind them.
- **Estimates ripple** — if someone runs long or arrives late, everyone behind
  them sees their estimate shift later automatically. If things run early,
  estimates move up.

### The "idle machine" rule (new)

**The problem:** if a machine sits empty for a while — everyone finished, then
someone new signs up an hour later — the old logic anchored their turn to the
*last* finish (an hour ago). The result: their estimate showed a time in the
past, and on the live board they were instantly shown as "already running / time
elapsed", with no proper check-in window.

**The fix:** when a machine is clearly idle (the person is still waiting and the
normal check-in window has already passed unused), the app re-anchors their turn
to **"now + a short move grace"** — a few minutes for them to walk over. This
grace is set by the organizer in **Config** ("Idle-machine move grace",
default 3 minutes). Normal back-to-back handoffs are unaffected.

---

## 5. Gifts

- Gifts have a **stock count** and can be **mapped to a run-duration tier**
  (e.g. the 5-minute tier gets "Set hoa quả").
- **At check-out, the right gift is auto-selected** in the dropdown if it's in
  stock — the moderator just confirms. They can always override or choose "no
  gift".
- **One gift per person (per email), ever** — across all their turns.
- **Stock is protected at the database level.** If two moderators try to give
  out the last unit of a gift at the same time, only one succeeds; the other is
  cleanly told it's out of stock. There is no overselling.
- **Sign-up confirmation messaging.** Right after signing up, the runner always
  sees one of three gift messages:
  1. **A tier gift is mapped, in stock, and a slot is still expected for them**
     → the real remaining count ("N _gift_ still waiting").
  2. **The tier's gifts are expected to be claimed by earlier finishers, are out
     of stock, or none is mapped** → an encouraging message (no gift promised).
  3. **They already received their one gift on a previous run** → an encouraging
     message.
  There is **no individual "top 1" gift** for a single run. Cases (2) and (3)
  therefore frame the value of running as **adding to the runner's department
  total distance** — the headline leaderboard ranking — rather than chasing an
  individual prize. "Expected" deliberately **excludes no-shows and skips** (they
  never finish, so they don't consume a gift slot).

---

## 6. The leaderboard (public)

- **Department standings are the headline** — shown first and most prominently.
  **Every department is listed**, including those with **0 km** so far, so no
  team is invisible.
- **Individuals** are ranked underneath, grouped by run duration (you can't
  fairly compare a 2-minute run to a 5-minute run on distance alone).
- Individual names are **de-identified** to a friendly handle (e.g. "An N.") —
  a deliberate privacy choice.
- Like the status page, it refreshes periodically rather than streaming live.

---

## 7. Safety & fairness built in

- **No double-booking a slot** — concurrent sign-ups are serialized, so two
  people can't land on the exact same spot.
- **Machines are never silently reshuffled** — a person keeps their assigned
  machine. A moderator *can* manually move a waiting runner to a machine that is
  currently free (to rebalance), but the app never does this on its own.
- **Undo** — an accidental check-in or check-out can be undone within a minute
  (restoring gift stock if needed).
- **Distance and gift validation** — negative/garbage distances and
  out-of-stock gifts are rejected by the database, not just the screen.
- **Everything is in Vietnam time** for everyone, regardless of their device.
- **Audit log** — every moderator action (check-in/out, skip, move, undo) is
  recorded.

---

## 8. Known limitations / things to watch on the day

These are honest caveats, not bugs — worth knowing as PM:

1. **Waitlist math is optimistic.** It projects finish times from the *planned*
   start, not from how the day is actually progressing. On a slow day it may
   promise spots to waitlisted people who realistically won't fit. Treat the
   waitlist as a soft "maybe", which is how it's labelled.
2. **People who sign up after the event starts** don't get an "original
   estimated start" stamped, so their status page shows a generic label there
   and their "running behind" indicator can be noisy. Their live estimate is
   still correct.
3. **Phone alerts only fire while the status page is open** in the foreground —
   we can't notify a pocketed, locked phone. The page says so.
4. **Distance has no upper limit** — a moderator typo (e.g. 9999) would skew the
   leaderboard. Worth a quick sanity check when recording big numbers.
5. **Leaderboard tie-break** within a tier is by distance only (not earliest
   finish) — a documented, accepted simplification.
6. **Free hosting tier** caps live connections, which is why status/leaderboard
   pages poll every 30s instead of updating instantly. Fine for the expected
   crowd; just set expectations that updates aren't millisecond-live.

---

## 9. Recent changes in this round

- Registration list: shows **estimated turn time**, **grouped by machine**,
  **sorted by time**, **filterable by department**.
- Leaderboard: **departments promoted to the top**; **all departments shown**
  (0 km when none yet).
- Status page: **full history of all turns** for repeat participants.
- **Idle-machine estimate fix** (Section 4) + a configurable move-grace setting.
- **Gift↔duration mapping** with **backend-driven auto-select** at check-out
  (Section 5).
