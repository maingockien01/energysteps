# EnergySteps — Product Improvement Specs

PM specs for the next iteration. Written against the shipped system (single-day
office running event for mblife.vn: public sign-up → permanent machine
assignment → moderator-run floor → CSV export).

Each spec is independently shippable. Effort is rough dev-days for one engineer
familiar with this stack (Vite/React/TS + Supabase RPCs). Schema/API deltas
reference the real objects in `supabase/migrations/0001_init.sql` and
`src/lib/api.ts`.

---

## Product goal & success metrics

This is not a queueing exercise — it's an **engagement event**. The system today
optimizes for *estimate correctness*; it should optimize for the organizer's
actual outcomes:

| Metric | Definition | Why it matters |
|---|---|---|
| **Participation rate** | sign-ups ÷ invited headcount | the event's reason to exist |
| **Completion rate** | `finished` ÷ sign-ups | did people who committed actually run |
| **No-show rate** | (`no_show` + `skipped`) ÷ sign-ups | #1 driver of wasted capacity |
| **Machine utilization** | machine-minutes running ÷ machine-minutes available | did we waste the hardware |
| **On-time finish** | actual last finish vs. planned end | did the event run long |

The single biggest lever on four of these five is **reducing no-shows**, because
a no-show both lowers completion *and* idles a machine. That's why the P0 work
below targets no-shows head-on.

---

## Prioritization summary

| ID | Improvement | Priority | Effort | Primary metric moved |
|---|---|---|---|---|
| P0-1 | "You're up next" notifications | **P0** | 2–3 d | no-show ↓ |
| P0-2 | Capacity model + sign-up closing | **P0** | 2 d | on-time finish, trust |
| P1-1 | Opt-in earlier-slot fill (bounded rebalancing) | **P1** | 3–4 d | utilization ↑ |
| P1-2 | PIN single source of truth | **P1** | 0.5 d | ops safety |
| P1-3 | Undo check-in / check-out | **P1** | 1 d | ops safety |
| P1-4 | Moderator action audit + per-station mode | **P1** | 2 d | ops safety |
| P1-5 | Live leaderboard | **P1** | 2 d | engagement ↑ |
| P2-1 | Post-run confirmation moment | P2 | 1 d | engagement ↑ |
| P2-2 | Organizer dashboard (live + post-event) | P2 | 2–3 d | reporting |
| P2-3 | Status-lookup privacy decision | P2 | 0.5–1 d | privacy |
| P2-4 | Accessibility pass on alerts | P2 | 1 d | inclusivity |

**Decisions needed from the organizer before building** (see end of doc): the
rebalancing tradeoff (P1-1), the notification channel (P0-1), and whether the
leaderboard is opt-in or default (P1-5).

---

# P0 — Reduce no-shows & stop over-promising

## P0-1 — "You're up next" notifications

**Problem.** A participant only learns they're up-next or delayed if they happen
to be staring at `/status`. At an office event, people go back to their desks.
The delay banner and live position are useless to someone who isn't looking. This
is the direct cause of the no-shows that idle machines.

**Goal / metric.** Cut no-show rate. Target: no-show rate < 10%.

**Solution.** Server-side trigger that notifies a participant when they cross a
"get ready" threshold (e.g. **2 runners ahead**, configurable). Channel options,
cheapest first:

1. **Browser push (Web Push / Notifications API)** — opt-in on the status page
   ("🔔 Notify me when I'm close"). No backend email infra. Works only if the
   tab/PWA is registered; acceptable for a phone-in-pocket audience.
2. **Email** via a Supabase Edge Function + transactional provider (Resend/SES).
   Most reliable, needs an API key + sending domain for `@mblife.vn`.
3. **Pragmatic fallback (no new infra):** give moderators a Board action
   "Ping next 2 runners" that's just a louder visual/audio cue at the machine +
   a PA announcement. Zero engineering on the notification path; documents the
   manual process instead of pretending it's automatic.

**Recommendation.** Ship **(1) browser push** first — no secrets, no new
services, opt-in fits the no-login model. Add email later if no-show data shows
push isn't landing.

**Data model.** Add to `participants`: `notify_threshold_reached_at timestamptz`
(idempotency guard so we ping once). For push: a `push_subscriptions` table
(`participant_id`, `endpoint`, `keys jsonb`).

**API.** New `register_push(email, subscription)` RPC; the projection logic in
`queueLogic.ts` already computes `livePosition` — reuse it server-side (or in the
existing Realtime broadcast handler) to decide when position ≤ threshold and fire
once.

**Acceptance criteria.**
- A participant 2 ahead receives exactly one "get ready" notification.
- A participant whose projection slips past their estimate receives one "running
  behind, new time HH:MM" notification.
- No duplicate notifications on repeated realtime broadcasts.
- Opting out / never opting in produces zero notifications and no errors.

**Risks.** Push permission prompts have low opt-in; measure. iOS Safari requires
the page be an installed PWA for push — verify against the actual audience's
phones before committing.

---

## P0-2 — Capacity model & sign-up closing

**Problem.** There is **no cap on sign-ups and no concept of event end time**
(`event_config` has `event_start_time`, `buffer_seconds`, `queue_count`,
`allowed_run_durations` — no end). If 150 people sign up for 3 machines, the back
of every queue is *promised a slot and an estimate that cannot physically
happen*. The product silently over-promises, which is worse than saying "full."

**Goal / metric.** No participant is ever assigned a slot beyond the event
window. On-time finish becomes achievable and visible.

**Solution.**
- Add `event_end_time` (or derive a soft end) to `event_config`.
- At sign-up, the `sign_up` RPC already computes the assigned queue's projected
  start; reject (or **waitlist**) any assignment whose projected **finish**
  exceeds `event_end_time`, returning a new `EVENT_FULL` error code the form
  renders as "Sign-ups are full for today."
- Config view shows a live **"feasible capacity"** readout: given current
  durations + buffer + machines + window, how many more runners fit. This is the
  number the organizer actually needs and currently has to guess.

**Data model.** `event_config.event_end_time timestamptz null`. Optional
`participants.waitlisted boolean default false` if waitlist (vs. hard close) is
chosen.

**API.** Extend `moderator_update_config` to accept `event_end_time`; add the
capacity check inside `sign_up`; add `EVENT_FULL` to `ApiErrorCode`.

**Acceptance criteria.**
- With the window full, a new sign-up gets a clear "full" message, not a slot
  that finishes after closing.
- Config shows remaining capacity and it decrements as people sign up.
- Existing assignments are never invalidated by setting an end time after the
  fact (only future sign-ups are gated).

**Open question.** Hard close vs. waitlist? Waitlist is more work (promotion
logic on no-shows) but higher participation. Recommend **hard close** for v1;
revisit if demand exceeds capacity.

---

# P1 — High-value follow-ups

## P1-1 — Opt-in earlier-slot fill (bounded rebalancing)

**Problem.** The system *never* rebalances (FEATURES.md "idle machines",
ADR-005). When Machine 2 finishes early and Machine 1 has a backlog, Machine 2
sits idle by design. The justification — "nobody's estimate is ever quietly
pushed later" — protects a number at the expense of utilization and on-time
finish, which is the wrong tradeoff for a one-day event.

**Goal / metric.** Raise machine utilization and pull the event's finish earlier,
**without** violating the promise the fairness rule exists to protect.

**Solution — earlier-only, opt-in, never silent.** Keep the invariant that an
estimate is never pushed *later*. Add the *opposite* move:

- When a machine is idle (head slot complete, no one checked in) **and** another
  machine has a waiting runner whose projected start is meaningfully later, the
  Board surfaces: *"Machine 2 is free — offer it to [next eligible runner]?"*
- The runner is **offered** the earlier slot (via their status page push from
  P0-1, or a moderator asking them in person). They **accept**; nothing is
  silent or automatic.
- On accept, the runner moves to the idle machine's head. Their estimate only
  ever moves **earlier** — the promise ("never quietly later") holds because
  (a) it's earlier and (b) it's consented.

This converts the manual "moderators are the safety valve" hand-wave into a
guided, one-tap action with the data already on screen.

**Data model.** Moving a runner means rewriting `assigned_queue_id` +
`position_in_queue` — currently treated as permanent. Gate the move behind a new
`moderator_offer_slot` RPC so the invariant is enforced server-side (only allow
if target slot is earlier than current projection; recompute positions in one
transaction).

**Acceptance criteria.**
- A move is only ever offered when it makes the runner's start earlier.
- Declining leaves everything unchanged.
- No runner not involved in the move has their estimate change.
- Idle-machine time visibly drops in a simulated backlog scenario.

**Risk / honest caveat.** This is the most invasive change — it breaks the
"assignment is permanent" invariant that several other behaviors lean on. If the
organizer values predictability over throughput, **don't build it**; instead ship
the *visibility* half only: a Board banner quantifying idle cost ("Machine 2 idle
4:30 · Machine 1 backlog 18 min") so the human decides faster. That's a 1-day
subset and carries none of the data-integrity risk.

---

## P1-2 — PIN single source of truth

**Problem.** Moderator PINs live in **two** places that must be hand-kept
identical: `VITE_MODERATOR_PINS` (frontend env, used by `session.ts` for the UX
gate) and the `moderator_pins` DB table (real authorization). Documented as a
footgun in RELEASE.md and the schema comment. Drift = either a locked-out
moderator or a UI that accepts a PIN every RPC then rejects.

**Goal.** One source of truth. Remove the sync burden.

**Solution.** Drop `VITE_MODERATOR_PINS`. Add a cheap `verify_pin(p_pin)` RPC
returning boolean; `ModeratorGate` calls it on submit instead of checking the env
list. The DB stays the only authority (it already re-checks every RPC via
`assert_moderator`), so this *removes* code rather than adding a second check.

**Data model.** None.
**API.** Add `verify_pin`; `session.ts` `isValidPin` becomes async or the gate
calls the RPC directly.

**Acceptance criteria.**
- Adding/rotating a PIN requires editing only the DB table.
- A wrong PIN is rejected at the gate with the same UX as today.
- No frontend rebuild/redeploy needed to change PINs.

---

## P1-3 — Undo check-in / check-out

**Problem.** Check-out auto-stamps `actual_finish`, logs distance, and
**decrements a gift's `remaining_quantity`** — all irreversible from the UI. A
mis-tap during live ops corrupts results and gift counts with no recovery path
short of editing the DB.

**Goal.** Make the two highest-frequency, highest-stakes moderator actions
reversible for a short window.

**Solution.** "Undo last action" on the Board for ~60s after check-in/check-out.
Undo of check-out must: clear `actual_finish`/`distance_logged`/`gift_id`,
**re-increment** the gift, and restore the runner to head.

**Data model.** None required (state is reconstructable). Optionally a small
`action_log` (see P1-4) makes undo robust across moderators.
**API.** `moderator_undo_check_out` / `moderator_undo_check_in` RPCs that reverse
the prior transaction atomically (must re-increment gift in the same tx).

**Acceptance criteria.**
- Undoing a check-out restores the gift count exactly and reopens the slot.
- Undo is unavailable after the next runner is checked in (or after the window).
- Concurrent moderators can't double-undo (server enforces).

---

## P1-4 — Moderator action audit + per-station mode

**Problem.** All moderators share one Board and one PIN namespace with no record
of **who** did what. With 3 machines run by 3 people there's (a) no dispute trail
("who checked Linh out at the wrong distance?") and (b) easy cross-talk —
checking out the wrong machine's runner.

**Goal.** Reduce live-ops mistakes and make actions attributable.

**Solution.**
- **Per-station mode:** a moderator picks "I'm running Machine 2"; the Board
  defaults to that machine and visually de-emphasizes others. Pure UI/local
  state — no assignment enforcement needed for v1.
- **Action log:** append-only `action_log(id, pin_label, action, participant_id,
  payload jsonb, created_at)` written inside each moderator RPC. Optional named
  PINs (label per row in `moderator_pins`) so the log says "Station-2" not a bare
  number.

**Data model.** New `action_log` table; optional `moderator_pins.label text`.
**API.** Write to `action_log` inside existing moderator RPCs (no new endpoints
for the log itself; add `moderator_get_log` for an admin view if wanted).

**Acceptance criteria.**
- Every check-in/out/skip/config-change produces one log row with actor + target.
- Per-station selection persists across reloads (sessionStorage) and filters the
  Board default view.

---

## P1-5 — Live leaderboard

**Problem.** Distance per runner is captured (`distance_logged`) but only exits
the system as a CSV download. For a *running* event this is the single biggest
piece of engagement left on the table.

**Goal.** Drive participation and in-event energy via friendly competition.

**Solution.** A public `/leaderboard` route: top runners by distance, and a
**department/domain** ranking (the `department` field already exists and office
competition is the strongest participation driver). Updates live via the existing
Realtime broadcast.

**Privacy.** Must respect the de-identification stance (ADR-006): either
(a) **opt-in** display name at sign-up ("show me on the leaderboard"), or
(b) show **department aggregates only** + first name / initials. Decide with the
organizer (see decisions list).

**Data model.** A `show_on_leaderboard boolean` on `participants` if opt-in is
chosen. New de-identified read RPC `get_leaderboard()` returning only
display-safe fields — do **not** reuse moderator state (it has PII).

**API.** `get_leaderboard()` (anon, de-identified). Aggregation can be a SQL view.

**Acceptance criteria.**
- Leaderboard shows no PII beyond what the participant consented to.
- Updates within seconds of a check-out.
- Department ranking handles ties and empty departments gracefully.

---

# P2 — Polish & reporting

## P2-1 — Post-run confirmation moment

**Problem.** After check-out there's no closing moment for the participant — the
loop just ends. A "you ran X m 🎉" confirmation (and gift, if any) on their
status page closes the loop and feeds the leaderboard's social pull.

**Solution.** When a participant's status is `finished`, the status page shows a
celebratory result card (distance, gift, rank if leaderboard is on) with a share
prompt. Pure frontend off existing `finished` data.

**Effort.** 1 d. **Acceptance:** finished runners see their result; non-finished
see current status unchanged.

---

## P2-2 — Organizer dashboard (live + post-event)

**Problem.** Reporting is a raw CSV. The organizer can't see, live or after, the
metrics that justify the event: participation, no-show rate, utilization,
distance distribution, gift burn-down.

**Solution.** A moderator "Dashboard" tab computing the success metrics above
from `state` (live) and a post-event summary. No new data — all derivable from
`participants` + `gifts` + config. CSV stays for raw export.

**Effort.** 2–3 d. **Acceptance:** the five headline metrics render live and
match a hand-count on a small test dataset.

---

## P2-3 — Status-lookup privacy decision

**Problem (already mitigated, flagged as a decision not a bug).** `get_status_by_
email` is anon-callable with no PIN (status page needs it). ADR-006 correctly
stripped PII from the payload, but a guessable `@mblife.vn` address still lets
anyone *confirm a colleague signed up* and see their position/estimate/status.

**Options.**
- **Accept** (recommended for an internal one-day event) — document it as a known,
  bounded tradeoff. 0 eng.
- **Lightweight token** — sign-up returns a lookup token; status requires
  email+token. Kills probing but adds friction to a no-login feature (~0.5–1 d).

**Recommendation.** Accept for v1; only build the token if this goes beyond
internal use.

---

## P2-4 — Accessibility pass on alerts

**Problem.** The most important UI on the status page — the "running behind"
banner — and the Board's go/wait states rely on color (emerald/amber/red).
Color-only signaling fails colorblind users on the one thing they most need to
read.

**Solution.** Add text/iconographic cues alongside color (✓/⚠ + explicit
"On schedule" / "Behind"), verify contrast ratios, and add `aria-live` to the
delay banner so it announces on change. Audit both public pages and the Board.

**Effort.** 1 d. **Acceptance:** state is distinguishable without color; banner
is announced by a screen reader on update.

---

# Decisions needed from the organizer

1. **Rebalancing (P1-1):** is predictability ("my machine/slot never changes")
   more important than utilization/finishing early? → build full opt-in fill, or
   visibility-only subset.
2. **Notification channel (P0-1):** browser push (no infra, lower reach) vs.
   email (needs sending domain, higher reach).
3. **Sign-up overflow (P0-2):** hard close vs. waitlist.
4. **Leaderboard identity (P1-5):** opt-in real names vs. department-only/initials.

# Explicitly out of scope

Multi-event support, user accounts/SSO, native apps, and further hardening of the
security model. This is a single-day internal tool; those are scope creep and
would trade shipping speed for capability nobody asked for.
